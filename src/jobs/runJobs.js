// CLI entry for cron: `npm run jobs`
import { pool } from '../db/pool.js';
import * as restockService from '../services/restock.service.js';
import * as expireBookings from './expireBookings.job.js';

const expired = await expireBookings.run();
const reminders = await restockService.sendDueReminders();
console.log(JSON.stringify({ ...expired, remindersSent: reminders.sent }));
await pool.end();
