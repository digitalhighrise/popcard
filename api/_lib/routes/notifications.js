// /api/notifications — read + mark-read for the bell dropdown.
//
// GET    /api/notifications              → { items, unreadCount }
// PATCH  /api/notifications              → mark ALL unread as read
// PATCH  /api/notifications?id=<uuid>    → mark one as read
//
// All ownership-scoped via the session uid.

import '../env.js';
import { getSession } from '../session.js';
import { listNotifications, markAllRead, markOneRead } from '../notifications.js';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  if (req.method === 'GET') {
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));
    const data = await listNotifications(session.uid, limit);
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    const id = req.query?.id;
    if (id) {
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' });
      await markOneRead(session.uid, id);
    } else {
      await markAllRead(session.uid);
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
