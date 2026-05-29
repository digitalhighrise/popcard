// POST /api/review  — grade a card; updates SM-2 state, returns next interval.
// GET  /api/review  — fetch cards that are due now (optionally scoped to a deck).
//
// Was disabled during the Phase 1 refactor; brought back online for Sprint 2.
// The algorithm is a simplified SM-2: rating → interval bump, ease drift,
// mastery state machine (new → learning → reviewing → mastered).
//
// Ratings (4 stops, matches Anki/Duolingo convention):
//   again — got it wrong;        ~10 min     ease −0.20
//   hard  — got it but it hurt;  short bump  ease −0.15
//   good  — got it cleanly;      standard    ease unchanged
//   easy  — trivial;             long push   ease +0.15
//
// The practice client (Sprint 1) sends only 3 ratings (hard/good/easy). That
// maps cleanly: 'hard' in practice = 'hard' here. We accept 'again' too for
// when we add a "I forgot" button (Sprint 3 lesson screen).

import '../env.js';
import { sql } from '../db.js';
import { getSession } from '../session.js';

const RATINGS = new Set(['again', 'hard', 'good', 'easy']);
const MIN_EASE = 1.3;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function applyRating(card, rating) {
  let { review_count = 0, interval_days = 0, ease = 2.5 } = card;
  // Postgres returns NUMERIC as string — coerce so arithmetic doesn't concat.
  interval_days = Number(interval_days) || 0;
  ease = Number(ease) || 2.5;
  review_count = Number(review_count) || 0;

  let mastery, intervalDays;

  if (rating === 'again') {
    mastery = 'new';
    intervalDays = 10 / (60 * 24);                          // 10 minutes in days
    ease = Math.max(MIN_EASE, ease - 0.20);
  } else if (rating === 'hard') {
    mastery = 'learning';
    intervalDays = Math.max(0.5, (interval_days || 1) * 1.2);
    ease = Math.max(MIN_EASE, ease - 0.15);
  } else if (rating === 'good') {
    mastery = review_count >= 2 ? 'reviewing' : 'learning';
    intervalDays = review_count === 0 ? 1 : Math.max(1, (interval_days || 1) * ease);
  } else {
    // easy
    mastery = review_count >= 1 ? 'mastered' : 'reviewing';
    intervalDays = review_count === 0 ? 3 : Math.max(3, (interval_days || 1) * ease * 1.5);
    ease = ease + 0.15;
  }

  return {
    mastery,
    review_count: review_count + 1,
    interval_days: intervalDays,
    ease,
    next_review_at: new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000),
    last_reviewed_at: new Date(),
  };
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  if (req.method === 'GET')  return handleDue(req, res, session);
  if (req.method === 'POST') return handleGrade(req, res, session);
  return res.status(405).json({ error: 'Method not allowed' });
}

// GET /api/review[?deckId=<uuid>][&limit=<n>]
// Returns cards whose next_review_at <= now (or have never been reviewed),
// scoped to the signed-in user. Used by practice.js to power the "due today"
// queue without a localStorage shadow state.
async function handleDue(req, res, session) {
  const deckId = req.query?.deckId;
  const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));

  if (deckId && !UUID_RE.test(deckId)) {
    return res.status(400).json({ error: 'Invalid deckId' });
  }

  // "Due" = never reviewed (next_review_at IS NULL) OR scheduled time has passed.
  // Skip position-0 overview cards (they're summaries, not study cards).
  const rows = deckId
    ? await sql`
        SELECT c.id, c.deck_id, c.position, c.type, c.importance, c.question, c.answer, c.hint,
               c.mastery, c.review_count, c.interval_days, c.ease, c.next_review_at,
               d.title AS deck_title, d.mode AS deck_mode
        FROM cards c
        JOIN decks d ON d.id = c.deck_id
        WHERE d.user_id = ${session.uid}
          AND d.id = ${deckId}
          AND c.position > 0
          AND (c.next_review_at IS NULL OR c.next_review_at <= now())
        ORDER BY c.next_review_at NULLS FIRST, c.position
        LIMIT ${limit}
      `
    : await sql`
        SELECT c.id, c.deck_id, c.position, c.type, c.importance, c.question, c.answer, c.hint,
               c.mastery, c.review_count, c.interval_days, c.ease, c.next_review_at,
               d.title AS deck_title, d.mode AS deck_mode
        FROM cards c
        JOIN decks d ON d.id = c.deck_id
        WHERE d.user_id = ${session.uid}
          AND c.position > 0
          AND (c.next_review_at IS NULL OR c.next_review_at <= now())
        ORDER BY c.next_review_at NULLS FIRST, d.created_at DESC, c.position
        LIMIT ${limit}
      `;

  res.status(200).json({
    cards: rows.map((c) => ({
      id: c.id,
      deckId: c.deck_id,
      deckTitle: c.deck_title,
      deckMode: c.deck_mode,
      position: c.position,
      type: c.type,
      importance: c.importance,
      question: c.question,
      answer: c.answer,
      hint: c.hint,
      mastery: c.mastery,
      reviewCount: c.review_count,
      intervalDays: Number(c.interval_days) || 0,
      ease: Number(c.ease) || 2.5,
      nextReviewAt: c.next_review_at,
    })),
  });
}

// POST /api/review  body: { cardId, rating }
async function handleGrade(req, res, session) {
  const { cardId, rating } = req.body || {};
  if (!cardId || !UUID_RE.test(cardId)) return res.status(400).json({ error: 'Missing/invalid cardId' });
  if (!RATINGS.has(rating)) return res.status(400).json({ error: 'Invalid rating', expected: [...RATINGS] });

  // Ownership check + load existing state
  const rows = await sql`
    SELECT c.id, c.mastery, c.review_count, c.interval_days, c.ease
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    WHERE c.id = ${cardId} AND d.user_id = ${session.uid}
    LIMIT 1
  `;
  if (!rows.length) return res.status(404).json({ error: 'Card not found' });

  const next = applyRating(rows[0], rating);

  await sql`
    UPDATE cards
    SET mastery = ${next.mastery},
        review_count = ${next.review_count},
        interval_days = ${next.interval_days},
        ease = ${next.ease},
        next_review_at = ${next.next_review_at.toISOString()},
        last_reviewed_at = ${next.last_reviewed_at.toISOString()}
    WHERE id = ${cardId}
  `;

  res.status(200).json({
    cardId,
    mastery: next.mastery,
    reviewCount: next.review_count,
    intervalDays: next.interval_days,
    ease: next.ease,
    nextReviewAt: next.next_review_at.toISOString(),
  });
}
