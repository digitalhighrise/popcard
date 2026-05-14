# Popcard — project context for Claude

You're working on **Popcard**, a study-card SaaS. Users paste a YouTube link or any text → it generates Q&A cards with an LLM → they revise from them.

The marketing site, auth, payments, and the core "popping" flow are all built and live. Iterating now means polish, bug-fixes, and follow-on features (deck library, exports, sharing, mobile polish, prompt tuning).

## Production URL
- **App:** https://www.popcard.me (aliased on Vercel)
- **Vercel project:** `anthonycorby-4171s-projects/popcard`

## Tech stack
- **Frontend:** Static HTML + vanilla JS + CSS (no framework). Pages: `index.html`, `pricing.html`, `examples.html`, `login.html`, `account.html`, `success.html`, `deck.html`.
- **Backend:** Vercel serverless functions in `/api/` (ESM, `"type": "module"` in package.json).
- **DB:** Neon Postgres (via Vercel Marketplace integration). Connection string at `process.env.POSTGRES_URL`. Schema: `users`, `decks`, `cards`.
- **Auth:** Google Identity Services (popup flow). Session = HMAC-signed cookie, 30-day expiry, signed with `SESSION_SECRET`. See `api/_lib/session.js`.
- **Payments:** Stripe Checkout (test mode), webhook handles subscription lifecycle. Pro $9/mo, Team $29/seat/mo.
- **LLM:** OpenAI `gpt-5-mini` for all card generation. Strict JSON schema output. See `api/_lib/llm.js`.
- **Analytics:** Vercel Web Analytics + Speed Insights, gated by consent banner (`cookies.js`).

## Repository layout
```
api/
  _lib/
    db.js            # Neon SQL helper + user CRUD
    decks.js         # Deck/card CRUD, source-hash caching, quota
    llm.js           # OpenAI client + card generation prompt
    session.js       # HMAC cookie sign/verify
    sources.js       # YouTube + plain-text extraction (Supadata fallback)
  auth/
    google.js        # POST: verify Google JWT, upsert user, set cookie
    logout.js        # POST: clear cookie
  checkout.js        # POST: create Stripe Checkout session
  deck.js            # GET: deck + cards by id (auth required)
  me.js              # GET: current user
  pop.js             # POST: the main "pop" action (the product)
  stripe-webhook.js  # POST: Stripe webhook → updates user tier
analytics.js         # track() wrapper around window.va
app.js               # Landing page: mode toggle, paste, pop CTA
auth.js              # Client auth helpers; updates header nav state
cookies.js           # Consent banner + Vercel Analytics loader
deck-view.js         # Deck page: flip card, navigation
examples.js          # Examples page filter chips
page.js              # Generic data-track click dispatcher
styles.css           # All styles, design tokens
vercel.json          # cleanUrls + /deck/:id rewrite
package.json
.gitignore
```

## Core data model
```sql
users (id text PK, email, name, picture, tier, stripe_customer_id, stripe_subscription_id, created_at, updated_at)
decks (id uuid PK, user_id, source_type, source_url, source_hash, title, mode, card_count, model, from_cache, created_at)
cards (id uuid PK, deck_id, position, type, importance, question, answer, hint, source_timestamp_seconds, created_at)
```
Indexes on `decks(user_id, created_at)`, `decks(source_hash, mode)`, `cards(deck_id, position)`.

**Card type enum** (`cards.type`): `idea` (default), `definition`, `example`, `analogy`, `mistake`, `comparison`, `formula`, `action`.
**Importance enum** (`cards.importance`): `must_know`, `good_to_know` (default), `extra_context`.
**Source timestamp** (`cards.source_timestamp_seconds`): integer seconds offset for YouTube cards; null otherwise. Used to deep-link "Watch this moment" on the deck UI.

## How "popping" works
1. User submits `{ input: <url-or-text>, mode: 'simple'|'study' }` to `POST /api/pop`.
2. Detect YouTube URL → `youtube-transcript` (captions) → fallback to Supadata API (transcribes anything).
3. Compute SHA-256 hash of `(mode :: source_url || text)`.
4. Look up `decks` for matching `source_hash` + mode in last 30 days. **Cache hit** → copy that deck's cards into a new deck row for this user, marked `from_cache: true`. **No LLM call**.
5. Cache miss → call `gpt-5-mini` with structured JSON schema. Simple = 6–10 cards, Study = 15–22 cards with hints on harder ones.
6. Insert deck + cards. Return `{ deck, cards }`.
7. Client redirects to `/deck/<id>`.

Quota: free = 10 pops/month, pro/team = 1000/month soft cap. Enforced before the LLM call.

## Environment variables (set in Vercel + mirrored in local `.env.local`)
- `GOOGLE_CLIENT_ID` — OAuth client (popcard project on Google Cloud, project ID `popcard-496213`)
- `STRIPE_SECRET_KEY` — test mode (`sk_test_…`)
- `STRIPE_PRICE_ID_STUDY` — Study tier £3.99/mo GBP (current launch tier)
- `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_TEAM` — legacy USD-priced tiers; kept so any existing subscriptions still resolve via `api/checkout.js`. New customers should always go to Study.
- `STRIPE_WEBHOOK_SECRET` (`whsec_…`)
- `SESSION_SECRET` — 32 hex bytes for HMAC
- `POSTGRES_URL` — Neon (auto-injected by Vercel marketplace integration, marked Sensitive)
- `OPENAI_API_KEY` — sk-proj key
- `SUPADATA_API_KEY` — fallback YouTube transcription (`sd_…`)

