import './_lib/env.js';
import { sql } from './_lib/db.js';
import { getSession } from './_lib/session.js';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

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
