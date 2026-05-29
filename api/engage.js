// Consolidated "engagement" function (notifications + push + scheduling).
// Rewrites: /api/notifications -> ?_r=notifications, /api/push -> ?_r=push,
// /api/schedule -> ?_r=schedule. Client URLs unchanged.
import './_lib/env.js';
import notifications from './_lib/routes/notifications.js';
import push from './_lib/routes/push.js';
import schedule from './_lib/routes/schedule.js';

const ROUTES = { notifications, push, schedule };

export default async function handler(req, res) {
  const r = (req.query && req.query._r) || '';
  const fn = ROUTES[r];
  if (!fn) return res.status(404).json({ error: 'Unknown engage route', _r: r });
  return fn(req, res);
}
