# Deploying earwise

Goes live on **Vercel** (Next.js 16 + your existing hosted Supabase). Your DB is
already on the internet, so deploying means shipping the app and pointing it at
the same Supabase project.

## 0. Before you expose it: the auth gate

`proxy.ts` (Next 16's renamed middleware) gates the app behind Google sign-in:

- **Pages** → unauthenticated users are redirected to `/login`, except the public
  surfaces: `/login`, `/auth`, `/site`, and **`/scan`** (the no-signup instant-scan funnel).
- **`/api/*`** → unauthenticated requests get **401** (so strangers can't trigger
  the Claude-spending routes), except:
  - `/api/projects/demo` — the free, public demo seeder.
  - `/api/cron/run` — the scheduled job, auth'd by `CRON_SECRET` instead.
  - `/api/public/scan` — the public funnel; **intentionally public** but
    self-limited per-IP/day (5) + a global daily backstop (300) via the
    `ip_rate_limits` table. It makes ~2 Haiku calls per scan; the global Claude
    rate limiter bounds total spend regardless.

> The gate has an **escape hatch**: if `NEXT_PUBLIC_SUPABASE_URL` /
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` are unset, nothing is gated (so the app is
> usable before setup). **Setting the anon key in prod is what locks it down.**
> Deploying without it = wide open.

## 1. Environment variables (Vercel → Settings → Environment Variables)

| Var | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | secret |
| `SUPABASE_URL` | server-only |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** — never expose to the browser |
| `NEXT_PUBLIC_SUPABASE_URL` | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public — **required**, flips the auth gate on |
| `CRON_SECRET` | required if you enable the cron (below) |
| `RESEND_API_KEY`, `DIGEST_EMAIL_TO`, `DIGEST_EMAIL_FROM` | optional — digest email |
| `CLAUDE_MIN_GAP_MS` | optional — ms between Claude calls (default `1500` ≈ 40/min). Lower = faster scans, but only safe if your Anthropic rate limit is higher; too low just triggers 429 backoffs. |
| `CLAUDE_MAX_CONCURRENCY` | optional — max Claude calls in flight (default `2`, range 1–8). Doesn't raise the start rate; lets a foreground click overlap a slow in-flight call. |
| `USAGE_CREDITS_BUDGET` | optional — monthly Claude-spend budget per workspace, in credits (1 credit ≈ $0.001). Default `14500` (≈ $14.50). Set to `price × (1 − target margin)`; cost-bearing routes 402 when a workspace exceeds it. Needs the `ip_rate_limits`/`project_usage` migration. |

Your local `.env.local` currently has an **empty** `NEXT_PUBLIC_SUPABASE_ANON_KEY`
— grab it from Supabase → Project Settings → API before you deploy.

## 2. Supabase: Google OAuth for the prod domain

- **Authentication → URL Configuration:** add `https://<your-domain>/auth/callback`
  to the redirect allowlist (the route is `app/auth/callback/route.ts`).
- In your **Google OAuth client**, add the prod domain to authorized origins.

## 3. Database migration

Run `MIGRATIONS.sql` against the prod Supabase project (SQL Editor). The newest
addition is the `ip_rate_limits` table (per-IP cap for the public `/scan`
funnel) — without it the funnel still works but is uncapped per-IP (the global
Claude limiter still bounds spend). The `voice_samples` table anchors
opener/reply voice; without it, voice anchoring falls back to rules only.

## 4. Deploy

1. `git push` to a GitHub repo.
2. vercel.com → New Project → import the repo (auto-detects Next.js).
   - `output: 'standalone'` in `next.config.ts` is for the desktop-exe / self-host
     build; Vercel ignores it.
3. Add the env vars from step 1, then **Deploy**.
4. Add a custom domain in Settings → Domains.

## 5. Scheduled digest (optional)

`vercel.json` already declares the cron:

```json
{ "crons": [{ "path": "/api/cron/run", "schedule": "0 13 * * *" }] }
```

Daily 13:00 UTC. Vercel sends a **GET** with `Authorization: Bearer <CRON_SECRET>`
automatically once `CRON_SECRET` is set; the route has a GET handler that runs the
job (digest from current data — no new scan).

⚠️ **Speed-to-lead needs the POST scan, not this GET.** The Vercel GET cron rebuilds
the digest and re-runs hot-signal detection/alerts, but does **not** ingest new posts
(no `subreddits` body → no scan). So for the Hot-now lane + hot alerts to surface
*fresh* demand, the daily run must be the **POST form below** (with your watchlist
subs) — that's the job that writes new rows the hot path reads. The hot path now reads
both the legacy `posts` table (interactive scans) and the unified `signals` table
(this POST scan), scores by true post time, and only alerts on threads inside the
~48h reply window. Daily GET alone just re-evaluates existing data once a day.

⚠️ **Execution time.** The full job (ingest + synthesis + insights + digest +
email) runs for **minutes** — insights synthesis alone is ~90s. The route sets
`maxDuration = 300` (5 min), which **Vercel Pro** honors. **Hobby hard-caps
functions at 60s**, so the cron will time out there. Options if you're on Hobby:
upgrade to Pro, or skip the cron and trigger synthesis manually from the app.

**To scan specific sources on a schedule** (not just rebuild the digest), use an
external scheduler that POSTs a body instead of Vercel Cron:

```
curl -X POST https://<your-domain>/api/cron/run \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"subreddits":["SaaS","startups"]}'
```

## 6. Smoke test after deploy

- Visit `/` → should redirect to `/login` (gate is on).
- `curl -i https://<your-domain>/api/insights/refresh -X POST` → **401** (gated).
- Sign in with Google → you land in the app.
- (If cron) trigger it once manually with the curl above and confirm `{ ok: true }`.
