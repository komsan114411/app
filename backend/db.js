// db.js — Mongoose connection with pool, auto-reconnect, graceful shutdown.

import mongoose from 'mongoose';
import { env } from './config/env.js';
import { log } from './utils/logger.js';

mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true);   // strips $ operators from query objects
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
