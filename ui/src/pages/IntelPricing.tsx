import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { intelBillingApi, type IntelPlan } from "../api/intel-billing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(0)}/mo`;
}

function formatQuota(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

export function IntelPricing() {
  const { data, isLoading } = useQuery({
    queryKey: ["intel-billing", "plans"],
    queryFn: () => intelBillingApi.listPlans(),
  });
  const [email, setEmail] = useState("");
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function subscribe(plan: IntelPlan) {
    setError(null);
    if (!email || !email.includes("@")) {
      setError("Enter a valid email");
      return;
    }
    setSelecting(plan.slug);
    try {
      const { url } = await intelBillingApi.checkout(plan.slug, email);
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
      setSelecting(null);
    }
  }

  const plans = data?.plans ?? [];

  return (
    <div className="mx-auto max-w-6xl p-8">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold">Intel API</h1>
        <p className="mt-2 text-muted-foreground">
          Real-time blockchain, AI, DeFi, and dev-tools intelligence. 500+ tracked projects, hourly price + news updates.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Undercut CoinGecko Pro ($129) and Messari ($30). Directory placement bundled.
        </p>
      </header>

      <div className="mx-auto mb-8 max-w-md">
        <label className="mb-2 block text-sm font-medium">Your email</label>
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
        <div className="grid gap-4 md:grid-cols-4">
          {plans.map((plan) => (
            <Card key={plan.slug} className={plan.slug === "starter" ? "border-primary" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {plan.slug === "starter" && <Badge>Popular</Badge>}
                </div>
                <div className="mt-2 text-3xl font-bold">{formatPrice(plan.priceCents)}</div>
              </CardHeader>
              <CardContent>
                <ul className="mb-4 space-y-2 text-sm">
                  <li>{formatQuota(plan.monthlyRequestQuota)} requests/mo</li>
                  <li>{plan.rateLimitPerMin} req/min</li>
                  {plan.overagePriceCentsPer1k > 0 && (
                    <li className="text-muted-foreground">
                      Overage: ${(plan.overagePriceCentsPer1k / 100).toFixed(2)}/1k
                    </li>
                  )}
                  {plan.overagePriceCentsPer1k === 0 && plan.priceCents === 0 && (
                    <li className="text-muted-foreground">Hard cap (no overage)</li>
                  )}
                </ul>
                {plan.priceCents > 0 ? (
                  <Button
                    className="w-full"
                    onClick={() => subscribe(plan)}
                    disabled={selecting !== null}
                  >
                    {selecting === plan.slug ? "Redirecting…" : "Subscribe"}
                  </Button>
                ) : (
                  <Button className="w-full" variant="outline" disabled>
                    Anonymous
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <footer className="mt-12 text-center text-sm text-muted-foreground">
        <p>
          All plans include access to <code>/api/intel/*</code> — companies, search,
          prices, news, Twitter, GitHub, Reddit, chain metrics.
        </p>
        <p className="mt-1">
          Already subscribed?{" "}
          <a href="/billing/success" className="underline">
            View your key
          </a>
        </p>
      </footer>
    </div>
  );
}
