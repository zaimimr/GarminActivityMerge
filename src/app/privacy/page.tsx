import Link from "next/link";

export const metadata = {
  title: "Privacy — Activity Merger",
};

export default function Privacy() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Home
        </Link>
        <h1 className="mt-6 text-3xl font-bold">Privacy</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated 2026-05-23.</p>

        <section className="prose prose-invert mt-8 space-y-4 text-sm leading-6 text-zinc-300">
          <p>
            Activity Merger ("we") lets you combine split workout activities on
            Strava and Garmin Connect. This page describes what we do with your
            data.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">What we store</h2>
          <ul className="ml-5 list-disc space-y-1">
            <li>A user record with the email address you logged in with (if any).</li>
            <li>OAuth tokens for Strava and session tokens for Garmin, so we can act on your behalf.</li>
            <li>A row per merge job: the source activity IDs, the resulting activity ID, success / failure status, timestamps.</li>
            <li>The original FIT files for activities you merge, in private object storage, so the merge can be undone. We delete these automatically 60 days after a successful merge.</li>
            <li>The merged FIT file, in the same private storage, until the same retention window.</li>
          </ul>

          <h2 className="text-lg font-semibold text-zinc-100">What we don't store</h2>
          <ul className="ml-5 list-disc space-y-1">
            <li>Your Strava or Garmin password.</li>
            <li>Activity data beyond what's needed to merge (we don't analyse, sell, or share it).</li>
            <li>Browsing analytics or third-party tracking.</li>
          </ul>

          <h2 className="text-lg font-semibold text-zinc-100">Third parties we send your data to</h2>
          <ul className="ml-5 list-disc space-y-1">
            <li><strong>Strava</strong> and <strong>Garmin Connect</strong> — we read activities from and upload merged activities to these accounts on your behalf.</li>
            <li><strong>Supabase</strong> (database + object storage) — managed Postgres + S3-compatible storage hosted in the EU region.</li>
            <li><strong>Vercel</strong> (hosting) — server logs include your user ID and job IDs but no activity content.</li>
            <li><strong>Sentry</strong> (error reporting, optional) — if enabled, error stack traces and the offending job ID are sent. No FIT content.</li>
          </ul>

          <h2 className="text-lg font-semibold text-zinc-100">Disconnecting</h2>
          <p>
            Disconnect from the dashboard. Once disconnected we cannot act on
            your account, but historical merge job records remain unless you
            request deletion (see contact below). OAuth tokens can also be revoked
            on Strava (Settings → My Apps) or by changing your Garmin password.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">Garmin Connect note</h2>
          <p>
            Garmin does not currently offer a public API for activity write, so
            we sign in to Garmin Connect on your behalf using the same flow as
            the official web site. Garmin's terms apply.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">Contact</h2>
          <p>
            Mail <a className="underline" href="mailto:zaim.imran@gmail.com">zaim.imran@gmail.com</a> to
            request deletion of your data or with any privacy question.
          </p>
        </section>
      </div>
    </main>
  );
}
