import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle } from "lucide-react";

interface BundleEntitlement {
  tier?: string;
  domains?: number;
  planSlug?: string;
}

interface BundlePlan {
  slug: string;
  name: string;
  priceCents: number;
  annualPriceCents: number;
  entitlements: {
    creditscore?: BundleEntitlement | null;
    directoryListing?: BundleEntitlement | null;
    partnerNetwork?: BundleEntitlement | null;
    intelApi?: BundleEntitlement | null;
    allInclusive?: boolean;
  };
}

const BUNDLE_HIGHLIGHTS: Record<string, { color: string; popular: boolean; tagline: string; standaloneValue: number }> = {
  aeo_starter: { color: "border-muted", popular: false, tagline: "Everything you need to start building AEO presence.", standaloneValue: 29700 },
  aeo_growth: { color: "border-primary", popular: true, tagline: "Full-stack AEO — more content, more visibility.", standaloneValue: 79700 },
  aeo_scale: { color: "border-muted", popular: false, tagline: "Maximum AEO coverage for serious operators.", standaloneValue: 219600 },
  all_inclusive: { color: "border-amber-400", popular: false, tagline: "One invoice. Every product. Nothing left out.", standaloneValue: 234600 },
};

const ENTITLEMENT_LABELS: Record<string, Record<string, string>> = {
  creditscore: { starter: "CreditScore Starter monitoring", pro: "CreditScore Pro monitoring (weekly)" },
  directoryListing: { featured: "Directory Featured listing", verified: "Directory Verified listing", boosted: "Directory Boosted listing" },
  partnerNetwork: { proof: "Partner Network Proof (2 mentions/mo)", performance: "Partner Network Performance (8 mentions/mo)", premium: "Partner Network Premium (20 mentions/mo)" },
  intelApi: { pro: "Intel API Pro (500k req/mo)", enterprise: "Intel API Enterprise (5M req/mo)" },
};

function buildFeatures(entitlements: BundlePlan["entitlements"], slug: string): string[] {
  const features: string[] = [];
  if (entitlements.creditscore?.tier) {
    features.push(ENTITLEMENT_LABELS.creditscore?.[entitlements.creditscore.tier] ?? `CreditScore ${entitlements.creditscore.tier}`);
    if ((entitlements.creditscore.domains ?? 1) > 1) {
      features.push(`Up to ${entitlements.creditscore.domains} domains tracked`);
    }
  }
  if (entitlements.directoryListing?.tier) {
    features.push(ENTITLEMENT_LABELS.directoryListing?.[entitlements.directoryListing.tier] ?? `Directory ${entitlements.directoryListing.tier}`);
  }
  if (entitlements.partnerNetwork?.tier) {
    features.push(ENTITLEMENT_LABELS.partnerNetwork?.[entitlements.partnerNetwork.tier] ?? `Partner Network ${entitlements.partnerNetwork.tier}`);
  }
  if (entitlements.intelApi?.planSlug) {
    features.push(ENTITLEMENT_LABELS.intelApi?.[entitlements.intelApi.planSlug] ?? `Intel API ${entitlements.intelApi.planSlug}`);
  }
  if (entitlements.allInclusive) {
    features.push("Dedicated Sage account manager");
    features.push("Weekly strategy document");
    features.push("Priority support (24hr SLA)");
  }
  if (slug === "all_inclusive") {
    features.push("Annual contract only — 12-month minimum");
  }
  return features;
}

async function fetchBundlePlans(): Promise<{ plans: BundlePlan[] }> {
  const res = await fetch("/api/bundles/plans");
  if (!res.ok) throw new Error("Failed to load plans");
  return res.json() as Promise<{ plans: BundlePlan[] }>;
}

