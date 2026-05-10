// ---------------------------------------------------------------------------
// One-shot script: create the live Stripe Product + Price for Watchtower.
//
// Idempotent. If a Price with lookup_key=watchtower_monthly already exists,
// the script prints its id and exits without creating anything.
//
// Usage (from repo root):
//
//   STRIPE_SECRET_KEY=sk_live_...  npx tsx scripts/setup-watchtower-stripe-product.ts
//
// The secret key needs `prices:write` and `products:write`. A restricted key
// (`rk_live_*`) works as long as those scopes are granted. The default
// production key in /opt/team-dashboard/.env.production is restricted —
// check its scopes via the Stripe Dashboard before running, or use the
// account's full secret key for this one-time setup.
//
// Output:
//   {
//     "productId": "prod_...",
//     "priceId": "price_...",
//     "lookupKey": "watchtower_monthly",
//     "amount": 2900,
//     "currency": "usd",
//     "interval": "month",
//     "created": true | false   // true = newly created, false = already existed
//   }
// ---------------------------------------------------------------------------

const LOOKUP_KEY = "watchtower_monthly";
const PRODUCT_NAME = "Watchtower";
const PRODUCT_DESCRIPTION =
  "Brand-mention monitor for AI answer engines (ChatGPT, Claude, Perplexity, Gemini). Weekly digest. 25 prompts × 4 engines.";
const STATEMENT_DESCRIPTOR = "CD WATCHTOWER";
const AMOUNT_CENTS = 2900;
const CURRENCY = "usd";
const INTERVAL = "month" as const;

type StripeListResponse<T> = {
  object: "list";
  data: T[];
  has_more: boolean;
};

type StripePrice = {
  id: string;
  active: boolean;
  lookup_key: string | null;
  unit_amount: number;
  currency: string;
  recurring: { interval: string; interval_count: number } | null;
  product: string | { id: string };
};

type StripeProduct = {
  id: string;
  name: string;
  active: boolean;
};

function envSecret(): string {
  const v = process.env.STRIPE_SECRET_KEY?.trim();
  if (!v) {
    throw new Error(
      "STRIPE_SECRET_KEY is required. Pass it on the command line for this one-shot run.",
    );
  }
  if (!v.startsWith("sk_live_") && !v.startsWith("rk_live_") && !v.startsWith("sk_test_")) {
    throw new Error(
      `Unexpected STRIPE_SECRET_KEY prefix: ${v.slice(0, 8)}… (expected sk_/rk_)`,
    );
  }
  return v;
}

async function stripeFetch<T>(
  secret: string,
  method: "GET" | "POST",
  path: string,
  bodyParams?: Record<string, string>,
): Promise<T> {
  const url = `https://api.stripe.com/v1${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
  };
  let body: string | undefined;
  if (method === "POST" && bodyParams) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(bodyParams).toString();
  }
  const res = await fetch(url, { method, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Stripe ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

async function findExistingPrice(secret: string): Promise<StripePrice | null> {
  const search = `lookup_key:'${LOOKUP_KEY}' AND active:'true'`;
  const params = new URLSearchParams({
    query: search,
    limit: "10",
  });
  const out = await stripeFetch<StripeListResponse<StripePrice>>(
    secret,
    "GET",
    `/prices/search?${params.toString()}`,
  );
  // Defensive: lookup_keys are unique within an account but search indexes can
  // lag — confirm by exact match.
  const exact = out.data.find(
    (p) => p.active && p.lookup_key === LOOKUP_KEY,
  );
  return exact ?? null;
}

async function findExistingProductByName(
  secret: string,
): Promise<StripeProduct | null> {
  const params = new URLSearchParams({
    query: `name:'${PRODUCT_NAME}' AND active:'true'`,
    limit: "10",
  });
  const out = await stripeFetch<StripeListResponse<StripeProduct>>(
    secret,
    "GET",
    `/products/search?${params.toString()}`,
  );
  return out.data.find((p) => p.active && p.name === PRODUCT_NAME) ?? null;
}

async function createProduct(secret: string): Promise<StripeProduct> {
  return stripeFetch<StripeProduct>(secret, "POST", "/products", {
    name: PRODUCT_NAME,
    description: PRODUCT_DESCRIPTION,
    statement_descriptor: STATEMENT_DESCRIPTOR,
    "metadata[product]": "watchtower",
    "metadata[plan]": LOOKUP_KEY,
  });
}

async function createPrice(
  secret: string,
  productId: string,
): Promise<StripePrice> {
  return stripeFetch<StripePrice>(secret, "POST", "/prices", {
    product: productId,
    unit_amount: String(AMOUNT_CENTS),
    currency: CURRENCY,
    "recurring[interval]": INTERVAL,
    lookup_key: LOOKUP_KEY,
    nickname: "Watchtower monthly",
    "metadata[plan]": LOOKUP_KEY,
  });
}

async function main() {
  const secret = envSecret();

  // 1. Idempotency check.
  const existing = await findExistingPrice(secret);
  if (existing) {
    const productId =
      typeof existing.product === "string" ? existing.product : existing.product.id;
    process.stdout.write(
      JSON.stringify(
        {
          productId,
          priceId: existing.id,
          lookupKey: LOOKUP_KEY,
          amount: existing.unit_amount,
          currency: existing.currency,
          interval: existing.recurring?.interval ?? null,
          created: false,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  // 2. Reuse an existing Watchtower product if one is sitting there
  // without a lookup-keyed price; otherwise create one.
  let product = await findExistingProductByName(secret);
  if (!product) {
    product = await createProduct(secret);
  }

  // 3. Create the price with the lookup_key.
  const price = await createPrice(secret, product.id);

  process.stdout.write(
    JSON.stringify(
      {
        productId: product.id,
        priceId: price.id,
        lookupKey: LOOKUP_KEY,
        amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring?.interval ?? null,
        created: true,
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
