// GET /api/config
//
// Returns public, non-sensitive config the front-end needs to bootstrap
// third-party SDKs (currently just PostHog). The PostHog "project API key"
// is designed to be exposed to the browser — it identifies the project, not
// the user — so this endpoint is safe to call without authentication.
//
// Set these in .env.local (and in Vercel for production):
//   POSTHOG_KEY   = phc_xxx                  (your project API key)
//   POSTHOG_HOST  = https://us.i.posthog.com (or https://eu.i.posthog.com)
import '../env.js';

export default function handler(req, res) {
  // Cache for a minute so we don't hammer the function on every page nav.
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).json({
    posthog_key: process.env.POSTHOG_KEY || '',
    posthog_host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  });
}
