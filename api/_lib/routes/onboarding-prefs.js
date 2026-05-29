// POST /api/onboarding-prefs
//
// Persists the user's choices from the Duolingo-style onboarding flow:
// topic interests (array), default mode (quick | study), preferred language.
//
// Defensive: if the users table doesn't have these columns yet (migration
// not run), the endpoint still 200s — it just won't persist. The front-end
// keeps a localStorage copy as a fallback, so nothing is lost.
import '../env.js';
import { sql } from '../db.js';
import { getSession } from '../session.js';

const ALLOWED_MODES = new Set(['quick', 'study']);
const ALLOWED_LANGS = new Set([
  'en', 'es', 'zh', 'hi', 'ar', 'pt', 'fr', 'de', 'ja', 'ru',
]);
const ALLOWED_TOPICS = new Set([
  'books', 'videos', 'articles', 'podcasts', 'lectures', 'study',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Validate & coerce
  const topics = Array.isArray(body.topics)
    ? body.topics.filter((t) => ALLOWED_TOPICS.has(t)).slice(0, 6)
    : [];
  const defaultMode = ALLOWED_MODES.has(body.default_mode) ? body.default_mode : null;
  const language = ALLOWED_LANGS.has(body.language) ? body.language : null;

  // Try to persist. Wrap in try/catch — if the columns don't exist yet
  // (no migration), don't fail the request; the onboarding flow still succeeds
  // and we keep a localStorage fallback on the client.
  try {
    await sql`
      UPDATE users
      SET
        topic_interests = ${JSON.stringify(topics)},
        default_mode = ${defaultMode},
        preferred_language = ${language},
        updated_at = NOW()
      WHERE id = ${session.uid}
    `;
    return res.status(200).json({ ok: true, persisted: true });
  } catch (err) {
    const msg = String(err && err.message || err);
    // 42703 = undefined_column (Postgres). Treat as "migration not yet run"
    // and let the onboarding succeed anyway.
    if (msg.includes('42703') || msg.includes('does not exist')) {
      return res.status(200).json({
        ok: true,
        persisted: false,
        warning: 'onboarding_columns_missing — run migrate-onboarding.mjs',
      });
    }
    console.error('onboarding-prefs failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
