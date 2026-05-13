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
cards (id uuid PK, deck_id, position, question, answer, hint, created_at)
```
Indexes on `decks(user_id, created_at)`, `decks(source_hash, mode)`, `cards(deck_id, position)`.

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
- `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_TEAM`
- `STRIPE_WEBHOOK_SECRET` (`whsec_…`)
- `SESSION_SECRET` — 32 hex bytes for HMAC
- `POSTGRES_URL` — Neon (auto-injected by Vercel marketplace integration, marked Sensitive)
- `OPENAI_API_KEY` — sk-proj key
- `SUPADATA_API_KEY` — fallback YouTube transcription (`sd_…`)

`.env.local` is gitignored. To recreate it on a fresh machine, see ONBOARDING.md or run `vercel env pull --environment development` (non-Sensitive vars only; `POSTGRES_URL` needs to be copied from Neon dashboard).

## Local development
**Important user preference:** iterate locally with `vercel dev`, not by deploying to production. See `~/.claude/projects/-Users-anthonycorby-Desktop-popcard/memory/feedback_local_dev_first.md`.

```bash
npm install
./node_modules/.bin/vercel dev --listen 3000
# Open http://localhost:3000
```

The `package.json` `scripts` is empty on purpose — `vercel dev` refuses to run if there's a `dev` script invoking itself.

## Deploy (only when user explicitly asks)
```bash
export VERCEL_TOKEN=<short-lived token from vercel.com/account/tokens>
./node_modules/.bin/vercel deploy --prod --yes
```

Vercel auto-detected this as Next.js until I set `framework: null` in `vercel.json` — don't undo that.

## What's done
- Marketing site (hero, pricing, examples, how-it-works, trust bar)
- Cookie banner + Vercel Web Analytics integration
- Google sign-in with HMAC session cookie
- Stripe Checkout (Pro/Team) with webhook → tier update
- Neon Postgres schema for users/decks/cards
- `/api/pop` end-to-end: YouTube + text → LLM → cards
- Cache-by-source-hash dedupe (saves LLM cost on duplicate sources)
- `/deck/<id>` page with flip-card UI, keyboard nav

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
