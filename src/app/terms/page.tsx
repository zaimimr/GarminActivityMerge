import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Terms of use for Activity Merger, the tool for merging split workouts on Strava and Garmin.",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "Terms - Activity Merger",
    description:
      "Terms of use for Activity Merger, the tool for merging split workouts on Strava and Garmin.",
    url: "/terms",
  },
};

export default function Terms() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Home
        </Link>
        <h1 className="mt-6 text-3xl font-bold">Terms of use</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated 2026-05-23.</p>

        <section className="prose prose-invert mt-8 space-y-4 text-sm leading-6 text-zinc-300">
          <h2 className="text-lg font-semibold text-zinc-100">No warranty</h2>
          <p>
            Activity Merger is provided as-is. We do our best to preserve your
            data (originals are stored before deletion so you can undo) but we
            make no guarantees of uninterrupted service or data preservation.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">Your responsibility</h2>
          <ul className="ml-5 list-disc space-y-1">
            <li>You authorize merging activities on the accounts you connect.</li>
            <li>You retain ownership of all your activity data.</li>
            <li>You agree not to abuse the service (no scraping, no automated bulk operations beyond personal use).</li>
          </ul>

          <h2 className="text-lg font-semibold text-zinc-100">Third-party platforms</h2>
          <p>
            We act on your behalf against Strava and Garmin Connect. We are not
            affiliated with, endorsed by, or sponsored by either platform.
            Their terms apply to the activity data they hold.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">Termination</h2>
          <p>
            You can disconnect at any time from the dashboard. We can also
            terminate accounts at our discretion for abuse or platform-rules
            violations.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">Liability</h2>
          <p>
            We are not liable for loss of activity data, training disruptions,
            or any indirect damages. Worst case: an activity is deleted on a
            platform and our retry fails. In that case, the original FIT bytes
            are available in our storage for restore; see Privacy for retention.
          </p>

          <h2 className="text-lg font-semibold text-zinc-100">Contact</h2>
          <p>
            <a className="underline" href="mailto:zaim.imran@gmail.com">zaim.imran@gmail.com</a>
          </p>
        </section>
      </div>
    </main>
  );
}
