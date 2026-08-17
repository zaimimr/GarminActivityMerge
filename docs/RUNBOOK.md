# Runbook

Last updated 2026-08-16.

There is no database and no storage bucket, so most of the old runbook is gone.
What remains is Garmin-side failure.

---

## Sign-in is broken for everyone

Symptom: every login returns `LOGIN_FLOW_CHANGED`, usually "Garmin's sign-in
page looks different than expected" (the `_csrf` scrape failed) or "Garmin
refused the login ticket".

Garmin changed their SSO flow. The fix is in `src/lib/garmin/auth.ts`:

1. Compare against [garth](https://github.com/matin/garth) (`garth/sso.py`),
   which tracks the same flow and is usually updated within days.
2. The parts that drift are the signin query parameters (`SIGNIN_PARAMS`), the
   `_csrf` / ticket regexes, and the MFA endpoint path.
3. `npm test` won't catch this — the login flow has no test double. Verify by
   signing in against a real account.

## "Could not reach sso.garmin.com"

Code `NETWORK`. Either Garmin is down or the deployment has no outbound access
to `garmin.com`. Check Garmin's status, then check whether the host allows
outbound HTTPS to `sso.garmin.com`, `connectapi.garmin.com` and
`thegarth.s3.amazonaws.com`.

If only the S3 lookup fails, set `GARMIN_CONSUMER_KEY` and
`GARMIN_CONSUMER_SECRET` and the app stops calling it.

## "Could not download the original recording" (406)

Garmin's download service negotiates content strictly. `downloadOriginalFit`
asks with `Accept: */*` and retries once with the browser user agent, because a
narrow `Accept` (or the mobile UA alone) gets a 406 instead of the file. If 406
comes back after both attempts, Garmin has changed what the download service
accepts — compare the headers against
[garth](https://github.com/matin/garth)'s `download()` and adjust
`src/lib/garmin/client.ts`.

Nothing is deleted when this fires: it happens during the preview, before any
destructive step.

## "Activity NNN no longer exists on Garmin" (ACTIVITY_GONE)

The activity is deleted, not FIT-less. `downloadOriginalFit` gets a 404 from
download-service and then asks activity-service whether the activity still
exists; only when that also 404s does it report ACTIVITY_GONE.

Usual cause: a previous merge got as far as deleting, then failed. Recovery is
Garmin Connect -> Settings -> Account -> Recover Deleted Activities (~30 days),
or re-importing the originals zip from that earlier run.

Note the deliberate asymmetry: a network or auth failure while checking makes
`activityExists` return true, so a flaky check never tells a user their activity
is gone when it isn't.

## A user's merge failed after the originals were deleted

This is the one genuinely bad case. The merge deletes first because Garmin
rejects an upload that overlaps an existing activity.

The error the user sees already says what to do; repeat it if they ask:

1. Re-import the zip they downloaded in step 1: Garmin Connect → Import Data.
2. Failing that, Garmin Connect → Settings → Account → Recover Deleted
   Activities keeps deletions for roughly 30 days.

There is nothing to restore from on our side — that is the deliberate trade for
holding no user data. Check the logs for `scope=merge` and the `steps` array to
see exactly how far the run got.

## "Garmin rejected the upload as a duplicate"

Code `DEDUP_REJECTED`. Garmin still has an activity overlapping the merged
file's time range — usually a delete that silently didn't take, or the user
merged the same pair twice. Have them check Connect for a leftover original and
delete it, then re-run from the downloaded zip.

## A merged activity shows the wrong average pace or speed

Check `totalTimerTime` vs `totalElapsedTime` in the merged session. Timer time
must exclude the gaps between source recordings: `fit-merge.ts` brackets each
segment with timer start / stop_all events so Garmin reads the gap as a pause.
If timer time equals elapsed time on an activity with a gap, that bracketing
regressed — see the "gap handling" tests in `src/lib/fit-merge.test.ts`.

## A merge produced 0 km

The source recordings carry no `distance` in their records — normal for
treadmill and indoor work, where Garmin computes distance server-side. The
preview warns about this, and `merge-flow.ts` passes Garmin's own totals through
`metricsOverride`. If the merged activity still shows 0 km, check that
`activityDetails` returned a `summaryDTO.distance` for the sources.

## Reading logs

All API routes emit one JSON line per event via `src/lib/logger.ts`:
`{ts, level, service, scope, msg, code?, activityIds?}`. Vercel parses these
into filterable columns.

- `scope:"merge" level:"error"` — failed merges, with the step log attached
- `scope:"auth.login"` — sign-in failures, with the `code` naming the cause
- `code:"LOGIN_FLOW_CHANGED"` — Garmin changed something

Activity IDs are logged. Credentials, tokens and activity content are not.

## Rotating the session secret

`SESSION_SECRET` is the only secret. `openssl rand -hex 32`, update the env,
redeploy. Every signed-in user is signed out immediately — no other effect,
since nothing is stored under the old key.
