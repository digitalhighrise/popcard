import OpenAI from 'openai';

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const MODEL = 'gpt-5-mini';

const CARDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {
      type: 'string',
      description: 'A short, descriptive title for the deck (max 8 words).',
    },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          hint: { type: ['string', 'null'] },
        },
        required: ['question', 'answer', 'hint'],
      },
    },
  },
  required: ['title', 'cards'],
};

const MODE_INSTRUCTIONS = {
  simple: `Generate 6 to 10 cards covering the most important concepts. Questions are short (max 12 words). Answers are clear, concrete, and concise (max 35 words). Hints can be null. Skip trivia. Aim for what a smart friend would actually want to remember.`,
  study: `Generate 15 to 22 cards. Mix difficulty: about a third easy recall, a third applied/conceptual, a third harder synthesis. Include a one-line hint on harder cards. Answers concise but complete (max 45 words). Cover the material comprehensively, not just the highlights.`,
};

const SYSTEM_PROMPT = `You are Popcard, a study-card generator. You turn source material into a deck of high-quality question/answer cards a learner can revise from.

Rules:
- Each card stands alone — readable without context from other cards.
- Questions are direct ("What is X?" / "Why does X happen?" / "When does X apply?"), never meta ("According to the text...").
- Answers are factually grounded in the source. If the source is unclear or off-topic, prefer fewer high-quality cards over filling a quota.
- Never invent facts not present in or directly inferable from the source.
- No duplicate or near-duplicate questions.
- Output strict JSON matching the provided schema.`;

export async function generateCards({ text, mode, sourceUrl }) {
  const userPrompt = [
    MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.simple,
    sourceUrl ? `\nSource: ${sourceUrl}` : '',
    `\nMaterial:\n${text}`,
  ].join('');

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
    cards: parsed.cards,
    model: MODEL,
    usage: completion.usage,
  };
}
