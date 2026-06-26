import rateLimit from "express-rate-limit";

// General API: 300 requests per minute per IP
export const globalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  // The Intel API (/api/intel/*) has its own plan-aware limiter
  // (intel-rate-limit.ts) that emits the authoritative RateLimit headers per the
  // PRD tiers (free 60 → enterprise 5000 req/min). Exempt those routes here so
  // this flat 300 cap neither mis-advertises the free limit nor silently
  // throttles Pro/Enterprise keys at 300. (intel-billing webhooks are NOT
  // exempted — only the public read API under /api/intel/.)
  skip: (req) =>
    req.path === "/health" ||
    req.path === "/healthz" ||
    req.path === "/api/intel" ||
    req.path.startsWith("/api/intel/"),
});

// Stricter limit for auth endpoints: 20 per minute per IP
export const authRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts." },
});
