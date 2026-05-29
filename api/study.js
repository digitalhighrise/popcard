// Consolidated "study activity" function — fits the Hobby 12-function limit.
// Vercel rewrites map the original public paths here with a ?_r= selector:
//   /api/session     -> /api/study?_r=session
//   /api/review      -> /api/study?_r=review
//   /api/review-deck -> /api/study?_r=review-deck
//   /api/lessons     -> /api/study?_r=lessons
// Client URLs never change; this just routes to the original handlers, which
// live (unchanged) under _lib/routes/ so they don't count as functions.
import './_lib/env.js';
import session from './_lib/routes/session.js';
import review from './_lib/routes/review.js';
import reviewDeck from './_lib/routes/review-deck.js';
import lessons from './_lib/routes/lessons.js';

const ROUTES = { session, review, 'review-deck': reviewDeck, lessons };

export default async function handler(req, res) {
  const r = (req.query && req.query._r) || '';
  const fn = ROUTES[r];
  if (!fn) return res.status(404).json({ error: 'Unknown study route', _r: r });
  return fn(req, res);
}
