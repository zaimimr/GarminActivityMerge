import type { Metadata } from "next";
import Link from "next/link";

const description =
  "Terms for using Activity Merger to merge split Garmin Connect activities.";

export const metadata: Metadata = {
  title: "Terms",
  description,
  alternates: { canonical: "/terms" },
  openGraph: { title: "Terms - Activity Merger", description, url: "/terms" },
};

export default function Terms() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/" className="text-sm text-ink-3 hover:text-ink">
          ← Back
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-ink">Terms</h1>
        <p className="mt-2 text-sm text-ink-3">Last updated 2026-08-16.</p>

        <div className="mt-10 space-y-8 text-sm leading-6 text-ink-2">
          <section>
            <h2 className="text-base font-semibold text-ink">What this is</h2>
            <p className="mt-2">
              A free tool that merges two or more of your own Garmin Connect activities into one.
              It is provided as-is, with no warranty and no uptime guarantee.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-ink">Merging deletes things</h2>
            <p className="mt-2">
              A merge deletes the original activities from your Garmin account and uploads a new
              one in their place. This is the point of the tool, and it cannot be undone from here
              — there is no server-side copy to restore from.
            </p>
            <p className="mt-2">Two safety nets exist, and both are yours to use:</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>
                The zip of original FIT files that downloads to your machine when you confirm,
                before anything is deleted. Re-import them at Garmin Connect → Import Data.
              </li>
              <li>
                Garmin&apos;s own Settings → Account → Recover Deleted Activities, which keeps
                deleted activities for roughly 30 days.
              </li>
            </ul>
            <p className="mt-2">
              You are responsible for keeping that download. We accept no liability for lost
              activity data.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-ink">Relationship to Garmin</h2>
            <p className="mt-2">
              This project is not affiliated with, endorsed by, or sponsored by Garmin. It signs in
              to Garmin Connect on your behalf using the same private API their mobile app uses.
              Garmin may change or block that interface at any time, which would break this tool.
              Using it may conflict with Garmin&apos;s terms of service; that judgement is yours.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-ink">Acceptable use</h2>
            <p className="mt-2">
              Use it on your own Garmin account only. Do not use it to falsify activity data for
              competitions, leaderboards or anything else where the accuracy of a recording
              matters to somebody other than you.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
