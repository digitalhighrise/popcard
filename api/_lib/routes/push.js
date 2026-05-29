// /api/push — browser push CRUD + test trigger.
//
// GET    /api/push/key            → { publicKey }       (also via ?action=key)
// POST   /api/push  body: subscription   → saves it
// DELETE /api/push?endpoint=…             → removes one device
// POST   /api/push?action=test            → send a test push to all my devices
//
// We route by ?action= query param so this stays one Vercel function instead
// of three. Keeps the function count low (matters for cold starts + limits).

import '../env.js';
import { getSession } from '../session.js';
import { vapidPublicKey, saveSubscription, removeSubscription, sendToUser } from '../push.js';

export default async function handler(req, res) {
  const action = req.query?.action;

  // Public key endpoint is the only one that doesn't need auth (the client
  // calls it before showing the permission prompt). Don't leak the private key.
  if (req.method === 'GET' && (action === 'key' || !action)) {
    const key = vapidPublicKey();
    if (!key) return res.status(503).json({ error: 'push_not_configured' });
    return res.status(200).json({ publicKey: key });
  }

  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  if (req.method === 'POST' && action === 'test') {
    const result = await sendToUser(session.uid, {
      title: 'Pop says hi 👋',
      body:  'Push is wired and working. Streak reminders fire on this device from now on.',
      link:  '/account',
    });
    return res.status(200).json({ ok: true, ...result });
  }

  if (req.method === 'POST') {
    const sub = req.body?.subscription || req.body;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    try {
      const ua = req.headers['user-agent'] || null;
      const row = await saveSubscription(session.uid, sub, ua);
      return res.status(201).json({ ok: true, id: row.id });
    } catch (e) {
      return res.status(400).json({ error: e.message || 'Failed' });
    }
  }

  if (req.method === 'DELETE') {
    const endpoint = req.query?.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
    await removeSubscription(session.uid, endpoint);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
