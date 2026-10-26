import multer from 'multer';
import { isProd } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details || {}) } });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'That image is too large.' : 'Upload failed.';
    return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request body too large' } });
  }

  // Unexpected: log server-side, never leak internals.
  console.error(`[${req.method} ${req.originalUrl}]`, isProd ? err?.message : err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' } });
}
