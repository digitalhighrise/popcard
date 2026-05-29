import './_lib/env.js';
import { sql } from './_lib/db.js';
import { getSession } from './_lib/session.js';
// Consolidated route (Hobby 12-function limit): /api/deck (single deck
// GET/PATCH/DELETE) is rewritten here with ?_r=deck.
import deckRoute from './_lib/routes/deck.js';

export default async function handler(req, res) {
  if (req.query && req.query._r === 'deck') return deckRoute(req, res);

  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  if (req.method === 'DELETE') return handleDeleteAll(req, res, session);
  return handleList(req, res, session);
}

async function handleList(req, res, session) {
  const limit = Math.min(parseInt(req.query?.limit, 10) || 30, 50);

  const rows = await sql`
    SELECT id, title, mode, card_count, source_type, source_url, from_cache, pinned, created_at
    FROM decks
    WHERE user_id = ${session.uid}
    ORDER BY pinned DESC, created_at DESC
    LIMIT ${limit}
  `;

  res.status(200).json({
    decks: rows.map((d) => ({
      id: d.id,
      title: d.title,
      mode: d.mode,
      cardCount: d.card_count,
      sourceType: d.source_type,
      sourceUrl: d.source_url,
      fromCache: d.from_cache,
      pinned: d.pinned,
      createdAt: d.created_at,
    })),
  });
}

// Bulk-delete every deck owned by the current user.
// Cards cascade via the ON DELETE CASCADE foreign key set in the initial
// schema, so we only need to delete the decks themselves.
async function handleDeleteAll(req, res, session) {
  const result = await sql`
    DELETE FROM decks WHERE user_id = ${session.uid} RETURNING id
  `;
  res.status(200).json({ deleted: result.length });
}
