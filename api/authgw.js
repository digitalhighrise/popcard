// Consolidated auth function (Google sign-in + logout).
// Rewrites: /api/auth/google -> ?_r=google, /api/auth/logout -> ?_r=logout.
import './_lib/env.js';
import google from './_lib/routes/auth-google.js';
import logout from './_lib/routes/auth-logout.js';

const ROUTES = { google, logout };

export default async function handler(req, res) {
  const r = (req.query && req.query._r) || '';
  const fn = ROUTES[r];
  if (!fn) return res.status(404).json({ error: 'Unknown auth route', _r: r });
  return fn(req, res);
}
