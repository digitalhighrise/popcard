import { getUser } from './_lib/db.js';
import { getSession } from './_lib/session.js';
import { detectYouTubeId, fetchYouTubeTranscript, normalizeText } from './_lib/sources.js';
import { generateCards } from './_lib/llm.js';
import {
  QUOTA,
  hashSource,
  monthlyPopCount,
  findCachedDeck,
  createDeck,
} from './_lib/decks.js';

const MAX_INPUT_CHARS = 80_000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  const user = await getUser(session.uid);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const { input, mode } = req.body || {};
  if (typeof input !== 'string' || !input.trim()) {
    return res.status(400).json({ error: 'Missing input' });
  }
  const safeMode = mode === 'study' ? 'study' : 'simple';

  // Quota check
  const limit = QUOTA[user.tier] || QUOTA.free;
  const used = await monthlyPopCount(user.id);
  if (used >= limit) {
    return res.status(402).json({
      error: 'quota_exceeded',
      message: `You've used ${used} of ${limit} pops this month. Upgrade for more.`,
      tier: user.tier,
    });
  }

  // Resolve source
  let source;
  try {
    const ytId = detectYouTubeId(input);
    if (ytId) {
      source = await fetchYouTubeTranscript(ytId);
    } else {
      source = normalizeText(input);
    }
  } catch (e) {
    return res.status(400).json({
      error: 'source_unavailable',
      message: e.message?.includes('Transcript is disabled')
        ? 'This video has no captions. Try a different one or paste the text.'
        : `Could not fetch source: ${e.message}`,
    });
  }

  if (!source.text || source.text.length < 80) {
    return res.status(400).json({
      error: 'source_too_short',
      message: 'Need at least ~80 characters to make meaningful cards.',
    });
  }
  const trimmed = source.text.slice(0, MAX_INPUT_CHARS);

  const sourceHash = hashSource({
    sourceUrl: source.sourceUrl,
    text: trimmed,
    mode: safeMode,
  });

  // Cache lookup
  const cached = await findCachedDeck({ sourceHash, mode: safeMode });
  if (cached) {
    const deck = await createDeck({
      userId: user.id,
      sourceType: source.sourceType,
      sourceUrl: source.sourceUrl,
      sourceHash,
      title: cached.title,
      mode: safeMode,
      model: cached.model,
      fromCache: true,
      cards: cached.cards,
    });
    return res.status(200).json({
      deck: { id: deck.id, title: deck.title, mode: deck.mode, cardCount: deck.card_count, fromCache: true },
      cards: cached.cards,
    });
  }

  // Generate fresh
  let generated;
  try {
    generated = await generateCards({
      text: trimmed,
      mode: safeMode,
      sourceUrl: source.sourceUrl,
    });
  } catch (e) {
    console.error('LLM error', e);
    return res.status(502).json({ error: 'llm_error', message: e.message });
  }

  const deck = await createDeck({
    userId: user.id,
    sourceType: source.sourceType,
    sourceUrl: source.sourceUrl,
    sourceHash,
    title: generated.title,
    mode: safeMode,
    model: generated.model,
    fromCache: false,
    cards: generated.cards,
  });

  res.status(200).json({
    deck: { id: deck.id, title: deck.title, mode: deck.mode, cardCount: deck.card_count, fromCache: false },
    cards: generated.cards.map((c, i) => ({ position: i, ...c })),
  });
}
