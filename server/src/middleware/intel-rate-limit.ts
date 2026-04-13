import type { RequestHandler } from "express";

// ---------------------------------------------------------------------------
// Simple in-memory sliding-window rate limiter for Intel API routes
// 60 requests per minute per IP
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 60;

interface Entry {
  count: number;
  resetAt: number;
}

const clients = new Map<string, Entry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of clients) {
    if (now > entry.resetAt) {
      clients.delete(key);
    }
  }
}, 5 * 60_000).unref();

export const intelRateLimit: RequestHandler = (req, res, next) => {
  const ip =
    req.ip ||
    (req.headers["x-forwarded-for"] as string | undefined) ||
    "unknown";

  const now = Date.now();
  let entry = clients.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + WINDOW_MS };
    clients.set(ip, entry);
    return next();
  }

  entry.count += 1;

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Rate limit exceeded", retryAfter });
    return;
  }

  next();
};
