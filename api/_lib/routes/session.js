// POST /api/session — record a completed study/quiz/lesson session.
//
// Called by:
//   practice.js   on completeSession()       → source 'practice'
//   quizzes.js    on round/session complete  → source 'quiz'
//   (lesson page  Sprint 3)                  → source 'lesson'
//
// Body: { source, deckId?, mode?, cardsReviewed, correctCount?, durationMs?, fresh? }
//
// Returns: { ok, sessionId, sparksEarned, streak: { days, longest, shields, dayChanged } }
//
// Sparks are computed server-side from the payload (clients can't inflate XP).
// Streak and daily_activity are updated atomically alongside the session row
// so the dashboard reflects truth on the next /api/me hit.

import '../env.js';
import { sql, getUser } from '../db.js';
import { getSession } from '../session.js';
import { recordSession, SESSION_SOURCES } from '../sessions.js';
import { maybeCreateStreakMilestone } from '../notifications.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = getSession(req);
  if (!auth) return res.status(401).json({ error: 'Not signed in' });

  const user = await getUser(auth.uid);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const body = req.body || {};
  const source = String(body.source || '').toLowerCase();
  if (!SESSION_SOURCES.has(source)) {
    return res.status(400).json({ error: 'Invalid source', expected: [...SESSION_SOURCES] });
  }

  const cardsReviewed = Math.max(0, Math.min(60, Number(body.cardsReviewed) | 0));
  const correctCount  = Math.max(0, Math.min(cardsReviewed, Number(body.correctCount) | 0));
  const durationMs    = body.durationMs == null ? null : Math.max(0, Math.min(60 * 60 * 1000, Number(body.durationMs) | 0));
  const mode          = typeof body.mode === 'string' ? body.mode.slice(0, 32) : null;
  const fresh         = body.fresh !== false; // default true; lesson strengthens send false
  // deckId is uuid or null; minimal shape-check to avoid 22P02 from Postgres.
  const deckId = typeof body.deckId === 'string' && /^[0-9a-fA-F-]{36}$/.test(body.deckId)
    ? body.deckId
    : null;

  // Ignore "empty" sessions — no cards graded, nothing to record. Avoids
  // accidental writes when a user opens then immediately quits.
  if (cardsReviewed === 0) {
    return res.status(200).json({ ok: true, sessionId: null, sparksEarned: 0, skipped: 'empty' });
  }

  // 1. Insert the session row (server computes sparks)
  const { id: sessionId, sparksEarned } = await recordSession({
    userId: user.id,
    deckId,
    source,
    mode,
    cardsReviewed,
    correctCount,
    durationMs,
    fresh,
  });

  // 2. Upsert today's daily_activity row (cards + sparks + session count)
  //    Done in one INSERT...ON CONFLICT to avoid a read-then-write race.
  await sql`
    INSERT INTO daily_activity (user_id, activity_date, cards_reviewed, sparks_earned, session_count)
    VALUES (${user.id}, (now() AT TIME ZONE 'UTC')::date, ${cardsReviewed}, ${sparksEarned}, 1)
    ON CONFLICT (user_id, activity_date) DO UPDATE SET
      cards_reviewed = daily_activity.cards_reviewed + EXCLUDED.cards_reviewed,
      sparks_earned  = daily_activity.sparks_earned  + EXCLUDED.sparks_earned,
      session_count  = daily_activity.session_count  + 1
  `;

  // 3. Update streak + sparks_total on users in a single statement. The streak
  //    logic compares last_active_at vs today (UTC date) and acts:
  //      same day      → no streak change, last_active_at stays
  //      yesterday     → streak_days + 1, longest if exceeded
  //      older + shields → consume one shield, streak holds, last_active_at = today
  //      older + no shields → reset streak to 1
  //    NULL last_active_at (first ever session) starts streak at 1.
  const streakRows = await sql`
    WITH s AS (
      SELECT
        streak_days, longest_streak, streak_shields, last_active_at,
        (now() AT TIME ZONE 'UTC')::date                       AS today,
        ((now() AT TIME ZONE 'UTC')::date - INTERVAL '1 day')::date AS yesterday
      FROM users
      WHERE id = ${user.id}
    ),
    next AS (
      SELECT
        CASE
          WHEN last_active_at IS NULL                     THEN 1
          WHEN last_active_at = today                     THEN streak_days
          WHEN last_active_at = yesterday                 THEN streak_days + 1
          WHEN streak_shields > 0                         THEN streak_days
          ELSE 1
        END AS new_streak,
        CASE
          WHEN last_active_at IS NULL OR last_active_at = today OR last_active_at = yesterday
            THEN streak_shields
          WHEN streak_shields > 0
            THEN streak_shields - 1
          ELSE 0
        END AS new_shields,
        CASE
          WHEN last_active_at = today THEN false
          ELSE true
        END AS day_changed,
        longest_streak
      FROM s
    )
    UPDATE users SET
      streak_days     = next.new_streak,
      streak_shields  = next.new_shields,
      longest_streak  = GREATEST(users.longest_streak, next.new_streak),
      last_active_at  = (now() AT TIME ZONE 'UTC')::date,
      sparks_total    = users.sparks_total + ${sparksEarned},
      updated_at      = now()
    FROM next
    WHERE users.id = ${user.id}
    RETURNING users.streak_days, users.longest_streak, users.streak_shields, next.day_changed
  `;

  const streak = streakRows[0] || { streak_days: 1, longest_streak: 1, streak_shields: 2, day_changed: true };

  // Streak-milestone notification — fires once per qualifying day per user.
  // Non-fatal: a notification failure shouldn't break session writes.
  try {
    await maybeCreateStreakMilestone(user.id, streak.streak_days, streak.day_changed);
  } catch (e) { console.error('streak milestone notif failed:', e?.message || e); }

  res.status(200).json({
    ok: true,
    sessionId,
    sparksEarned,
    streak: {
      days:        streak.streak_days,
      longest:     streak.longest_streak,
      shields:     streak.streak_shields,
      dayChanged:  streak.day_changed,
    },
  });
}
