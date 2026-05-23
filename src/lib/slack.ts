type SlackBlock = Record<string, unknown>;

const RATE_LIMIT_MS = 60_000;
const recent = new Map<string, number>();

function shouldSend(key: string): boolean {
  const now = Date.now();
  const last = recent.get(key) ?? 0;
  if (now - last < RATE_LIMIT_MS) return false;
  recent.set(key, now);
  if (recent.size > 200) {
    for (const [k, t] of recent) {
      if (now - t > 5 * RATE_LIMIT_MS) recent.delete(k);
    }
  }
  return true;
}

export async function postSlackAlert(opts: {
  title: string;
  scope: string;
  msg: string;
  fields?: Record<string, unknown>;
  level?: "error" | "warn" | "info";
}): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const dedupKey = `${opts.scope}:${opts.title}`;
  if (!shouldSend(dedupKey)) return;

  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "dev";
  const emoji = opts.level === "warn" ? "⚠️" : opts.level === "info" ? "ℹ️" : "🚨";
  const color = opts.level === "warn" ? "#f59e0b" : opts.level === "info" ? "#3b82f6" : "#dc2626";

  const fields = opts.fields ?? {};
  const fieldBlocks = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .slice(0, 10)
    .map(([k, v]) => ({
      title: k,
      value: truncate(typeof v === "string" ? v : JSON.stringify(v), 200),
      short: true,
    }));

  const body = {
    text: `${emoji} ${opts.title}`,
    attachments: [
      {
        color,
        fallback: `${opts.title}: ${opts.msg}`,
        title: opts.title,
        text: truncate(opts.msg, 1500),
        fields: [
          { title: "scope", value: opts.scope, short: true },
          { title: "env", value: env, short: true },
          ...fieldBlocks,
        ],
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  } as { text: string; attachments: Array<SlackBlock> };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // intentional swallow — never let alerting break the request
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
