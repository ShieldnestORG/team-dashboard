import { useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { directoryListingsApi, type DirectoryTier } from "../api/directory-listings";

// ---------------------------------------------------------------------------
// Tier definitions — mirrors server/src/services/directory-listings.ts
// ---------------------------------------------------------------------------

interface TierDef {
  slug: DirectoryTier;
  label: string;
  priceCents: number;
  tagline: string;
  features: string[];
  popular?: boolean;
}

const TIERS: TierDef[] = [
  {
    slug: "featured",
    label: "Featured",
    priceCents: 19900,
    tagline: "Stand out with featured placement",
    features: [
      "Featured badge on directory listing",
      "Priority ranking in search results",
      "Highlighted company card",
      "Monthly analytics report",
    ],
  },
  {
    slug: "verified",
    label: "Verified",
    priceCents: 49900,
    tagline: "Verified badge + premium placement",
    features: [
      "Everything in Featured",
      "Verified checkmark badge",
      "Top-3 placement in category",
      "AEO content mentions",
      "Quarterly strategy review",
    ],
    popular: true,
  },
  {
    slug: "boosted",
    label: "Boosted",
    priceCents: 149900,
    tagline: "Maximum visibility + analytics",
    features: [
      "Everything in Verified",
      "Homepage spotlight rotation",
      "Cross-directory promotion",
      "Full analytics dashboard",
      "Dedicated account manager",
      "Custom AEO content campaigns",
    ],
  },
];

function formatPrice(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}/mo`;
}

// ---------------------------------------------------------------------------
// Enroll form — shown inline under a selected tier card
// ---------------------------------------------------------------------------

interface EnrollFormProps {
  tier: TierDef;
  onCancel: () => void;
}

function EnrollForm({ tier, onCancel }: EnrollFormProps) {
  const [companySlug, setCompanySlug] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const slug = companySlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!slug) {
      setError("Company slug is required");
      return;
    }
    if (!email || !email.includes("@")) {
      setError("Enter a valid email address");
      return;
    }

    setLoading(true);
    try {
      const { checkoutUrl } = await directoryListingsApi.enroll({
        companySlug: slug,
        email,
        tier: tier.slug,
        contactName: contactName.trim(),
      });
      window.location.href = checkoutUrl;
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3 border-t pt-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Your name
        </label>
        <Input
          placeholder="Jane Smith"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          disabled={loading}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Company slug <span className="text-muted-foreground">(URL-safe, e.g. my-startup)</span>
        </label>
        <Input
          placeholder="my-startup"
          value={companySlug}
          onChange={(e) => setCompanySlug(e.target.value)}
          disabled={loading}
          autoCorrect="off"
          autoCapitalize="none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Email
        </label>
        <Input
          type="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={loading}>
          {loading ? "Redirecting to checkout…" : `Get Listed — ${formatPrice(tier.priceCents)}`}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function DirectoryPricing() {
  const [activeTier, setActiveTier] = useState<DirectoryTier | null>(null);

  const enterpriseBookingUrl =
    (import.meta as unknown as { env: Record<string, string> }).env.VITE_ENTERPRISE_BOOKING_URL ||
    "mailto:hello@coherencedaddy.com";

  return (
    <div className="mx-auto max-w-5xl p-8">
      {/* Header */}
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold">Get Listed in the AI-Powered Directory</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          532+ companies across Crypto, AI/ML, DeFi, and DevTools — with real-time intelligence
          and AEO content that surfaces your brand in AI search results.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Featured listings rank first in directory.coherencedaddy.com and appear in our
          AI-generated content pipeline.
        </p>
      </header>

      {/* Tier cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((tier) => {
          const isActive = activeTier === tier.slug;
          return (
            <Card
              key={tier.slug}
              className={
                tier.popular
                  ? "border-primary shadow-md"
                  : isActive
                    ? "border-primary"
                    : ""
              }
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{tier.label}</CardTitle>
                  {tier.popular && <Badge>Most Popular</Badge>}
                </div>
                <div className="mt-2 text-3xl font-bold">{formatPrice(tier.priceCents)}</div>
                <p className="text-sm text-muted-foreground">{tier.tagline}</p>
              </CardHeader>
              <CardContent>
                <ul className="mb-5 space-y-2 text-sm">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <span className="mt-0.5 text-primary">&#10003;</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {isActive ? (
                  <EnrollForm tier={tier} onCancel={() => setActiveTier(null)} />
                ) : (
                  <Button
                    className="w-full"
                    variant={tier.popular ? "default" : "outline"}
                    onClick={() => setActiveTier(tier.slug)}
                  >
                    Get Listed
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Cross-sell cards */}
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <Card className="border-muted bg-muted/30">
          <CardContent className="pt-5">
            <p className="text-sm font-medium">Need programmatic access?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The Intel API gives you real-time data on 530+ projects — prices, news, GitHub
              activity, and chain metrics.
            </p>
            <a href="/intel/pricing" className="mt-3 inline-block text-sm underline">
              Check out the Intel API &rarr;
            </a>
          </CardContent>
        </Card>

        <Card className="border-muted bg-muted/30">
          <CardContent className="pt-5">
            <p className="text-sm font-medium">Want a full partner microsite?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The Partner Network drives real traffic to local and digital businesses through
              AI-generated content and redirect tracking.
            </p>
            <a
              href="mailto:hello@coherencedaddy.com?subject=Partner%20Network%20Inquiry"
              className="mt-3 inline-block text-sm underline"
            >
              Inquire about the Partner Network &rarr;
            </a>
          </CardContent>
        </Card>
      </div>

      {/* Enterprise card */}
      <Card className="mt-6 border-muted">
        <CardContent className="pt-5 text-center">
          <p className="font-medium">Enterprise or custom needs?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Multi-directory bundles, white-label integrations, custom analytics dashboards —
            let&apos;s talk.
          </p>
          <a href={enterpriseBookingUrl} className="mt-3 inline-block text-sm underline">
            Contact us &rarr;
          </a>
        </CardContent>
      </Card>

      <footer className="mt-10 text-center text-sm text-muted-foreground">
        <p>
          Listings are reviewed within 24 hours. Stripe handles all billing — cancel any time.
        </p>
      </footer>
    </div>
  );
}
