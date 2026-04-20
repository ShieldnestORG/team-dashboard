import rateLimit from "express-rate-limit";

// General API: 300 requests per minute per IP
export const globalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: (req) => req.path === "/health" || req.path === "/healthz",
});

// Stricter limit for auth endpoints: 20 per minute per IP
export const authRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts." },
});
