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
  let bucket: Bucket;
  if (!existing) {
    bucket = { tokens: opts.capacity - 1, lastRefill: now };
    buckets.set(key, bucket);
    return { ok: true };
  }
  const elapsed = now - existing.lastRefill;
  const refilled = Math.min(opts.capacity, existing.tokens + elapsed * refillRatePerMs);
  if (refilled < 1) {
    const needed = 1 - refilled;
    const retryMs = needed / refillRatePerMs;
    buckets.set(key, { tokens: refilled, lastRefill: now });
    return { ok: false, retryAfterSec: Math.ceil(retryMs / 1000) };
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
      title: "You're going too fast.",
      hint: `Try again in ${r.retryAfterSec}s.`,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(r.retryAfterSec),
      },
    }
  );
}
