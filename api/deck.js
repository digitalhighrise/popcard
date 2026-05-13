import { getSession } from './_lib/session.js';
import { getDeckWithCards } from './_lib/decks.js';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

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
    },
    cards: deck.cards || [],
  });
}
