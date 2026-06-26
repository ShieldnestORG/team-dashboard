// Minimal fetch-based Stripe REST client — no npm dependency.
// Kept separate from intel-billing.ts so it can be reused by any service
// that needs to call Stripe (directory listings, future tiers, etc).

const STRIPE_API = "https://api.stripe.com/v1";

export function stripeConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim());
}

// Resolve the secret key for an outbound Stripe call. Callers that need the
// shared Coherence Daddy account (CreditScore/Watchtower/Directory/etc.) pass
// nothing and get STRIPE_SECRET_KEY. Callers that must hit a different Stripe
// account (e.g. University → Starwise) pass an explicit override.
function stripeKey(override?: string): string {
  const k = override ?? process.env.STRIPE_SECRET_KEY;
  if (!k || !k.trim()) throw new Error("STRIPE_SECRET_KEY not configured");
  return k.trim();
}

/**
 * University products bill on a SEPARATE Stripe account (Starwise Ventures),
 * not the shared Coherence Daddy account. Returns the University secret key.
 *
 * FAIL CLOSED by default: the shared-key fallback is allowed ONLY when
 * NODE_ENV is explicitly 'development' or 'test'. For any other value
 * (including unset/empty/'production'/'staging'/typos like 'prod') the
 * University key is REQUIRED — falling back to the shared STRIPE_SECRET_KEY
 * would land University money in the wrong (Coherence Daddy / Exegesis)
 * account, so a missing UNIVERSITY_STRIPE_SECRET_KEY throws instead of
 * silently mischarging.
 *
 * In dev/test we keep the shared-key fallback so local (single-account) work
 * keeps working; returns undefined only if neither is set.
 */
export function universityStripeKey(): string | undefined {
  const uni = process.env.UNIVERSITY_STRIPE_SECRET_KEY?.trim();
  if (uni) return uni;
  const env = process.env.NODE_ENV;
  const isDevOrTest = env === "development" || env === "test";
  if (!isDevOrTest) {
    throw new Error(
      "UNIVERSITY_STRIPE_SECRET_KEY is required in production — refusing to fall back to the shared STRIPE_SECRET_KEY (University money would land in the wrong Stripe account)",
    );
  }
  const shared = process.env.STRIPE_SECRET_KEY?.trim();
  return shared || undefined;
}

function toForm(params: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) {
      parts.push(toForm(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          parts.push(toForm(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          parts.push(
            `${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`,
          );
        }
      });
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

export async function stripeRequest<T = unknown>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  // Optional account override. Defaults to STRIPE_SECRET_KEY (shared CD
  // account). Pass an explicit key to target another Stripe account, e.g.
  // universityStripeKey() for University → Starwise.
  secretKey?: string,
): Promise<T> {
  const url = `${STRIPE_API}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey(secretKey)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (body && method === "POST") {
    (init as { body: string }).body = toForm(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message || text;
    throw new Error(`Stripe ${method} ${path} failed: ${msg}`);
  }
  return json as T;
}

// Stripe webhook signature verification (scheme v1, HMAC-SHA256).
// Duplicated from intel-billing.ts to avoid cross-module coupling.
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyStripeSignature(
  payload: string | Buffer,
  header: string | undefined,
  secret: string,
  toleranceSec = 300,
): boolean {
  if (!header) return false;
  const parts = header.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const signedPayload = `${t}.${
    typeof payload === "string" ? payload : payload.toString("utf8")
  }`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  return ageSec <= toleranceSec;
}
