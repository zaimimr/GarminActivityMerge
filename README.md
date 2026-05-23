# Activity Editor

Merge split activities back into one on Strava and Garmin Connect. Useful when
your watch saved a single run as two activities (auto-pause hang, accidental
stop/start, battery die, multisport mis-detection).

Pulls the original FIT files, concatenates the records, re-derives summary
stats, uploads the merged activity, then deletes the originals.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind
- Supabase Postgres for users / tokens / merge jobs
- Strava OAuth + REST API
- `garmin-connect` (reverse-engineered Garmin Connect web API)
- `@garmin/fitsdk` for FIT decode/encode

## Local setup

1. Install deps:

   ```bash
   npm install
   ```

2. Create a Supabase project, then run `supabase/schema.sql` in the SQL editor.

3. Create a Strava API application at <https://www.strava.com/settings/api>:
   - Authorization Callback Domain: `localhost`
   - Note the Client ID and Client Secret.

4. Copy `.env.example` to `.env.local` and fill in:

   ```env
   APP_URL=http://localhost:3000
   SESSION_SECRET=<32+ random chars>
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service role key>
   STRAVA_CLIENT_ID=<id>
   STRAVA_CLIENT_SECRET=<secret>
   ```

5. Run the dev server:

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000>.

## Garmin caveats

The Garmin integration uses [`garmin-connect`](https://www.npmjs.com/package/garmin-connect),
which reverse-engineers the Garmin Connect web SSO flow. This is a gray area
relative to Garmin's ToS. It works today, but:

- MFA is not handled by the current login route.
- Garmin may change the SSO flow at any time and break logins.
- For production use, pursue the official Garmin Connect Developer Program API.

## How the merge works

`src/lib/fit-merge.ts`:

1. Decodes each selected FIT file via the official Garmin FIT JS SDK.
2. Sorts files by first record timestamp, then concatenates record messages
   chronologically and deduplicates by timestamp.
3. Re-cumulates the `distance` field across file boundaries so totals stay
   monotonic.
4. Emits a single output FIT containing: `file_id`, `file_creator`,
   `device_info` (from first file), start event, all records, stop event, a
   synthesized lap, a synthesized session, and an activity record. Totals
   (distance, elapsed, avg/max HR, ascent/descent) are recomputed from the
   merged record stream.

## Production logging (Vercel)

All API routes emit structured JSON logs via `src/lib/logger.ts`. Vercel
automatically parses JSON log lines and exposes the fields as filterable columns
in the dashboard logs view.

To debug an issue:

1. Open Vercel project → **Logs** tab → switch to **Runtime Logs**.
2. Filter by `scope=merge.garmin`, `scope=merge.strava`, or `scope=undo`.
3. Errors carry `code` (one of `DEDUP_REJECTED`, `AUTH_EXPIRED`, etc. — see
   `src/lib/errors.ts`) plus `jobId`.
4. Cross-reference `jobId` against `merge_jobs` in Supabase to inspect the full
   row + storage keys + error column.

Example query in Vercel logs filter bar:

```
scope:"merge.garmin" level:"error"
```

For long-term retention or alerts, point a log drain at Axiom or BetterStack
(both have free tiers, take Vercel's JSON output as-is).

## Roadmap

- MFA / app-password flow for Garmin
- Split activities (the inverse operation)
- Trim warmup / cooldown
- GPS spike removal
- Cross-platform copy (e.g. push a Garmin merge to Strava too)
