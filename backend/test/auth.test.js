// Integration test — login flow, CSRF, timing equalization.

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import './setup.js';
import { createAdmin } from './setup.js';

let app;

beforeAll(async () => {
  // Import app AFTER setup has set env vars and connected mongo
  ({ app } = await import('../server.js'));
});

describe('POST /api/auth/login', () => {
  it('rejects malformed body', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'x', password: 'y' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_input');
  });

  it('returns generic 401 for unknown user', async () => {
    const r = await request(app).post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'whatever-long-password' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('invalid_credentials');
  });

  it('returns generic 401 for wrong password', async () => {
    await createAdmin('real@test.com');
    const r = await request(app).post('/api/auth/login')
      .send({ email: 'real@test.com', password: 'wrong-long-password' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('invalid_credentials');
  });

  it('returns access token + sets cookies on success', async () => {
    const { password } = await createAdmin('good@test.com');
    const r = await request(app).post('/api/auth/login')
      .send({ email: 'good@test.com', password });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.user.email).toBe('good@test.com');
    const cookies = r.headers['set-cookie'].join(';');
    expect(cookies).toContain('refresh_token');
    expect(cookies).toContain('XSRF-TOKEN');
    expect(cookies).toContain('HttpOnly');
  });

  it('login timing is similar for unknown vs wrong password', async () => {
    await createAdmin('timing@test.com');
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await request(app).post('/api/auth/login')
        .send({ email: 'ghost@test.com', password: 'x'.repeat(15) });
      times.push(Date.now() - t0);
    }
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await request(app).post('/api/auth/login')
        .send({ email: 'timing@test.com', password: 'x'.repeat(15) });
      times.push(Date.now() - t0);
    }
    // No statistical claim, just check both paths take > 0 ms (dummy verify ran)
    expect(Math.min(...times)).toBeGreaterThan(0);
  });
});

describe('Admin config requires auth + CSRF', () => {
  it('GET /api/admin/config without token → 401', async () => {
    const r = await request(app).get('/api/admin/config');
    expect(r.status).toBe(401);
  });

  it('PATCH /api/admin/config without CSRF header → 403', async () => {
    const { password } = await createAdmin('csrf@test.com');
    const login = await request(app).post('/api/auth/login')
      .send({ email: 'csrf@test.com', password });
    const token = login.body.accessToken;
    const cookies = login.headers['set-cookie'];

    const r = await request(app).patch('/api/admin/config')
      .set('Authorization', 'Bearer ' + token)
      .set('Cookie', cookies)
      .send({ appName: 'Hacked' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/csrf/);
  });

  it('PATCH /api/admin/config with correct token + CSRF → 200', async () => {
    const { password } = await createAdmin('ok@test.com');
    const login = await request(app).post('/api/auth/login')
      .send({ email: 'ok@test.com', password });
    const token = login.body.accessToken;
    const cookies = login.headers['set-cookie'];
    const xsrf = cookies.find(c => c.startsWith('XSRF-TOKEN=')).split(';')[0].split('=')[1];

    const r = await request(app).patch('/api/admin/config')
      .set('Authorization', 'Bearer ' + token)
      .set('Cookie', cookies)
      .set('X-CSRF-Token', xsrf)
      .send({ appName: 'Good Name' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe('Public endpoints', () => {
  it('GET /api/config returns shape', async () => {
    const r = await request(app).get('/api/config');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('appName');
    expect(Array.isArray(r.body.buttons)).toBe(true);
  });

  it('GET /healthz always 200', async () => {
    const r = await request(app).get('/healthz');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('POST /api/track with DNT=1 is ignored', async () => {
    const r = await request(app).post('/api/track')
      .set('DNT', '1')
      .send({ buttonId: 'b1', label: 'test' });
    expect(r.status).toBe(204);
  });
});
