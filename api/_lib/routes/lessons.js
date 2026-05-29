// /api/lessons — the Sprint 3 path + lesson endpoints.
//
// GET  /api/lessons?deckId=<uuid>       → lessons with crown/lock state (path UI)
// GET  /api/lessons?lessonId=<uuid>     → one lesson's ordered cards (lesson screen)
// POST /api/lessons  body: { lessonId, correct, total }
//                                       → records the attempt, bumps crown, returns result
//
// All ownership-scoped via the session uid + the deck join inside the lib.

import '../env.js';
import { getSession } from '../session.js';
import {
  listLessonsWithProgress,
  getLessonCards,
  recordLessonResult,
  generateLessonsForDeck,
} from '../lessons.js';
import { createNotification } from '../notifications.js';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  if (req.method === 'GET')  return handleGet(req, res, session);
  if (req.method === 'POST') return handlePost(req, res, session);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res, session) {
  const lessonId = req.query?.lessonId;
  const deckId = req.query?.deckId;

  if (lessonId) {
    if (!UUID_RE.test(lessonId)) return res.status(400).json({ error: 'Invalid lessonId' });
    const data = await getLessonCards(lessonId, session.uid);
    if (!data) return res.status(404).json({ error: 'Lesson not found' });
    return res.status(200).json({
      lesson: {
        id: data.lesson.id,
        title: data.lesson.title,
        position: data.lesson.position,
        deckId: data.lesson.deck_id,
        deckTitle: data.lesson.deck_title,
        deckMode: data.lesson.deck_mode,
      },
      cards: (data.cards || []).map((c) => ({
        id: c.id,
        position: c.position,
        type: c.type,
        importance: c.importance,
        question: c.question,
        answer: c.answer,
        hint: c.hint,
        sourceTimestampSeconds: c.source_timestamp_seconds,
        mastery: c.mastery,
      })),
    });
  }

  if (deckId) {
    if (!UUID_RE.test(deckId)) return res.status(400).json({ error: 'Invalid deckId' });
    // Lazy-generate lessons if a deck somehow has none yet (older deck the
    // backfill missed, or a race). Cheap + idempotent.
    let lessons = await listLessonsWithProgress(deckId, session.uid);
    if (!lessons.length) {
      await generateLessonsForDeck(deckId);
      lessons = await listLessonsWithProgress(deckId, session.uid);
    }
    return res.status(200).json({ lessons });
  }

  return res.status(400).json({ error: 'Provide deckId or lessonId' });
}

async function handlePost(req, res, session) {
  const { lessonId, correct, total } = req.body || {};
  if (!lessonId || !UUID_RE.test(lessonId)) return res.status(400).json({ error: 'Missing/invalid lessonId' });
  const c = Math.max(0, Number(correct) | 0);
  const t = Math.max(0, Number(total) | 0);
  if (t === 0) return res.status(400).json({ error: 'total must be > 0' });

  const result = await recordLessonResult(session.uid, lessonId, Math.min(c, t), t);
  if (!result) return res.status(404).json({ error: 'Lesson not found' });

  // Crown-up notification (in-app bell). Non-fatal.
  if (result.crownedUp) {
    try {
      await createNotification({
        userId: session.uid,
        kind:   'crown_levelled',
        title:  result.crown >= 5 ? 'Gold crown! 👑' : `Crown level ${result.crown}!`,
        body:   result.crown >= 5
          ? 'You maxed out a lesson. That material is yours for good.'
          : 'A lesson levelled up. Keep climbing the path.',
        link:   '/account',
        data:   { lessonId, crown: result.crown },
      });
    } catch (_) { /* non-fatal */ }
  }

  return res.status(200).json({ ok: true, ...result });
}
