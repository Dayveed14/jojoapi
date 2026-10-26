import multer from 'multer';
import { badRequest } from '../utils/errors.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** In-memory image upload (never written to local disk). Signature is re-checked in the service. */
export const imageUpload = (maxMb = 2) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED.has(file.mimetype) ? cb(null, true) : cb(badRequest('Please upload a JPG, PNG or WebP image.'))),
});
