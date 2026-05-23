# Runbook

Last updated 2026-05-23.

Quick fixes for things that go wrong in production.

---

## A user reports "0 km" / "merge did nothing"

1. Find the job: Supabase → `merge_jobs` table → filter by `user_id` and recent `created_at`.
2. Run locally: `node scripts/inspect-merged.mjs` and `node scripts/inspect-originals.mjs` (they target the latest job).
3. If sources have `distance=0` in their FIT records, the merge is faithful — the activity was indoor / wrist-stride based. Garmin enriches displayed distance server-side; we now fetch that via `getGarminActivityMetrics` and pass to the merge via `metricsOverride`. Verify the merge included the override.
4. If sources DO have distance but merged shows 0, something's wrong with `mergeFitFiles` — open `src/lib/fit-merge.ts` and add a failing test in `src/lib/fit-merge.test.ts`.

## A merge failed with `DEDUP_REJECTED` after deletes

1. The originals are still in our `originals` Supabase Storage bucket. The user can hit "Restore originals" in the UI, or call `POST /api/undo/<jobId>` manually.
2. The merged FIT is at `${userId}/${jobId}/merged.fit` in the bucket if the user wants to upload it manually.
3. Check Garmin Connect web → Settings → Account → "Recover Deleted Activities" — Garmin keeps deleted activities ~30 days.

## Garmin login broken for everyone

`garmin-connect` reverse-engineers Garmin Connect's SSO. Garmin can change the flow at any time. Likely symptoms: every `loginWithPassword` throws, no users can connect Garmin.

1. Update the lib: `npm install garmin-connect@latest`. The maintainers usually push a fix within days.
2. If no upstream fix exists, look at the [garth Python lib](https://github.com/matin/garth) for the current login flow.
3. Worst case: temporarily disable Garmin in UI by gating the connect button behind a feature flag.

## Garmin's `deleteActivity` looks like it returned 200 but the activity is still there

Already fixed in `src/lib/garmin.ts:deleteGarminActivity` (uses real HTTP DELETE via axios). If you see this again, audit `node_modules/garmin-connect/dist/common/HttpClient.js` for any new method using `X-Http-Method-Override`.

## Strava `export_original` returns 404 for an activity

Activity wasn't originally uploaded as FIT (phone-recorded). The fallback in `src/lib/strava-streams.ts:buildFitFromStravaActivity` builds a FIT from Strava's streams API. If that's also failing, check that the activity has `time` and `latlng` streams (`scripts/diagnose.mjs` against the user's strava activity ids).

## Rate limit complaints

`src/lib/rate-limit.ts` is in-memory per Vercel function instance. If you're hitting limits unfairly:

- Vercel function instances cold-start; bucket resets. Users may see different limits across instances.
- For a stricter / globally-consistent limit, move to Upstash Redis with the @upstash/ratelimit package.

## Rotating secrets

| Secret | Where | How |
|--------|-------|-----|
| `STRAVA_CLIENT_SECRET` | strava.com/settings/api | "Generate New Secret" → update Vercel env + `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Project Settings → API → Rotate secret keys | Replaces immediately; update Vercel env |
| `SESSION_SECRET` | n/a (you set it) | `openssl rand -hex 32`. **Rotating invalidates all sessions** — users must reconnect |
| `CRON_SECRET` | n/a | `openssl rand -hex 32`. Update Vercel env. Vercel cron config auto-uses it. |
| `SENTRY_DSN` | sentry.io | Project settings → Client Keys |

## Restoring originals manually

If the Undo button can't reach the platform (e.g. user disconnected Garmin after the merge), bypass via the storage download endpoint:

```
curl -L -o original.fit \
  -H "Cookie: ae_session=<paste from browser>" \
  -H "x-csrf-token: <paste from cookie>" \
  https://activitymerger.vercel.app/api/jobs/<jobId>/download?which=original&index=0
```

User uploads `original.fit` manually via Garmin Connect web import.

## Storage filling up

Cron at `/api/cron/cleanup-storage` runs daily at 03:17 UTC, deletes originals + merged for `succeeded` jobs older than 60 days.

To run on demand:
```
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://activitymerger.vercel.app/api/cron/cleanup-storage
```

## Database migrations

```
npm run migrate
```

Reads `SUPABASE_DB_URL` from `.env.local`, applies any new files in `supabase/migrations/` that aren't in the `schema_migrations` table yet. Idempotent.

## Reading Vercel logs effectively

All API routes emit JSON: `{ts, level, service, scope, msg, jobId?, code?, userId?, ...}`. Filter examples:

- `scope:"merge.garmin" level:"error"` — all Garmin merge failures
- `code:"DEDUP_REJECTED"` — all dedup-rejected uploads across users
- `jobId:"<uuid>"` — full log trail for a specific job

For long-term retention point Axiom or BetterStack at the Vercel log drain.
