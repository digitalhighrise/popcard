// Local-dev safety net: vercel dev does NOT inject Sensitive env vars
// (e.g. Vercel-marketplace-provisioned POSTGRES_URL). This file loads
// .env.local at the project root once, on first import, and populates any
// env vars that aren't already set. Production (deployed to Vercel) is a
// no-op because process.env is already populated by the platform.
import fs from 'node:fs';
import path from 'node:path';

let loaded = false;

function loadEnvLocal() {
  if (loaded) return;
  loaded = true;

  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV === 'production') return;

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, '.env.local');
    if (fs.existsSync(p)) {
      const txt = fs.readFileSync(p, 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (!m) continue;
        const k = m[1];
        let v = m[2];
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

loadEnvLocal();