export function Bundles() {
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["bundle-plans"],
    queryFn: fetchBundlePlans,
  });

  async function checkout(slug: string) {
    setError(null);
    if (!email || !email.includes("@")) { setError("Enter a valid email"); return; }
    setLoading(slug);
    try {
      const res = await fetch("/api/bundles/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, email, interval }),
      });
      const json = await res.json() as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? "Checkout failed");
      window.location.href = json.url;
    } catch (err) {
      setError((err as Error).message);
      setLoading(null);
    }
  }

  const plans = data?.plans ?? [];

  return (
    <div className="mx-auto max-w-6xl p-8">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold">Bundle Packages</h1>
        <p className="mt-2 text-muted-foreground max-w-xl mx-auto">
          One invoice. Multiple products. CreditScore + Directory Listing + Partner Network — bundled
          at up to 41% off vs. buying separately.
        </p>
      </header>

      {/* Billing interval toggle */}
      <div className="mb-6 flex justify-center gap-2">
        <button
          onClick={() => setInterval("monthly")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${interval === "monthly" ? "bg-primary text-primary-foreground" : "border text-muted-foreground hover:bg-muted"}`}
        >
          Monthly
        </button>
        <button
          onClick={() => setInterval("annual")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${interval === "annual" ? "bg-primary text-primary-foreground" : "border text-muted-foreground hover:bg-muted"}`}
        >
          Annual <span className="ml-1 text-xs text-green-600 font-semibold">Save ~20%</span>
        </button>
      </div>

      {/* Email input */}
      <div className="mx-auto mb-8 max-w-sm">
        <label className="mb-1.5 block text-sm font-medium">Your email</label>
        <Input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      {isLoading ? (
        <p className="text-center text-muted-foreground">Loading plans…</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const meta = BUNDLE_HIGHLIGHTS[plan.slug] ?? { color: "border-muted", popular: false, tagline: "", standaloneValue: 0 };
            const displayPrice = interval === "annual" ? plan.annualPriceCents : plan.priceCents;
            const savings = meta.standaloneValue > 0
              ? Math.round((1 - displayPrice / meta.standaloneValue) * 100)
              : 0;
            const features = buildFeatures(plan.entitlements, plan.slug);
            return (
              <Card key={plan.slug} className={meta.color}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{plan.name}</CardTitle>
                    {meta.popular && <Badge className="shrink-0">Popular</Badge>}
                  </div>
                  <div className="mt-1">
                    <span className="text-3xl font-bold">${(displayPrice / 100).toFixed(0)}</span>
                    <span className="text-sm text-muted-foreground">/mo</span>
                  </div>
                  {savings > 0 && (
                    <p className="text-xs text-green-600 font-medium">Save {savings}% vs. buying separately</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">{meta.tagline}</p>
                </CardHeader>
                <CardContent>
                  <ul className="mb-4 space-y-1.5">
                    {features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs">
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    size="sm"
                    variant={meta.popular ? "default" : "outline"}
                    disabled={loading === plan.slug}
                    onClick={() => checkout(plan.slug)}
                  >
                    {loading === plan.slug ? "Redirecting…" : `Get ${plan.name}`}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* FAQ */}
      <div className="mt-10 space-y-4 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold text-center">FAQ</h2>
        {[
          ["What if I already have one of the products?", "Your existing subscriptions remain unchanged. A bundle activates the included tiers on your account — you won't be double-charged. Contact support if you want to consolidate."],
          ["Can I cancel any time?", "Monthly bundles cancel at end of the billing period. Annual bundles (All-Inclusive) have a 12-month minimum commitment."],
          ["What's included in AEO Scale vs. All-Inclusive?", "AEO Scale includes Intel API Pro. All-Inclusive upgrades to Intel API Enterprise, adds 3-domain CreditScore tracking, and includes a dedicated Sage account manager with weekly strategy docs."],
        ].map(([q, a]) => (
          <div key={q} className="rounded-lg border p-4">
            <p className="font-medium text-sm">{q}</p>
            <p className="mt-1 text-sm text-muted-foreground">{a}</p>
          </div>
        ))}
      </div>

      <footer className="mt-10 text-center text-sm text-muted-foreground">
        <p>Stripe handles all billing. Cancel any time (monthly) or at end of term (annual).</p>
        <p className="mt-1">Questions? <a href="mailto:hello@coherencedaddy.com" className="underline">hello@coherencedaddy.com</a></p>
      </footer>
    </div>
  );
}
