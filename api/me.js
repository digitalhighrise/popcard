import { getUser } from './_lib/db.js';
import { getSession } from './_lib/session.js';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ user: null });

  const user = await getUser(session.uid);
  if (!user) return res.status(401).json({ user: null });

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
