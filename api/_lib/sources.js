import { YoutubeTranscript } from 'youtube-transcript';

const YT_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/i,
];

export function detectYouTubeId(input) {
  for (const re of YT_PATTERNS) {
    const m = input.match(re);
    if (m) return m[1];
  }
  return null;
}

async function tryYoutubeTranscript(videoId) {
  const segments = await YoutubeTranscript.fetchTranscript(videoId);
  return segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
}

async function trySupadata(videoId) {
  const key = process.env.SUPADATA_API_KEY;
  if (!key) throw new Error('No SUPADATA_API_KEY configured');

  const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(videoId)}&text=true`;
  const r = await fetch(url, { headers: { 'x-api-key': key } });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Supadata ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = await r.json();
  const text = (data.content || data.text || '').trim();
  if (!text) throw new Error('Supadata returned empty transcript');
  return text;
}

export async function fetchYouTubeTranscript(videoId) {
  // Try the cheap path first (scrapes manual + auto captions if present)
  let text = '';
  let primaryError = null;
  try {
    text = await tryYoutubeTranscript(videoId);
  } catch (e) {
    primaryError = e;
  }

  // Fallback to Supadata (handles videos with no captions by generating them)
  if (!text) {
    try {
      text = await trySupadata(videoId);
    } catch (fallbackError) {
      const msg = primaryError?.message?.includes('Transcript is disabled')
        ? 'This video has no captions and the transcription fallback also failed.'
        : `Could not fetch transcript: ${(primaryError || fallbackError).message}`;
      throw new Error(msg);
    }
  }

  return {
    text,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    sourceType: 'youtube',
    title: null,
  };
}

export function normalizeText(text) {
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    sourceUrl: null,
    sourceType: 'text',
    title: null,
  };
}