`.env.local` is gitignored. To recreate it on a fresh machine, see ONBOARDING.md or run `vercel env pull --environment development` (non-Sensitive vars only; `POSTGRES_URL` needs to be copied from Neon dashboard).

## Local development — this is the default workflow

**Iterate on `localhost:3000` against `vercel dev`. Do NOT deploy to Vercel for testing.** See `~/.claude/projects/-Users-anthonycorby-Desktop-popcard/memory/feedback_local_dev_first.md`.

```bash
npm install        # one time
npm start          # starts vercel dev on port 3000

# Open http://localhost:3000 in any signed-in browser.
# Sign in via Google → land on /account → paste a YouTube link on /
```

**Why `npm start` and not `npm run dev`:** Vercel CLI refuses to run if `package.json` has a `dev` script that invokes `vercel dev` (recursive invocation guard). Naming the script `start` sidesteps that.

If port 3000 is busy: `lsof -ti:3000 | xargs kill` then `npm start` again.

### How env vars work locally
- `.env.local` (gitignored) at project root is the source of truth for local dev.
- `api/_lib/env.js` loads it once at module init when not on Vercel. **Every API module that reads `process.env` at module-load time imports `./env.js` as its first import.** Don't skip this in new modules — without it, Vercel's Sensitive env vars (notably `POSTGRES_URL`) come through empty in dev and the function 500s.
- In production on Vercel, `env.js` is a no-op — env vars are already set by the platform.

### Migrations
SQL migrations live in `tools/migrate-*.mjs`. Each script reads `POSTGRES_URL` from `.env.local` and runs a self-contained `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` batch. To run:
```bash
npm run db:migrate            # runs the Phase 1 migration (idempotent)
# or write a new one and: node tools/migrate-<name>.mjs
```

## Deploy (only when user explicitly asks for it)

Don't deploy as part of a normal iteration. Push to GitHub freely (`main` branch); deploying production is a separate, explicit decision.

```bash
export VERCEL_TOKEN=<token from vercel.com/account/tokens>
./node_modules/.bin/vercel deploy --prod --yes
```

Vercel auto-detected this as Next.js until `framework: null` was set in `vercel.json` — don't undo that.

## What's done
- Marketing site: hero, **modes comparison**, **why-not-ChatGPT comparison table**, **ADHD-friendly section**, how-it-works, trust bar
- Pricing page rewritten: Free + Study £3.99 (Team tier dropped)
- Cookie banner + Vercel Web Analytics integration
- Google sign-in with HMAC session cookie
- Stripe Checkout (Study tier active, legacy Pro/Team kept for any existing subs) with webhook → tier update
- Neon Postgres schema for users/decks/cards with **typed cards** + **importance labels** + **source timestamps**
- `/api/pop` end-to-end: YouTube + text → LLM → typed cards with timestamps
- `/api/refine` for per-card actions: Simplify, Explain like I'm 15, Why does this matter
- Cache-by-source-hash dedupe (saves LLM cost on duplicate sources)
- `/deck/<id>` page with flip-card UI, type+importance badges, "Watch this moment" YouTube links, per-card refine actions, keyboard nav

## Phase 2 — next session priorities (from `/Users/anthonycorby/Desktop/popcard_competitor_feature_brief.md`)
1. **Quiz Mode** inside Study Mode — generated alongside cards, multiple-choice + short-answer, instant feedback, weak-area tracking, retake, results screen. Brief sections 5 + 13.1.6.
2. **Deck library page** — list of past decks for signed-in users. `account.html` can grow into this.
3. **Exports**: Anki `.apkg`, PDF, Markdown.
4. **Spaced repetition** layer over Study decks.

## Phase 3 — later
- PDF / ebook input (file upload + extraction)
- SEO landing pages targeting "YouTube to flashcards", "Quizlet alternative", "ADHD study tool" etc.
- Browser extension "Pop this"
- Tutor / classroom accounts (paused at launch per brief §10)

## Known issues / open follow-ups
- **Live UI sign-in test never completed via automation** (popup/iframe quirks in browser MCP). Backend smoke-tested: `/api/auth/google` returns 400 / 401 / 200 correctly for malformed / invalid / valid credentials. Real human sign-in should work.
- **Quota return code 402** when free-tier user hits 10 pops — UI doesn't have a friendly upgrade modal yet, just shows the raw message.
- **Anki / PDF export** for decks — promised on pricing page but not built.
- **Deck library page** — users can pop decks but there's no list-view to come back to past decks. `account.html` could grow into this.
- **YouTube fallback latency** — Supadata adds 5–20s when captions don't exist. Could show a "transcribing…" sub-status.
- **Preview-env Vercel env vars** — production + development are set, preview is partial because `vercel env add` for preview required a `--value` flag and I shipped without retrying. Preview deploys won't have all secrets.

## Don't break these
- The `framework: null` setting in `vercel.json`.
- The fact that `cleanUrls: true` requires the `/deck/:id` rewrite destination to be `/deck?id=:id`, not `/deck.html?id=:id`.
- The `_setup`/`_migrate` style endpoints are NOT served by Vercel (underscore prefix = excluded). If you need a one-off, name it without an underscore and gate by `SESSION_SECRET`.
- API files in `/api/_lib/` are not endpoints — Vercel skips underscore-prefixed files for routing.

## Style + tone
- Static HTML + vanilla JS by design — no React/Next.js unless the user asks.
- Design tokens in `:root` of `styles.css`. Match the existing visual style for new UI.
- Pop CTA is purple, mode cards have a subtle ring, deck cards are big and bright.
- No emojis in source files unless the user explicitly asks for them.
