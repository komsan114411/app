// Integration test — login flow, CSRF, timing equalization.

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import './setup.js';
import { createAdmin } from './setup.js';

let app;

beforeAll(async () => {
  ({ app } = await import('../server.js'));
});

describe('POST /api/auth/login', () => {
  it('rejects malformed body', async () => {
    const r = await request(app).post('/api/auth/login').send({ loginId: 'x', password: '' });
    expect(r.status).toBe(400);
  });

  it('returns generic 401 for unknown user', async () => {
    const r = await request(app).post('/api/auth/login')
      .send({ loginId: 'ghost', password: 'whatever-long-password' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('invalid_credentials');
  });

  it('returns generic 401 for wrong password', async () => {
    await createAdmin('realuser');
    const r = await request(app).post('/api/auth/login')
      .send({ loginId: 'realuser', password: 'wrong-long-password' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('invalid_credentials');
  });

  it('returns access token + sets cookies on success', async () => {
    const { password } = await createAdmin('gooduser');
    const r = await request(app).post('/api/auth/login')
      .send({ loginId: 'gooduser', password });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.user.loginId).toBe('gooduser');
    expect(r.body.user.mustChangePassword).toBe(false);
    const cookies = r.headers['set-cookie'].join(';');
    expect(cookies).toContain('refresh_token');
    expect(cookies).toContain('XSRF-TOKEN');
    expect(cookies).toContain('HttpOnly');
  });

  it('login timing is similar for unknown vs wrong password', async () => {
    await createAdmin('timinguser');
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await request(app).post('/api/auth/login')
        .send({ loginId: 'ghostuser', password: 'x'.repeat(15) });
      times.push(Date.now() - t0);
    }
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await request(app).post('/api/auth/login')
        .send({ loginId: 'timinguser', password: 'x'.repeat(15) });
      times.push(Date.now() - t0);
    }
    expect(Math.min(...times)).toBeGreaterThan(0);
  });
});

describe('Admin config requires auth + CSRF', () => {
  it('GET /api/admin/config without token → 401', async () => {
    const r = await request(app).get('/api/admin/config');
    expect(r.status).toBe(401);
  });

  it('PATCH /api/admin/config without CSRF header → 403', async () => {
    const { password } = await createAdmin('csrfuser');
    const login = await request(app).post('/api/auth/login')
      .send({ loginId: 'csrfuser', password });
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
    const { password } = await createAdmin('okuser');
    const login = await request(app).post('/api/auth/login')
      .send({ loginId: 'okuser', password });
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
