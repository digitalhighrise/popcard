import '../env.js';
import { sql } from '../db.js';
import { getSession } from '../session.js';
import { getDeckWithCards } from '../decks.js';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  if (req.method === 'GET') return handleGet(req, res, session);
  if (req.method === 'PATCH') return handlePatch(req, res, session);
  if (req.method === 'DELETE') return handleDelete(req, res, session);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res, session) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const deck = await getDeckWithCards(id, session.uid);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });

  res.status(200).json({
    deck: {
      id: deck.id,
      title: deck.title,
      mode: deck.mode,
      cardCount: deck.card_count,
      sourceType: deck.source_type,
      sourceUrl: deck.source_url,
      createdAt: deck.created_at,
      fromCache: deck.from_cache,
      pinned: deck.pinned,
      reviewStatus: deck.review_status || 'unreviewed',
      reviewData: deck.review_data || null,
    },
    cards: deck.cards || [],
  });
}

async function handlePatch(req, res, session) {
  const id = req.query?.id || req.body?.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const updates = req.body || {};
  const patch = {};

  if (typeof updates.title === 'string') {
    const t = updates.title.trim().slice(0, 140);
    if (!t) return res.status(400).json({ error: 'Title cannot be empty' });
    patch.title = t;
  }
  if (typeof updates.pinned === 'boolean') {
    patch.pinned = updates.pinned;
  }

  const keys = Object.keys(patch);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to update' });

  // Ownership-checked update
  let result;
  if (patch.title != null && patch.pinned != null) {
    result = await sql`
      UPDATE decks
      SET title = ${patch.title}, pinned = ${patch.pinned}
      WHERE id = ${id} AND user_id = ${session.uid}
      RETURNING id, title, pinned
    `;
  } else if (patch.title != null) {
    result = await sql`
      UPDATE decks
      SET title = ${patch.title}
      WHERE id = ${id} AND user_id = ${session.uid}
      RETURNING id, title, pinned
    `;
  } else {
    result = await sql`
      UPDATE decks
      SET pinned = ${patch.pinned}
      WHERE id = ${id} AND user_id = ${session.uid}
      RETURNING id, title, pinned
    `;
  }

  if (!result.length) return res.status(404).json({ error: 'Deck not found' });
  res.status(200).json({ deck: result[0] });
}

async function handleDelete(req, res, session) {
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  // Cards cascade via ON DELETE CASCADE (set in initial migration).
  const result = await sql`
    DELETE FROM decks
    WHERE id = ${id} AND user_id = ${session.uid}
    RETURNING id
  `;
  if (!result.length) return res.status(404).json({ error: 'Deck not found' });
  res.status(200).json({ ok: true });
}
