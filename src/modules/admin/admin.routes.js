import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/errors.js';

const router = Router();
router.use(requireAuth, requireRole('operator'));

router.get('/overview', asyncHandler(async (_req, res) => {
  const [[counts]] = await pool.query(`
    SELECT
      SUM(role = 'customer') AS customers,
      SUM(role = 'customer' AND created_at >= NOW() - INTERVAL 7 DAY) AS newThisWeek,
      SUM(role = 'customer' AND email_verified_at IS NULL) AS unverified,
      SUM(status = 'suspended') AS suspended
    FROM users`);
  const [recent] = await pool.query(`
    SELECT u.id, u.email, u.created_at AS createdAt, u.email_verified_at IS NOT NULL AS emailVerified, p.display_name AS displayName
      FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id
     WHERE u.role = 'customer' ORDER BY u.created_at DESC LIMIT 5`);
  const [activity] = await pool.query(`
    SELECT action, COUNT(*) AS total FROM audit_logs
     WHERE created_at >= NOW() - INTERVAL 7 DAY GROUP BY action ORDER BY total DESC LIMIT 8`);

  res.json({
    stats: {
      customers: Number(counts.customers || 0),
      newThisWeek: Number(counts.newThisWeek || 0),
      unverified: Number(counts.unverified || 0),
      suspended: Number(counts.suspended || 0),
    },
    recentCustomers: recent.map((r) => ({ ...r, emailVerified: Boolean(r.emailVerified) })),
    activity: activity.map((a) => ({ action: a.action, total: Number(a.total) })),
  });
}));

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

router.get('/customers', validate(listSchema, 'query'), asyncHandler(async (req, res) => {
  const { q, page, pageSize } = req.validatedQuery;
  const where = ["u.role = 'customer'"];
  const params = [];
  if (q) {
    where.push('(u.email LIKE ? OR p.display_name LIKE ? OR u.phone LIKE ?)');
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    params.push(like, like, like);
  }
  const whereSql = where.join(' AND ');
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id WHERE ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.phone, u.status, u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
            u.email_verified_at IS NOT NULL AS emailVerified, p.display_name AS displayName
       FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id
      WHERE ${whereSql} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  res.json({
    items: rows.map((r) => ({ ...r, emailVerified: Boolean(r.emailVerified) })),
    page, pageSize, total: Number(total),
  });
}));

export default router;
