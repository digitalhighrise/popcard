# Popcard — onboarding for a fresh Claude session

This is a study-card SaaS. Users paste a YouTube link or any text → an LLM turns it into Q&A flashcards. Live at https://www.popcard.me.

Everything below is the state of the build. The user is **Anthony** (anthonycorby@gmail.com).

## Where we are
The full landing site, Google sign-in, Stripe Checkout (Pro $9 / Team $29), Neon Postgres schema, and the core "pop" flow (`/api/pop` → `gpt-5-mini` → deck of cards) are **built, deployed, and verified**. The `/deck/:id` page renders real cards with a flip-Q-to-A interaction.

The last interactive smoke test (live human sign-in) wasn't completed end-to-end via browser automation due to popup/iframe quirks — backend smoke tests all pass. Real human flow should work.

## Critical user preference
**Iterate locally with `vercel dev`, not by deploying to Vercel production.** This was an explicit correction mid-build. Don't run `vercel deploy --prod` unless the user asks. Persistent memory: `~/.claude/projects/-Users-anthonycorby-Desktop-popcard/memory/feedback_local_dev_first.md`.

## How to get the code
```bash
git clone <repo-url>
cd popcard
npm install
```

`.env.local` is gitignored — you'll need to recreate it. The values you need:
- `GOOGLE_CLIENT_ID` — from Google Cloud project `popcard-496213`, OAuth client "Popcard Web"
- `STRIPE_SECRET_KEY` — test-mode sk_test_…
- `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_TEAM` — created in test-mode dashboard
- `STRIPE_WEBHOOK_SECRET` — `whsec_…` from the live webhook endpoint
- `SESSION_SECRET` — 32 random hex bytes (`openssl rand -hex 32` to regenerate, but rotating breaks existing sessions)
- `POSTGRES_URL` — pooled Neon connection. Get from https://vercel.com/dashboard/stores → popcard-db → Quickstart → Show secret.
- `OPENAI_API_KEY` — `sk-proj-…` (the Vercel-stored one had a stray `\n`, that's been fixed)
- `SUPADATA_API_KEY` — YouTube transcription fallback (`sd_…`)

Pull non-Sensitive vars from Vercel:
```bash
./node_modules/.bin/vercel env pull .env.local --environment development
```
Then manually paste `POSTGRES_URL` (Sensitive) from Neon dashboard.

## Run locally
```bash
./node_modules/.bin/vercel dev --listen 3000
# Open http://localhost:3000
```
`package.json` has no `dev` script on purpose — `vercel dev` refuses to recursively invoke itself.

## Architecture in one paragraph
Static HTML + vanilla JS frontend. Vercel serverless functions in `/api/` (ESM modules). Neon Postgres for users/decks/cards. Google Identity Services for sign-in (JWT verified server-side, HMAC cookie session). Stripe Checkout + webhook for subscriptions. OpenAI `gpt-5-mini` with strict JSON schema for card generation. SHA-256 source-hash dedupe cache so two users popping the same YouTube video → one LLM call.

See `CLAUDE.md` in the repo root for the full architecture, file layout, and "don't break these" list.

## What's done vs. pending

**Done:**
- Marketing site (hero, pricing, examples, FAQ, trust bar)
- Cookie banner + Vercel Web Analytics
- Google sign-in + 30-day session cookie
- Stripe Checkout + webhook (Pro/Team)
- `/api/pop` end-to-end (YouTube + text → cards)
- Source-hash caching (30-day window)
- `/deck/<id>` flip-card UI with keyboard nav
- Quota check (free=10/mo, pro/team=1000/mo)

**Pending / known follow-ups:**
- Upgrade-prompt UI when free user hits quota (backend returns 402)
- Anki / PDF / CSV export (promised on pricing page)
- Deck library / past-decks page (account.html could grow into this)
- "Transcribing…" sub-status when Supadata fallback runs
- Preview-environment Vercel env vars (production + development are set; preview is partial)

## First sanity checks when you start

```bash
# DB is reachable
psql "$POSTGRES_URL" -c "SELECT count(*) FROM users;"

# OpenAI key works
curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY" | head

# Local dev server
./node_modules/.bin/vercel dev --listen 3000
# then in another shell:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/   # should be 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/me   # should be 401 (no session cookie)
```

## Tone the user prefers
- Brief, direct.
- Tables for comparisons.
- Honest tradeoff analysis (not just listing options).
- Don't over-confirm — make calls when asked, ask only when the call is unclear.
- No emojis in code files. UI copy is fine.

## When you make changes
Match the existing style: vanilla JS, design tokens in `:root` of `styles.css`, no framework adoption without asking. Files prefixed with underscore in `/api/` are helpers, not endpoints (Vercel skips them).
