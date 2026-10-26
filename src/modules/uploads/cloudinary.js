import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { cloudinaryEnabled, env } from '../../config/env.js';
import { AppError, badRequest } from '../../utils/errors.js';

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** In-memory upload (never written to local disk), 2 MB cap, images only. */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(badRequest('Please upload a JPG, PNG or WebP image.'));
    cb(null, true);
  },
});

/** The client-sent mimetype can lie; check the file's magic bytes too. */
export function assertRealImage(buffer) {
  const b = buffer;
  const isJpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isPng = b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw badRequest('That file is not a valid image.');
}

function requireCloudinary() {
  if (!cloudinaryEnabled) throw new AppError(503, 'Image uploads are not configured yet.', 'UPLOADS_DISABLED');
}

/**
 * Upload a public, non-sensitive image (e.g. avatar). Receipts and sample photos must use
 * `type: 'authenticated'` delivery with signed URLs instead — see README.
 */
export function uploadPublicImage(buffer, { folder, publicId, transformation }) {
  requireCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `${env.CLOUDINARY_FOLDER}/${folder}`,
        public_id: publicId,
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
        transformation,
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });
}

export async function deleteImage(publicId) {
  if (!cloudinaryEnabled || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  } catch (err) {
    console.error('cloudinary destroy failed:', err.message);
  }
}
