// Add `pinned` column to decks. Run with: node tools/migrate-pinned.mjs
import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/^POSTGRES_URL=(.+)$/m)?.[1]?.replace(/^"|"$/g, '');
if (!url) throw new Error('POSTGRES_URL not found in .env.local');

const sql = neon(url);
await sql`ALTER TABLE decks ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE`;
await sql`CREATE INDEX IF NOT EXISTS idx_decks_user_pinned ON decks(user_id, pinned DESC, created_at DESC)`;
const counts = await sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE pinned)::int AS pinned FROM decks`;
console.log('[migrate-pinned] done', counts[0]);
