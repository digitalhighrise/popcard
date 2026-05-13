import crypto from 'node:crypto';
import { serialize, parse } from 'cookie';

const COOKIE_NAME = 'popcard_session';
const MAX_AGE = 60 * 60 * 24 * 30;

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  // Timing-safe compare
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionCookie(uid) {
  const payload = { uid, exp: Math.floor(Date.now() / 1000) + MAX_AGE };
  return serialize(COOKIE_NAME, sign(payload), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function clearSessionCookie() {
  return serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function getSession(req) {
  const cookies = parse(req.headers.cookie || '');
  return verify(cookies[COOKIE_NAME]);
}
