import type { Metadata } from "next";
import Link from "next/link";

const description =
  "Activity Merger stores nothing: no database, no accounts, no copies of your Garmin data.";

export const metadata: Metadata = {
  title: "Privacy",
  description,
  alternates: { canonical: "/privacy" },
  openGraph: { title: "Privacy - Activity Merger", description, url: "/privacy" },
};

export default function Privacy() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/" className="text-sm text-ink-3 hover:text-ink">
          ← Back
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-ink">Privacy</h1>
        <p className="mt-2 text-sm text-ink-3">Last updated 2026-08-16.</p>

        <div className="mt-10 space-y-8 text-sm leading-6 text-ink-2">
          <section>
            <h2 className="text-base font-semibold text-ink">The short version</h2>
            <p className="mt-2">
              There is no database, no file storage and no user accounts. Your Garmin data passes
              through the server while you are using the app and is gone the moment the request
              ends. The only lasting copy of anything is the zip of your original recordings that
              you download to your own machine.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-ink">Your Garmin credentials</h2>
            <p className="mt-2">
              Your email and password are sent to Garmin&apos;s sign-in service to obtain session
              tokens. They are never written to disk or logged. The resulting tokens are encrypted
              and placed in a cookie that only the server can read.
            </p>
            <p className="mt-2">
              That cookie has no expiry date set, which makes it a browser-session cookie: closing
              your browser signs you out. It also expires on its own after 12 hours.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-ink">Your activity data</h2>
            <p className="mt-2">
              To build a preview and to merge, the server downloads the original FIT files from
              Garmin, decodes them in memory, and returns chart data to your browser. Nothing is
              written to disk. When the request finishes, the files are discarded.
            </p>
            <p className="mt-2">
              When you approve a merge, the server deletes the original activities from your Garmin
              account and uploads the merged file. That is the only change ever made to your Garmin
              account.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-ink">Third parties</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>
                <strong className="font-medium text-ink">Garmin Connect</strong> — where your
                activities live. Governed by Garmin&apos;s own privacy policy.
              </li>
              <li>
                <strong className="font-medium text-ink">Vercel</strong> — hosting. Request logs
                (timestamps, status codes, error messages) are retained by Vercel. They contain
                activity IDs, never credentials or activity content.
              </li>
              <li>
                <strong className="font-medium text-ink">Vercel Analytics</strong> — anonymous page
                view counts. No cookies, no cross-site tracking.
              </li>
              <li>
                <strong className="font-medium text-ink">OpenStreetMap / CARTO</strong> — map tiles
                for the route preview. Your browser requests tiles for the area your activity
                covers, so those services see your IP address and the map area.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-ink">Deleting your data</h2>
            <p className="mt-2">
              Sign out, or close your browser. That is the whole procedure — there is nothing on
              our side left to delete.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
