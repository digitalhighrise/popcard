// Consolidated AI function (per-card refine + deck tutor chat).
// Rewrites: /api/refine -> ?_r=refine, /api/tutor -> ?_r=tutor.
import './_lib/env.js';
import refine from './_lib/routes/refine.js';
import tutor from './_lib/routes/tutor.js';

const ROUTES = { refine, tutor };

export default async function handler(req, res) {
  const r = (req.query && req.query._r) || '';
  const fn = ROUTES[r];
  if (!fn) return res.status(404).json({ error: 'Unknown ai route', _r: r });
  return fn(req, res);
}
