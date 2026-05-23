import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <h1 className="text-5xl font-bold tracking-tight">
          Merge split activities.
        </h1>
        <p className="mt-6 text-xl text-zinc-400">
          Your watch saved one run as two. Combine them into a single activity
          on Strava or Garmin, and delete the broken originals automatically.
        </p>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          <Link
            href="/api/auth/strava"
            className="block rounded-xl bg-orange-600 px-6 py-5 text-center font-semibold hover:bg-orange-500"
          >
            Connect Strava
          </Link>
          <Link
            href="/connect/garmin"
            className="block rounded-xl bg-blue-600 px-6 py-5 text-center font-semibold hover:bg-blue-500"
          >
            Connect Garmin
          </Link>
        </div>

        <div className="mt-8">
          <Link
            href="/dashboard"
            className="text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline"
          >
            Already connected? Open dashboard →
          </Link>
        </div>

        <section className="mt-20 space-y-6 text-zinc-400">
          <h2 className="text-xl font-semibold text-zinc-200">How it works</h2>
          <ol className="space-y-3 text-sm leading-6">
            <li>1. Connect your Strava and/or Garmin account.</li>
            <li>2. Pick two or more activities you want to merge.</li>
            <li>
              3. We download the original FIT files, merge them into one
              activity, upload the result and delete the originals.
            </li>
          </ol>
          <p className="text-xs text-zinc-500">
            Pre-release. We are not affiliated with Strava or Garmin.
          </p>
        </section>
      </div>
    </main>
  );
}
