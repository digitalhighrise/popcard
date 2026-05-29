// /api/schedule — CRUD for scheduled study sessions.
//
// GET  /api/schedule                       → upcoming (next 60 days) + completed today
// GET  /api/schedule?date=YYYY-MM-DD       → entries for that specific UTC date
// POST /api/schedule  body: {
//   scheduledAt: ISO string,
//   sourceKind: 'deck'|'text'|'url',
//   sourceDeckId?: uuid, sourceUrl?: string, sourceText?: string,
//   label?: string
// }                                        → returns the created row
// DELETE /api/schedule?id=<uuid>           → cancel (sets cancelled_at)
// PATCH  /api/schedule?id=<uuid>           → mark completed (sets completed_at)
//
// Ownership is enforced on every read/write. Source data is validated against
// kind to stop bad shapes (deck without an id, text without text, etc).

import '../env.js';
import { sql } from '../db.js';
import { getSession } from '../session.js';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SOURCE_KINDS = new Set(['deck', 'text', 'url']);

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  if (req.method === 'GET')    return handleList(req, res, session);
  if (req.method === 'POST')   return handleCreate(req, res, session);
  if (req.method === 'DELETE') return handleCancel(req, res, session);
  if (req.method === 'PATCH')  return handleComplete(req, res, session);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleList(req, res, session) {
  const date = req.query?.date;
  let rows;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    rows = await sql`
      SELECT s.*, d.title AS deck_title
      FROM scheduled_sessions s
      LEFT JOIN decks d ON d.id = s.source_deck_id
      WHERE s.user_id = ${session.uid}
        AND s.scheduled_at::date = ${date}::date
      ORDER BY s.scheduled_at ASC
    `;
  } else {
    // Default: upcoming next 60 days, plus things from today even if past
    rows = await sql`
      SELECT s.*, d.title AS deck_title
      FROM scheduled_sessions s
      LEFT JOIN decks d ON d.id = s.source_deck_id
      WHERE s.user_id = ${session.uid}
        AND s.scheduled_at >= (now() AT TIME ZONE 'UTC')::date
        AND s.scheduled_at <= now() + INTERVAL '60 days'
        AND s.cancelled_at IS NULL
      ORDER BY s.scheduled_at ASC
    `;
  }

  res.status(200).json({ sessions: rows.map(rowToJson) });
}

async function handleCreate(req, res, session) {
  const body = req.body || {};
  const scheduledAt = body.scheduledAt;
  const sourceKind = body.sourceKind;
  if (!scheduledAt || isNaN(Date.parse(scheduledAt))) {
    return res.status(400).json({ error: 'Invalid scheduledAt (ISO string required)' });
  }
  if (!SOURCE_KINDS.has(sourceKind)) {
    return res.status(400).json({ error: 'Invalid sourceKind', expected: [...SOURCE_KINDS] });
  }

  // Shape validation per kind
  let sourceDeckId = null;
  let sourceUrl = null;
  let sourceText = null;
  if (sourceKind === 'deck') {
    if (!body.sourceDeckId || !UUID_RE.test(body.sourceDeckId)) {
      return res.status(400).json({ error: 'deck source requires sourceDeckId (uuid)' });
    }
    // Ownership check: user must own the deck they're scheduling
    const own = await sql`SELECT 1 FROM decks WHERE id = ${body.sourceDeckId} AND user_id = ${session.uid} LIMIT 1`;
    if (!own.length) return res.status(404).json({ error: 'Deck not found' });
    sourceDeckId = body.sourceDeckId;
  } else if (sourceKind === 'url') {
    if (typeof body.sourceUrl !== 'string' || !body.sourceUrl.trim()) {
      return res.status(400).json({ error: 'url source requires sourceUrl' });
    }
    sourceUrl = body.sourceUrl.trim().slice(0, 2000);
  } else {
    if (typeof body.sourceText !== 'string' || !body.sourceText.trim()) {
      return res.status(400).json({ error: 'text source requires sourceText' });
    }
    sourceText = body.sourceText.trim().slice(0, 50000);
  }

  const label = (typeof body.label === 'string' ? body.label.trim().slice(0, 140) : null) || null;

  const rows = await sql`
    INSERT INTO scheduled_sessions
      (user_id, scheduled_at, source_kind, source_deck_id, source_url, source_text, label)
    VALUES
      (${session.uid}, ${scheduledAt}, ${sourceKind}, ${sourceDeckId}, ${sourceUrl}, ${sourceText}, ${label})
    RETURNING *
  `;
  res.status(201).json({ session: rowToJson(rows[0]) });
}

async function handleCancel(req, res, session) {
  const id = req.query?.id;
  if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'Missing/invalid id' });
  const rows = await sql`
    UPDATE scheduled_sessions SET cancelled_at = now()
    WHERE id = ${id} AND user_id = ${session.uid} AND cancelled_at IS NULL
    RETURNING id
  `;
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.status(200).json({ ok: true });
}

async function handleComplete(req, res, session) {
  const id = req.query?.id;
  if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'Missing/invalid id' });
  const rows = await sql`
    UPDATE scheduled_sessions SET completed_at = now()
    WHERE id = ${id} AND user_id = ${session.uid} AND completed_at IS NULL
    RETURNING id
  `;
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.status(200).json({ ok: true });
}

function rowToJson(r) {
  if (!r) return null;
  return {
    id: r.id,
    scheduledAt: r.scheduled_at,
    sourceKind: r.source_kind,
    sourceDeckId: r.source_deck_id,
    sourceUrl: r.source_url,
    sourceText: r.source_text ? `${r.source_text.slice(0, 80)}${r.source_text.length > 80 ? '…' : ''}` : null,
    deckTitle: r.deck_title || null,
    label: r.label,
    notifiedAt: r.notified_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
  };
}
