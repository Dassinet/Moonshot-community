// Small fixed-window, in-memory rate limiter. Good enough for a single-instance
// MVP; swap for Redis (or the edge/WAF) when running more than one instance.

export class RateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
    this.sweeper = setInterval(() => this.sweep(), Math.min(windowMs, 60_000));
    this.sweeper.unref();
  }

  // Returns true if the action is allowed, false if the key is over the limit.
  consume(key) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  retryAfterSeconds(key) {
    const entry = this.hits.get(key);
    return entry ? Math.max(1, Math.ceil((entry.reset - Date.now()) / 1000)) : 1;
  }

  sweep() {
    const now = Date.now();
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }
}

export function limit(limiter, keyFn) {
  return (req, res, next) => {
    const key = keyFn(req);
    if (limiter.consume(key)) return next();
    res.set('Retry-After', String(limiter.retryAfterSeconds(key)));
    res.status(429).type('text').send('Too many requests. Please slow down and try again shortly.');
  };
}
