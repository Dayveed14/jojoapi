// Creates (or resets) Jojo's operator account. Works on Windows, macOS and Linux.
//
//   npm run seed:admin                       → asks for name, email and password
//   npm run seed:admin -- --email jojo@example.com --name "Mama Jojo"   → asks only for the password
//
// You can also put OPERATOR_EMAIL / OPERATOR_PASSWORD / OPERATOR_NAME in server/.env.
import bcrypt from 'bcryptjs';
import readline from 'node:readline';
import { env } from '../config/env.js';
import { pool } from './pool.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Print * instead of the typed characters
      rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : s.replace(/[^\r\n]/g, '*'));
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

let name = arg('name') || process.env.OPERATOR_NAME;
let email = (arg('email') || process.env.OPERATOR_EMAIL || '').trim().toLowerCase();
let password = process.env.OPERATOR_PASSWORD;

if (!name) name = (await ask('Operator name (e.g. Mama Jojo): ')) || 'Jojo Market Operator';
while (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = (await ask('Operator email: ')).toLowerCase();
while (!password || password.length < 10) {
  if (password) console.log('  Password must be at least 10 characters.');
  password = await ask('Operator password (min 10 characters): ', { hidden: true });
}

const hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);

let userId;
if (existing.length) {
  userId = existing[0].id;
  await pool.query(
    "UPDATE users SET role='operator', status='active', password_hash=?, email_verified_at=COALESCE(email_verified_at, NOW()), token_version=token_version+1 WHERE id=?",
    [hash, userId],
  );
  console.log(`✓ Updated ${email} — it is now an operator account with the new password.`);
} else {
  const [res] = await pool.query(
    "INSERT INTO users (email, password_hash, role, status, email_verified_at) VALUES (?, ?, 'operator', 'active', NOW())",
    [email, hash],
  );
  userId = res.insertId;
  console.log(`✓ Created operator ${email}. Sign in at /admin/login`);
}
await pool.query(
  'INSERT INTO customer_profiles (user_id, display_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)',
  [userId, name],
);
await pool.end();
