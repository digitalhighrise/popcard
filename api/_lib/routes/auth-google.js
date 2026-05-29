import '../env.js';
import { OAuth2Client } from 'google-auth-library';
import { upsertUser } from '../db.js';
import { createSessionCookie } from '../session.js';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ error: 'Missing credential' });
  }

  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const payload = ticket.getPayload();
  const uid = `google_${payload.sub}`;

  const user = await upsertUser({
    id: uid,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  });

  res.setHeader('Set-Cookie', createSessionCookie(uid));
  res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      tier: user.tier,
    },
  });
}
