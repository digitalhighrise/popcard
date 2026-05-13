import crypto from 'node:crypto';
import { sql } from './db.js';

export const QUOTA = {
  free: 10,
  pro: 1000,
  team: 1000,
};

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
    SELECT d.*, json_agg(json_build_object('position', c.position, 'question', c.question, 'answer', c.answer, 'hint', c.hint) ORDER BY c.position) AS cards
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
  const deckRows = await sql`
    INSERT INTO decks (user_id, source_type, source_url, source_hash, title, mode, card_count, model, from_cache)
    VALUES (${userId}, ${sourceType}, ${sourceUrl}, ${sourceHash}, ${title}, ${mode}, ${cards.length}, ${model}, ${fromCache})
    RETURNING *
  `;
  const deck = deckRows[0];

  if (cards.length) {
    const values = cards.map((c, i) => ({
      deck_id: deck.id,
      position: i,
      question: c.question,
      answer: c.answer,
      hint: c.hint || null,
    }));
    // Insert in a single statement
    await sql`
      INSERT INTO cards (deck_id, position, question, answer, hint)
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(values)}::jsonb)
        AS t(deck_id uuid, position int, question text, answer text, hint text)
    `;
  }

  return deck;
}

export async function getDeckWithCards(deckId, userId) {
  const rows = await sql`
    SELECT d.*, json_agg(json_build_object('position', c.position, 'question', c.question, 'answer', c.answer, 'hint', c.hint) ORDER BY c.position) FILTER (WHERE c.id IS NOT NULL) AS cards
    FROM decks d
    LEFT JOIN cards c ON c.deck_id = d.id
    WHERE d.id = ${deckId}
      AND d.user_id = ${userId}
    GROUP BY d.id
  `;
  return rows[0] || null;
}
