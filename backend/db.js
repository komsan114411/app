// db.js — Mongoose connection with pool, auto-reconnect, graceful shutdown.

import mongoose from 'mongoose';
import { env } from './config/env.js';
import { log } from './utils/logger.js';

mongoose.set('strictQuery', true);
// NOTE: `sanitizeFilter` is intentionally NOT set globally. When enabled it
// wraps every filter value in $eq unless explicitly marked mongoose.trusted(),
// which broke every server-side query using {$gt}, {$lt}, {$in}, {$regex},
// etc. (RefreshToken.expiresAt cast errors were the symptom). User input
// reaching queries is already scrubbed by express-mongo-sanitize at the
// request level plus zod .strict() schemas, and no code spreads req.body
// directly into a filter — so turning this off restores normal operator
// behaviour without widening the injection surface.
mongoose.set('autoIndex', env.NODE_ENV !== 'production');   // manage indexes explicitly in prod

export async function connectDB() {
  await mongoose.connect(env.MONGO_URI, {
    maxPoolSize: 50,
    minPoolSize: 5,
    socketTimeoutMS: 45_000,
    serverSelectionTimeoutMS: 10_000,
    heartbeatFrequencyMS: 10_000,
    retryWrites: true,
    autoIndex: env.NODE_ENV !== 'production',
  });

  mongoose.connection.on('error',        err => log.error({ err }, 'mongo error'));
  mongoose.connection.on('disconnected', () => log.warn('mongo disconnected'));
  mongoose.connection.on('reconnected',  () => log.info('mongo reconnected'));

  log.info({ host: mongoose.connection.host, db: mongoose.connection.name }, 'mongo connected');
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
