// test/setup.js — shared test bootstrap. Starts in-memory MongoDB + seeds test admin.

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { beforeAll, afterAll, afterEach } from 'vitest';

// Set required env BEFORE any app import.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(64);
process.env.REFRESH_SECRET = 'y'.repeat(64);
process.env.IP_SALT = 'z'.repeat(32);
process.env.CORS_ORIGINS = 'https://test.example.com';
process.env.COOKIE_DOMAIN = '';
process.env.COOKIE_SECURE = 'false';
process.env.TRUST_PROXY = '0';

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  await mongoose.connect(process.env.MONGO_URI, { maxPoolSize: 5 });
});

afterEach(async () => {
  // Clean all collections between tests
  const cols = Object.values(mongoose.connection.collections);
  for (const c of cols) await c.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

export async function createAdmin(email = 'admin@test.com', password = 'CorrectHorseBattery9!') {
  const { User } = await import('../models/User.js');
  const u = new User({ email, role: 'admin' });
  // Bypass password policy in tests (skip zxcvbn/HIBP) by writing hash directly
  const { hash: argonHash, Algorithm } = await import('@node-rs/argon2');
  u.passwordHash = await argonHash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456, timeCost: 2, parallelism: 1,   // lowered for test speed
  });
  await u.save();
  return { user: u, password };
}
