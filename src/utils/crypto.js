import crypto from 'node:crypto';

export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const uuid = () => crypto.randomUUID();
export const hashIp = (ip) => (ip ? sha256(`jojo:${ip}`) : null);
