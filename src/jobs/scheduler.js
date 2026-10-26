// In-process scheduler for small deployments (JOBS_ENABLED=true).
// On a multi-instance deployment, turn this off and run `npm run jobs` from cron instead —
// both jobs are idempotent, so an occasional double run is harmless.
import * as restockService from '../services/restock.service.js';
import { lagosHour } from '../utils/dates.js';
import * as expireBookings from './expireBookings.job.js';

const EVERY_10_MIN = 10 * 60 * 1000;
const REMINDER_HOUR = 9; // send restock emails after 9am Lagos time

export function startScheduler() {
  const tick = async () => {
    try {
      const r = await expireBookings.run();
      if (r.expired) console.log(`[jobs] expired ${r.expired} booking(s)`);
      if (lagosHour() >= REMINDER_HOUR) {
        const s = await restockService.sendDueReminders();
        if (s.sent) console.log(`[jobs] sent ${s.sent} restock reminder(s)`);
      }
    } catch (err) {
      console.error('[jobs] tick failed:', err.message);
    }
  };
  setTimeout(tick, 5000).unref();
  setInterval(tick, EVERY_10_MIN).unref();
  console.log('[jobs] scheduler started');
}
