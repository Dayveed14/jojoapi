import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isProd } from './config/env.js';
import { pool } from './db/pool.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimits.js';
import routes from './routes/index.js';
import { webhookRouter } from './routes/payment.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY); // needed behind a proxy for correct req.ip

  app.use(helmet());
  if (env.NODE_ENV !== 'test') app.use(morgan(isProd ? 'combined' : 'dev'));

  // Payment provider webhooks: raw body, no CORS, no cookies.
  app.use('/api/payments', webhookRouter);

  app.use(cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded' });
    }
  });

  app.use('/api', apiLimiter, routes);
  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
