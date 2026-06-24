// In-process sliding window rate limiter.
// Per-instance: Vercel can run multiple serverless instances in parallel, so
// the effective global limit is limit × instances. For this deployment size
// (low traffic, ≤ ~3 concurrent instances) that is acceptable. Switch to
// @upstash/ratelimit backed by Upstash Redis for a globally-shared limit.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Prune expired buckets every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

/**
 * Returns true if the request is within the rate limit, false if it should
 * be rejected. Increments the counter on every allowed call.
 *
 * @param key      Unique key for this bucket (e.g. "login:1.2.3.4")
 * @param limit    Max requests allowed in the window
 * @param windowMs Window size in milliseconds
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

/** Extracts the best-effort client IP from a Next.js request. */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
}
