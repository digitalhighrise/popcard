import './env.js';
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
  return segments.map((s) => ({
    text: (s.text || '').replace(/\s+/g, ' ').trim(),
    offsetSeconds: (s.offset || 0) / 1000,
    durationSeconds: (s.duration || 0) / 1000,
  })).filter((s) => s.text.length > 0);
}

async function trySupadata(videoId) {
  const key = process.env.SUPADATA_API_KEY;
  if (!key) throw new Error('No SUPADATA_API_KEY configured');

  // Supadata supports both `text=true` (concatenated) and segmented mode (default = segments).
  const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(videoId)}`;
  const r = await fetch(url, { headers: { 'x-api-key': key } });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Supadata ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = await r.json();
  // Supadata response shape: { content: [{ text, offset, duration }] } when segmented
  const items = Array.isArray(data.content) ? data.content : null;
  if (items) {
    return items.map((s) => ({
      text: (s.text || '').replace(/\s+/g, ' ').trim(),
      offsetSeconds: (s.offset || 0) / 1000,
      durationSeconds: (s.duration || 0) / 1000,
    })).filter((s) => s.text.length > 0);
  }
  // Fallback: plain string content
  const text = typeof data.content === 'string' ? data.content : data.text || '';
  if (!text) throw new Error('Supadata returned empty transcript');
  return [{ text: text.trim(), offsetSeconds: 0, durationSeconds: 0 }];
}

export async function fetchYouTubeTranscript(videoId) {
  let segments = [];
  let primaryError = null;
  try {
    segments = await tryYoutubeTranscript(videoId);
  } catch (e) {
    primaryError = e;
  }

  if (!segments.length) {
    try {
      segments = await trySupadata(videoId);
    } catch (fallbackError) {
      const msg = primaryError?.message?.includes('Transcript is disabled')
        ? 'This video has no captions and the transcription fallback also failed.'
        : `Could not fetch transcript: ${(primaryError || fallbackError).message}`;
      throw new Error(msg);
    }
  }

  const text = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();

  return {
    text,
    segments,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    sourceType: 'youtube',
    title: null,
  };
}

export function normalizeText(text) {
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    segments: null,
    sourceUrl: null,
    sourceType: 'text',
    title: null,
  };
}
