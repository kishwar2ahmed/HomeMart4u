/**
 * High-concurrency bounded in-memory sliding-window rate limiter.
 * Protects endpoints from credential stuffing, brute force, and denial of service
 * while guaranteeing O(1) memory bounds under heavy traffic spikes.
 */

interface RateLimitRecord {
  timestamps: number[];
}

const MAX_STORE_ENTRIES = 10000;
const rateLimitStore = new Map<string, RateLimitRecord>();

// Clean up stale entries every 2 minutes to prevent memory leaks
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (
        record.timestamps.length === 0 ||
        now - record.timestamps[record.timestamps.length - 1] > 10 * 60 * 1000
      ) {
        rateLimitStore.delete(key);
      }
    }
  }, 2 * 60 * 1000).unref?.();
}

export interface RateLimitConfig {
  /** Maximum number of allowed requests in the time window */
  maxRequests: number;
  /** Window duration in milliseconds (default: 60,000ms = 1 minute) */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
}

export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = { maxRequests: 20, windowMs: 60 * 1000 }
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  let record = rateLimitStore.get(identifier);
  if (!record) {
    // Enforce hard memory cap against distributed IP floods
    if (rateLimitStore.size >= MAX_STORE_ENTRIES) {
      const oldestKey = rateLimitStore.keys().next().value;
      if (oldestKey !== undefined) {
        rateLimitStore.delete(oldestKey);
      }
    }
    record = { timestamps: [] };
    rateLimitStore.set(identifier, record);
  }

  // Filter out timestamps older than current window
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  if (record.timestamps.length >= config.maxRequests) {
    const oldestTimestamp = record.timestamps[0];
    const resetSeconds = Math.max(
      1,
      Math.ceil((oldestTimestamp + config.windowMs - now) / 1000)
    );

    return {
      allowed: false,
      remaining: 0,
      limit: config.maxRequests,
      resetSeconds,
    };
  }

  record.timestamps.push(now);
  const remaining = config.maxRequests - record.timestamps.length;
  const resetSeconds = Math.ceil(config.windowMs / 1000);

  return {
    allowed: true,
    remaining,
    limit: config.maxRequests,
    resetSeconds,
  };
}

/**
 * Extracts a client IP from NextRequest headers for rate limiting.
 * Prefers platform-verified headers (x-real-ip / cf-connecting-ip) and the
 * rightmost proxy-appended entry in x-forwarded-for to prevent client spoofing.
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip");
  if (realIp) {
    const clean = realIp.trim().slice(0, 64);
    if (/^[0-9a-fA-F.:]+$/.test(clean)) {
      return clean;
    }
  }

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0 && ip.length <= 64 && /^[0-9a-fA-F.:]+$/.test(ip));
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  return "127.0.0.1";
}
