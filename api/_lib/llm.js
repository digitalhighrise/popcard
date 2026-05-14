import './env.js';
import OpenAI from 'openai';

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const MODEL = 'gpt-5-mini';

const CARD_TYPES = ['idea', 'definition', 'example', 'analogy', 'mistake', 'comparison', 'formula', 'action'];
const IMPORTANCES = ['must_know', 'good_to_know', 'extra_context'];

const CARDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {
      type: 'string',
      description: 'Short, descriptive deck title (max 8 words).',
    },
    summary: {
      type: 'string',
      description: 'One-sentence plain-English summary of what this deck covers.',
    },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: CARD_TYPES },
          importance: { type: 'string', enum: IMPORTANCES },
          question: { type: 'string' },
          answer: { type: 'string' },
          hint: { type: ['string', 'null'] },
          sourceTimestampSeconds: {
            type: ['integer', 'null'],
            description: 'For YouTube sources only: seconds offset of the moment this card refers to.',
          },
        },
        required: ['type', 'importance', 'question', 'answer', 'hint', 'sourceTimestampSeconds'],
      },
    },
  },
  required: ['title', 'summary', 'cards'],
};

const MODE_INSTRUCTIONS = {
  simple: `Generate 6 to 10 cards covering the most useful ideas in plain English.
- Questions are short and direct (max 12 words).
- Answers are concrete and conversational (max 35 words). No academic fluff.
- Aim for "smart friend explaining it to you" energy.
- Skip trivia.
- Importance: most cards "good_to_know"; flag 2-3 "must_know" cards for the very core ideas.
- Use card types appropriately: "idea" for key takeaways, "definition" for terms, "example" for concrete instances, "analogy" for comparisons that aid understanding.
- Hint can be null; only add one if the answer benefits from a nudge.`,

  study: `Generate 15 to 22 cards for serious revision.
- Mix difficulty: roughly a third easy recall, a third applied/conceptual, a third harder synthesis.
- Questions are direct ("What is X?" / "Why does X happen?" / "When does X apply?").
- Answers concise but complete (max 45 words).
- Importance distribution: ~30% must_know (core, exam-worthy), ~50% good_to_know, ~20% extra_context.
- Use the full range of card types where the material supports it: idea, definition, example, analogy, mistake (common confusions), comparison, formula, action (steps to take).
- Include a one-line hint on harder cards; leave hint null otherwise.`,
};

const SYSTEM_PROMPT = `You are Popcard, a study-card generator. You turn source material into colourful, varied learning cards a student or self-learner can actually revise from.

Rules:
- Each card stands alone — readable without context from other cards.
- Questions are direct, never meta ("According to the text...").
- Answers are factually grounded in the source. If the source is vague or off-topic, prefer fewer high-quality cards over filling a quota.
- Never invent facts not present in or directly inferable from the source.
- No duplicate or near-duplicate questions.
- Pick the card "type" that best fits each piece of content. Don't force everything into one type.
- Importance is for the learner, not the writer — label what they genuinely need to remember vs. nice-to-know.
- If the source is a YouTube transcript with timestamps, include sourceTimestampSeconds pointing to the most relevant moment for each card. Otherwise set sourceTimestampSeconds to null.
- Output strict JSON matching the provided schema.`;

function buildUserPrompt({ text, mode, sourceUrl, segments }) {
  const parts = [MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.simple];

  if (sourceUrl) parts.push(`\nSource: ${sourceUrl}`);

  if (segments && segments.length) {
    // Send segments with timestamps so the LLM can attribute each card
    const trimmed = segments.slice(0, 800); // cap
    const lines = trimmed
      .map((s) => `[${Math.round(s.offsetSeconds)}s] ${s.text}`)
      .join('\n');
    parts.push(`\nTimestamped transcript:\n${lines}`);
  } else {
    parts.push(`\nMaterial:\n${text}`);
  }

  return parts.join('');
}

export async function generateCards({ text, mode, sourceUrl, segments }) {
  const userPrompt = buildUserPrompt({ text, mode, sourceUrl, segments });

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'popcard_deck', schema: CARDS_SCHEMA, strict: true },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Empty response from model');
  const parsed = JSON.parse(raw);

  return {
    title: parsed.title,
    summary: parsed.summary,
    cards: parsed.cards,
    model: MODEL,
    usage: completion.usage,
  };
}

const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answer: { type: 'string' },
  },
  required: ['answer'],
};

const REFINE_INSTRUCTIONS = {
  simplify: `Rewrite this answer for someone who finds the original too complex.
- Plain English, short sentences.
- Drop jargon, replace with everyday words.
- Same factual content, easier to parse. Max 35 words.`,

  eli15: `Rewrite this answer as if explaining to a sharp 15-year-old.
- Use a clear analogy or comparison if it helps.
- Keep it accurate, but accessible.
- Max 60 words.`,

  why: `Explain why this matters in practice — what's the real-world significance or use of this idea.
- Max 50 words.
- Concrete, not vague.`,
};

export async function refineCard({ action, question, answer }) {
  const instr = REFINE_INSTRUCTIONS[action];
  if (!instr) throw new Error(`Unknown refine action: ${action}`);

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: `You are Popcard, helping a learner understand a flashcard better. ${instr}` },
      {
        role: 'user',
        content: `Question:\n${question}\n\nOriginal answer:\n${answer}`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'popcard_refine', schema: REFINE_SCHEMA, strict: true },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error('Empty response from model');
  return JSON.parse(raw).answer;
}
