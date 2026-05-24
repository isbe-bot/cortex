function createRateLimiter(options = {}) {
  const windowMs = Number(options.windowMs ?? 60_000);
  const maxRequests = Number(options.maxRequests ?? 120);
  const now = options.now || (() => Date.now());
  const buckets = new Map();

  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new Error('rate limit windowMs must be a positive integer');
  }
  if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
    throw new Error('rate limit maxRequests must be a positive integer');
  }

  function keyFor(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
  }

  function check(req) {
    const key = keyFor(req);
    const t = now();
    const current = buckets.get(key);

    if (!current || t >= current.resetAt) {
      buckets.set(key, { count: 1, resetAt: t + windowMs });
      return {
        ok: true,
        limit: maxRequests,
        remaining: maxRequests - 1,
        resetMs: windowMs,
      };
    }

    current.count += 1;
    const remaining = Math.max(0, maxRequests - current.count);
    const resetMs = Math.max(0, current.resetAt - t);

    if (current.count > maxRequests) {
      return {
        ok: false,
        limit: maxRequests,
        remaining: 0,
        resetMs,
        retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
      };
    }

    return {
      ok: true,
      limit: maxRequests,
      remaining,
      resetMs,
    };
  }

  function sweep() {
    const t = now();
    for (const [key, bucket] of buckets.entries()) {
      if (t >= bucket.resetAt) buckets.delete(key);
    }
  }

  return { check, sweep, buckets };
}

module.exports = { createRateLimiter };
