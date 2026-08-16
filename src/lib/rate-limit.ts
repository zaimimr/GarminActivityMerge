type Bucket = { tokens: number; lastRefill: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export function rateLimit(
  key: string,
  opts: { capacity: number; refillPerMinute: number }
): RateLimitResult {
  const now = Date.now();
  const refillRatePerMs = opts.refillPerMinute / 60_000;
  const existing = buckets.get(key);
  if (!existing) {
    buckets.set(key, { tokens: opts.capacity - 1, lastRefill: now });
    return { ok: true };
  }

  const elapsed = now - existing.lastRefill;
  const refilled = Math.min(opts.capacity, existing.tokens + elapsed * refillRatePerMs);
  if (refilled < 1) {
    buckets.set(key, { tokens: refilled, lastRefill: now });
    return { ok: false, retryAfterSec: Math.ceil((1 - refilled) / refillRatePerMs / 1000) };
  }
  buckets.set(key, { tokens: refilled - 1, lastRefill: now });
  return { ok: true };
}

export function rateLimitJson(
  key: string,
  opts: { capacity: number; refillPerMinute: number }
): Response | null {
  const r = rateLimit(key, opts);
  if (r.ok) return null;
  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded",
      code: "RATE_LIMITED",
      title: "Slow down a moment.",
      hint: `Try again in ${r.retryAfterSec}s.`,
    }),
    {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(r.retryAfterSec) },
    }
  );
}

/** Best-effort caller identity for rate limiting. There are no user accounts. */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
