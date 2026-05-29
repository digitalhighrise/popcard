// POST /api/review-deck  body: { deckId }
//
// The "trust pass". Runs a second LLM critique over a deck's study cards,
// rating each one's factual confidence, then persists the verdicts (flagging
// low-confidence cards + setting the deck's review_status for the
// "Pop-checked" badge).
//
// Called lazily + fire-and-forget from the deck view, like the quiz warm —
// so it never blocks the pop. Idempotent: if the deck was reviewed in the
// last 7 days it returns the cached status without re-spending an LLM call.
//
// GET /api/review-deck?deckId=…  → just the current status (no LLM call).

import '../env.js';
import { getSession } from '../session.js';
import { sql } from '../db.js';
import { getStudyCardsForReview, saveDeckReview } from '../decks.js';
import { reviewDeckCards, groupCardsIntoLessons } from '../llm.js';
import { regroupDeckLessons } from '../lessons.js';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  const deckId = req.query?.deckId || req.body?.deckId;
  if (!deckId || !UUID_RE.test(deckId)) return res.status(400).json({ error: 'Missing/invalid deckId' });

  // Current status (used by GET + the freshness check on POST).
  const drows = await sql`
    SELECT review_status, review_data, title FROM decks
    WHERE id = ${deckId} AND user_id = ${session.uid} LIMIT 1
  `;
  if (!drows.length) return res.status(404).json({ error: 'Deck not found' });
  const deck = drows[0];

  if (req.method === 'GET') {
    return res.status(200).json({
      status: deck.review_status || 'unreviewed',
      data: deck.review_data || null,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ---- Lesson grouping: turn the arbitrary positional split into named,
  // semantic lessons whose count follows the content. Runs once (regroup
  // skips decks that already have non-generic lesson titles), independent of
  // the review freshness below so already-reviewed decks still get grouped. ----
  let lessonsGrouped = 0;
  try {
    const generic = await sql`
      SELECT count(*)::int AS n FROM lessons
      WHERE deck_id = ${deckId} AND title ~ '^Lesson [0-9]+$'
    `;
    const allRows = await sql`SELECT count(*)::int AS n FROM lessons WHERE deck_id = ${deckId}`;
    const needsGrouping = allRows[0]?.n > 0 && generic[0]?.n === allRows[0]?.n;
    if (needsGrouping) {
      const gc = await getStudyCardsForReview(deckId, session.uid);
      if (gc.length >= 6) {
        const { groups } = await groupCardsIntoLessons({ deckTitle: deck.title, cards: gc });
        if (groups) lessonsGrouped = await regroupDeckLessons(deckId, groups);
      }
    }
  } catch (e) {
    console.error('lesson grouping failed', deckId, e?.message || e);  // non-fatal — positional lessons stay
  }

  // Freshness: skip the (separate) confidence pass if reviewed within 7 days.
  if (deck.review_status && deck.review_status !== 'unreviewed' && deck.review_data?.reviewedAt) {
    const ageMs = Date.now() - new Date(deck.review_data.reviewedAt).getTime();
    if (ageMs < 7 * 24 * 60 * 60 * 1000) {
      return res.status(200).json({ status: deck.review_status, data: deck.review_data, cached: true, lessonsGrouped });
    }
  }

  // Load the study cards + run the critique.
  const cards = await getStudyCardsForReview(deckId, session.uid);
  if (cards.length < 1) {
    return res.status(200).json({ status: 'unreviewed', reason: 'no_cards', lessonsGrouped });
  }

  let verdicts;
  try {
    const result = await reviewDeckCards({ deckTitle: deck.title, cards });
    verdicts = result.verdicts;
  } catch (e) {
    console.error('deck critique failed', deckId, e?.message || e);
    return res.status(502).json({ error: 'review_failed', message: e.message });
  }

  // Map verdict.index (1-based into the ordered study-card list) → card id.
  const flagged = [];
  for (const v of verdicts) {
    if (v.confidence === 'high') continue;
    const card = cards[v.index - 1];
    if (!card) continue;
    flagged.push({ cardId: card.id, confidence: v.confidence, issue: v.issue });
  }

  const saved = await saveDeckReview(deckId, session.uid, { flagged, total: cards.length });
  return res.status(200).json({
    status: saved?.status || (flagged.length ? 'flagged' : 'checked'),
    flaggedCount: flagged.length,
    total: cards.length,
    lessonsGrouped,
  });
}
