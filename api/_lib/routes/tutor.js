// POST /api/tutor  body: { deckId, messages: [{role:'user'|'assistant', content}] }
//
// AI tutor chat grounded in a single deck the user owns. Loads the deck's
// cards as context, runs the conversation, returns the assistant reply.
//
// The client keeps the conversation in memory and resends it each turn (the
// server is stateless here) — simplest correct model for v1. History is
// capped server-side so tokens stay bounded.
//
// Soft free-tier limit: free users get a daily message allowance so the tutor
// is a genuine taste of premium without being unlimited. Paid tiers are
// effectively unlimited (high cap). The cap is enforced via daily_activity-
// style counting on study_sessions? No — we use a dedicated lightweight
// counter table-free approach: count today's tutor turns from a per-day key
// in the notifications-free path… simplest: count is tracked client-side for
// UX, enforced server-side via a cheap query against a tutor_log. To avoid a
// new table for v1, we gate by tier only: free = limited per request batch.

import '../env.js';
import { getSession } from '../session.js';
import { getUser } from '../db.js';
import { getDeckWithCards } from '../decks.js';
import { tutorReply } from '../llm.js';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Free users get a taste; paid users effectively unlimited. Enforced per
// conversation length (the client resends history, so a long convo = many
// turns). This keeps it simple + infra-free for v1; a per-day counter can
// replace it once we see usage.
const FREE_TURN_LIMIT = 10;   // user messages in a single conversation for free tier

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  const user = await getUser(session.uid);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const { deckId, messages } = req.body || {};
  if (!deckId || !UUID_RE.test(deckId)) return res.status(400).json({ error: 'Missing/invalid deckId' });
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required' });

  // Free-tier soft gate: count user turns in this conversation.
  const userTurns = messages.filter((m) => m && m.role === 'user').length;
  const tier = user.tier || 'free';
  if (tier === 'free' && userTurns > FREE_TURN_LIMIT) {
    return res.status(402).json({
      error: 'tutor_limit',
      message: `You've used your free tutor messages for this chat. Upgrade for unlimited tutoring with Pop.`,
      tier,
    });
  }

  // Load the deck (ownership-checked) + its cards as grounding context.
  const deck = await getDeckWithCards(deckId, session.uid);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  const cards = deck.cards || [];
  if (!cards.length) return res.status(400).json({ error: 'Deck has no cards to tutor on' });

  try {
    const { reply } = await tutorReply({ deckTitle: deck.title, cards, messages });
    return res.status(200).json({ reply });
  } catch (e) {
    console.error('tutor error', e?.message || e);
    return res.status(502).json({ error: 'tutor_failed', message: e.message || 'Pop hit a snag — try again.' });
  }
}
