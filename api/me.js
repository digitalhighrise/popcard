// GET /api/me                       → { user }
// GET /api/me?include=dashboard     → { user, dashboard: { streak_days, sparks_total, ... } }
//
// The dashboard block is defensive: if the gamification columns haven't been
// added yet (run tools/migrate-dashboard.mjs), every value falls back to
// sensible defaults. The endpoint never errors over a missing column.
import { sql, getUser } from './_lib/db.js';
import { getSession } from './_lib/session.js';
// Consolidated routes (Hobby 12-function limit): /api/config and
// /api/onboarding-prefs are rewritten here with ?_r=config | ?_r=prefs.
import configRoute from './_lib/routes/config.js';
import prefsRoute from './_lib/routes/onboarding-prefs.js';

export default async function handler(req, res) {
  const r = req.query && req.query._r;
  if (r === 'config') return configRoute(req, res);
  if (r === 'prefs') return prefsRoute(req, res);

  const session = getSession(req);
  if (!session) return res.status(401).json({ user: null });

  const user = await getUser(session.uid);
  if (!user) return res.status(401).json({ user: null });

  const payload = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      tier: user.tier,
    },
  };

  // Caller asked for dashboard data
  const include = (req.query && req.query.include) || '';
  if (include.includes('dashboard')) {
    payload.dashboard = await loadDashboard(session.uid);
  }

  res.status(200).json(payload);
}

// Default values for a fresh user / pre-migration DB.
function defaultDashboard() {
  return {
    streak_days: 0,
    longest_streak: 0,
    streak_shields: 2,
    sparks_total: 0,
    daily_goal: 20,
    cards_reviewed_today: 0,
    decks_popped_today: 0,
    minutes_today: 0,
    cards_reviewed_week: 0,
    weekly_bars: [0, 0, 0, 0, 0, 0, 0], // Sun..Sat cards reviewed
    last_active_at: null,
    default_mode: null,       // null = user hasn't picked yet (client falls back to 'study')
  };
}

async function loadDashboard(uid) {
  const out = defaultDashboard();

  // 1. Static columns on users (added by migrate-dashboard.mjs)
  try {
    const rows = await sql`
      SELECT
        streak_days,
        longest_streak,
        streak_shields,
        sparks_total,
        daily_goal,
        last_active_at,
        default_mode
      FROM users
      WHERE id = ${uid}
    `;
    if (rows[0]) {
      const r = rows[0];
      out.streak_days     = r.streak_days     ?? out.streak_days;
      out.longest_streak  = r.longest_streak  ?? out.longest_streak;
      out.streak_shields  = r.streak_shields  ?? out.streak_shields;
      out.sparks_total    = r.sparks_total    ?? out.sparks_total;
      out.daily_goal      = r.daily_goal      ?? out.daily_goal;
      out.last_active_at  = r.last_active_at  ?? out.last_active_at;
      out.default_mode    = r.default_mode    ?? out.default_mode;
    }
  } catch (err) {
    const msg = String(err && err.message || err);
    if (!msg.includes('42703') && !msg.includes('does not exist')) {
      console.error('dashboard users-cols query failed:', err);
    }
    // else: columns missing, keep defaults
  }

  // 2. Today's activity (cards reviewed today, decks popped today) from
  //    daily_activity table. Falls through silently if the table doesn't
  //    exist yet.
  try {
    const today = new Date().toISOString().slice(0, 10);    // YYYY-MM-DD UTC
    const rows = await sql`
      SELECT cards_reviewed, decks_popped
      FROM daily_activity
      WHERE user_id = ${uid} AND activity_date = ${today}
    `;
    if (rows[0]) {
      out.cards_reviewed_today = rows[0].cards_reviewed || 0;
      out.decks_popped_today   = rows[0].decks_popped   || 0;
    }
  } catch (err) {
    const msg = String(err && err.message || err);
    if (!msg.includes('42P01') && !msg.includes('does not exist')) {
      console.error('dashboard daily_activity query failed:', err);
    }
  }

  // 3. Last 7 days for the week-progress chart. Returns one row per day
  //    we've seen activity; missing days get filled with 0 below.
  try {
    const rows = await sql`
      SELECT activity_date, cards_reviewed
      FROM daily_activity
      WHERE user_id = ${uid}
        AND activity_date >= ((now() AT TIME ZONE 'UTC')::date - INTERVAL '6 days')
      ORDER BY activity_date ASC
    `;
    // Build a date→count map keyed by YYYY-MM-DD
    const byDate = new Map();
    let weekSum = 0;
    rows.forEach((r) => {
      const k = (r.activity_date instanceof Date)
        ? r.activity_date.toISOString().slice(0, 10)
        : String(r.activity_date).slice(0, 10);
      byDate.set(k, r.cards_reviewed || 0);
      weekSum += r.cards_reviewed || 0;
    });
    out.cards_reviewed_week = weekSum;
    // weekly_bars: 7 values Sun..Sat for the current week (UTC). Index 0 = Sunday.
    // We give the client the actual day-of-week alignment so the chart's
    // labels (M/T/W/T/F/S/S) match the data.
    const bars = [0, 0, 0, 0, 0, 0, 0];
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const sundayOfThisWeek = new Date(today);
    sundayOfThisWeek.setUTCDate(today.getUTCDate() - today.getUTCDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(sundayOfThisWeek);
      d.setUTCDate(sundayOfThisWeek.getUTCDate() + i);
      const k = d.toISOString().slice(0, 10);
      bars[i] = byDate.get(k) || 0;
    }
    out.weekly_bars = bars;
  } catch (err) {
    const msg = String(err && err.message || err);
    if (!msg.includes('42P01') && !msg.includes('does not exist')) {
      console.error('dashboard weekly query failed:', err);
    }
  }

  // 4. Today's study minutes — sum of session durations in the current UTC
  //    day. Used by the "minutes" quest so it stops being a card-count proxy.
  try {
    const rows = await sql`
      SELECT COALESCE(SUM(duration_ms), 0)::bigint AS total_ms
      FROM study_sessions
      WHERE user_id = ${uid}
        AND completed_at >= (now() AT TIME ZONE 'UTC')::date
    `;
    const totalMs = Number(rows[0]?.total_ms || 0);
    out.minutes_today = Math.round(totalMs / 60000);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (!msg.includes('42P01') && !msg.includes('does not exist')) {
      console.error('dashboard sessions query failed:', err);
    }
  }

  return out;
}
