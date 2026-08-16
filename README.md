# Activity Merger

Merge split activities back into one on Garmin Connect. Useful when your watch
saved a single run as two activities — auto-pause hang, accidental stop/start,
battery die, multisport mis-detection.

Sign in → pick the recordings → **see the merged activity before you commit to
it** → slide to confirm. Confirming saves the originals to your machine, then
deletes them from Garmin and uploads the merged activity.

## What makes it safe

There is no database, no object storage and no accounts. Nothing about you is
kept server-side.

- **Session** — your Garmin tokens live in an encrypted (JWE) httpOnly cookie
  with no `Max-Age`. Closing the browser signs you out; it also expires after 12
  hours. Credentials go to Garmin and are never written down.
- **Preview before commit** — the preview runs the *real* merge in memory and
  charts the result. What you approve is byte-for-byte what gets uploaded.
- **Your backup, on your machine** — confirming downloads a zip of the untouched
  original FIT files before anything is deleted. That is the only copy that
  survives, by design. Garmin also keeps deleted activities for ~30 days under
  Settings → Account → Recover Deleted Activities.
- **One deliberate action** — the destructive step is a slide-to-confirm, not a
  button a stray click can trigger.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- `@garmin/fitsdk` for FIT decode/encode
- Leaflet + CARTO dark tiles for the route preview
- Hand-rolled SVG charts (no charting dependency)
- No database

## Local setup

```bash
npm install
cp .env.example .env.local     # set SESSION_SECRET
npm run dev
```

Open <http://localhost:3000>.

## How the merge works

`src/lib/fit-merge.ts`:

1. Decodes each selected FIT file via the official Garmin FIT JS SDK.
2. Sorts files by first record timestamp, concatenates record messages
   chronologically, and deduplicates by timestamp (so overlapping recordings
   keep the earliest sample of each second).
3. Re-cumulates the `distance` field across file boundaries so totals stay
   monotonic.
4. Emits a single output FIT containing `file_id`, `file_creator`,
   `device_info`, a start event, all records, a stop event, one synthesized lap,
   one synthesized session and an activity record. Totals are recomputed from
   the merged record stream, falling back to Garmin's server-side numbers when
   the raw records carry no distance (indoor workouts).

`src/lib/fit-streams.ts` decodes a FIT into chart-ready series (elevation, heart
rate, pace, GPS track) plus totals, and measures the gap between consecutive
activities — the unrecorded stretch the merge bridges.

## Talking to Garmin

`src/lib/garmin/` is a small in-repo client for Garmin Connect's mobile API. It
replaced the `garmin-connect` npm package, whose last release was January 2024.

`auth.ts` implements the SSO flow: prime cookies on `/sso/embed` → scrape the
`_csrf` token off `/sso/signin` → post credentials → optionally answer the MFA
challenge → exchange the resulting ticket for an OAuth1 token → exchange that
for the OAuth2 bearer token. `client.ts` uses the bearer token to list
activities, download originals, upload, delete and rename.

Every step raises a typed `AppError` naming what failed, so a network problem
reads as "Could not reach sso.garmin.com" rather than `TypeError: fetch failed`.

### Caveats

This is a reverse-engineered interface, which puts it in a grey area relative to
Garmin's ToS. Garmin can change the flow at any time and break sign-in. If that
happens, the shape of the change is usually visible in
[garth](https://github.com/matin/garth), which tracks the same flow in Python.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | yes | Encrypts the session cookie. `openssl rand -hex 32` |
| `APP_URL` | no | Canonical URL for metadata and the sitemap |
| `GARMIN_CONSUMER_KEY` / `GARMIN_CONSUMER_SECRET` | no | Skip the runtime lookup of Garmin's OAuth1 consumer credentials |

## Tests

```bash
npm test        # merge, stream decoding, gap analysis, warnings
npm run typecheck
npm run lint
```

Tests build synthetic FIT files (`src/test/synthetic-fit.ts`) and run them
through the real encode/decode path — no Garmin account needed.

## Roadmap

- Split activities (the inverse operation)
- Trim warmup / cooldown
- GPS spike removal
