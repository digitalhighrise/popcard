import crypto from 'node:crypto';
import { sql } from './db.js';

export const QUOTA = {
  free: 10,
  study: 100,
  // Legacy aliases — existing customers on these plans still get serviced.
  pro: 100,
  team: 100,
};

const DEFAULT_TYPE = 'idea';
const DEFAULT_IMPORTANCE = 'good_to_know';

function normalizeCard(c, i) {
  return {
    position: i,
    type: c.type || DEFAULT_TYPE,
    importance: c.importance || DEFAULT_IMPORTANCE,
    question: c.question,
    answer: c.answer,
    hint: c.hint || null,
    sourceTimestampSeconds:
      typeof c.sourceTimestampSeconds === 'number' && Number.isFinite(c.sourceTimestampSeconds)
        ? Math.max(0, Math.round(c.sourceTimestampSeconds))
        : null,
  };
}

export function hashSource({ sourceUrl, text, mode }) {
  const key = `${mode}::${sourceUrl || `text:${text}`}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function monthlyPopCount(userId) {
  const rows = await sql`
    SELECT count(*)::int AS n
    FROM decks
    WHERE user_id = ${userId}
      AND created_at >= date_trunc('month', now())
  `;
  return rows[0]?.n || 0;
}

export async function findCachedDeck({ sourceHash, mode }) {
  const rows = await sql`
    SELECT d.*,
      json_agg(
        json_build_object(
          'position', c.position,
          'type', c.type,
          'importance', c.importance,
          'question', c.question,
          'answer', c.answer,
          'hint', c.hint,
          'sourceTimestampSeconds', c.source_timestamp_seconds
        ) ORDER BY c.position
      ) AS cards
    FROM decks d
    JOIN cards c ON c.deck_id = d.id
    WHERE d.source_hash = ${sourceHash}
      AND d.mode = ${mode}
      AND d.from_cache = false
      AND d.created_at >= now() - interval '30 days'
    GROUP BY d.id
    ORDER BY d.created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function createDeck({
  userId,
  sourceType,
  sourceUrl,
  sourceHash,
  title,
  mode,
  model,
  fromCache,
  cards,
}) {
  const normalized = cards.map(normalizeCard);

  const deckRows = await sql`
    INSERT INTO decks (user_id, source_type, source_url, source_hash, title, mode, card_count, model, from_cache)
    VALUES (${userId}, ${sourceType}, ${sourceUrl}, ${sourceHash}, ${title}, ${mode}, ${normalized.length}, ${model}, ${fromCache})
    RETURNING *
  `;
  const deck = deckRows[0];

  if (normalized.length) {
    const values = normalized.map((c) => ({
      deck_id: deck.id,
      position: c.position,
      type: c.type,
      importance: c.importance,
      question: c.question,
      answer: c.answer,
      hint: c.hint,
      source_timestamp_seconds: c.sourceTimestampSeconds,
    }));
    await sql`
      INSERT INTO cards (deck_id, position, type, importance, question, answer, hint, source_timestamp_seconds)
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(values)}::jsonb)
        AS t(deck_id uuid, position int, type text, importance text, question text, answer text, hint text, source_timestamp_seconds int)
    `;
  }

  return { deck, cards: normalized };
}

export async function getDeckWithCards(deckId, userId) {
  // Validate it looks like a uuid before hitting Postgres (avoids 22P02 errors on bad input).
  if (!/^[\w-]{8,}$/.test(deckId || '')) return null;
  const rows = await sql`
    SELECT d.*,
      json_agg(
        json_build_object(
          'position', c.position,
          'type', c.type,
          'importance', c.importance,
          'question', c.question,
          'answer', c.answer,
          'hint', c.hint,
          'sourceTimestampSeconds', c.source_timestamp_seconds
        ) ORDER BY c.position
      ) FILTER (WHERE c.id IS NOT NULL) AS cards
    FROM decks d
    LEFT JOIN cards c ON c.deck_id = d.id
    WHERE d.id = ${deckId}
      AND d.user_id = ${userId}
    GROUP BY d.id
  `;
  return rows[0] || null;
}
