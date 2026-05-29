import { getSession } from '../session.js';
import { refineCard } from '../llm.js';

const ALLOWED_ACTIONS = new Set(['simplify', 'eli15', 'why']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  const { action, question, answer } = req.body || {};
  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  if (typeof question !== 'string' || typeof answer !== 'string' || !question.trim() || !answer.trim()) {
    return res.status(400).json({ error: 'Missing question/answer' });
  }

  try {
    const refined = await refineCard({ action, question, answer });
    res.status(200).json({ answer: refined });
  } catch (e) {
    console.error('refine error', e);
    res.status(502).json({ error: 'llm_error', message: e.message });
  }
}
