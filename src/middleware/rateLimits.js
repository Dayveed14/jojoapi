import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const make = (windowMinutes, limit, message) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit: env.NODE_ENV === 'test' ? 10_000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message } },
  });

export const loginLimiter = make(15, 10, 'Too many sign-in attempts. Please wait a few minutes and try again.');
export const registerLimiter = make(60, 10, 'Too many sign-up attempts from this network. Please try again later.');
export const resetLimiter = make(15, 5, 'Too many requests. Please wait a few minutes and try again.');
export const refreshLimiter = make(5, 60, 'Too many requests. Please slow down.');
export const uploadLimiter = make(15, 20, 'Too many uploads. Please try again later.');
export const apiLimiter = make(1, 300, 'Too many requests. Please slow down.');
