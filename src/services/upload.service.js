// Cloudinary adapter. Two kinds of images:
//   public  — profile photos (non-sensitive), normal delivery URLs
//   private — receipts, sample/item photos: uploaded as type "authenticated" and only ever
//             shown through short-lived signed download links after an ownership check.
import { v2 as cloudinary } from 'cloudinary';
import { cloudinaryEnabled, env } from '../config/env.js';
import { AppError, badRequest } from '../utils/errors.js';

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/** The browser-sent mimetype can lie; check the file signature. Returns the real format. */
export function detectImageFormat(buffer) {
  const b = buffer;
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'webp';
  throw badRequest('That file is not a valid image.');
}

function requireCloudinary() {
  if (!cloudinaryEnabled) throw new AppError(503, 'Image uploads are not configured yet.', 'UPLOADS_DISABLED');
}

function uploadStream(buffer, options) {
  requireCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ resource_type: 'image', ...options }, (err, result) => (err ? reject(err) : resolve(result)));
    stream.end(buffer);
  });
}

export function uploadPublicImage(buffer, { folder, publicId, transformation }) {
  return uploadStream(buffer, {
    folder: `${env.CLOUDINARY_FOLDER}/${folder}`, public_id: publicId, overwrite: true, invalidate: true, transformation,
  });
}

/** Private upload: not reachable by a plain URL. Resized on upload to keep files small. */
export function uploadPrivateImage(buffer, { folder }) {
  return uploadStream(buffer, {
    folder: `${env.CLOUDINARY_FOLDER}/${folder}`,
    type: 'authenticated',
    transformation: [{ width: 1600, height: 1600, crop: 'limit' }, { quality: 'auto' }],
  });
}

/** Short-lived signed link to a private image. */
export function privateImageUrl(publicId, format, ttlSeconds = 600) {
  requireCloudinary();
  return cloudinary.utils.private_download_url(publicId, format, {
    type: 'authenticated', resource_type: 'image', expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}

export async function deleteImage(publicId, { privateAsset = false } = {}) {
  if (!cloudinaryEnabled || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true, ...(privateAsset ? { type: 'authenticated' } : {}) });
  } catch (err) {
    console.error('cloudinary destroy failed:', err.message);
  }
}
