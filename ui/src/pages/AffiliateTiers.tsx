import { useEffect, useState } from "react";
import { affiliatesApi, getAffiliateToken, type TierResponse } from "@/api/affiliates";
import { AffiliateNav } from "@/components/AffiliateNav";
import {
  TIER_LADDER,
  formatDollarsCompact,
  formatTierName,
  tierColorFor,
} from "@/lib/affiliateTiers";

export function AffiliateTiers() {
  const [currentTier, setCurrentTier] = useState<TierResponse | null>(null);
  const [loadingTier, setLoadingTier] = useState(true);

  useEffect(() => {
    // Tiers page is public-ish, but when logged in we show the affiliate's
    // current tier. Don't redirect if there's no token — just render the ladder.
    if (!getAffiliateToken()) {
      setLoadingTier(false);
      return;
    }
    affiliatesApi
      .getTier()
      .then((res) => setCurrentTier(res))
      .catch(() => {
        // Silently ignore — the ladder still renders.
      })
      .finally(() => setLoadingTier(false));
  }, []);

  const currentName = currentTier?.current.name.toLowerCase();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {getAffiliateToken() ? (
        <AffiliateNav active="/tiers" subtitle="Affiliate Program" title="Tier Ladder" />
      ) : (
        <header className="bg-card border-b border-border sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Affiliate Program</p>
              <h1 className="text-lg font-bold text-foreground">Tier Ladder</h1>
            </div>
            <a
              href="/"
              className="text-sm text-[#ff876d] hover:text-[#ff876d]/90 font-medium"
            >
              Apply →
            </a>
          </div>
        </header>
      )}

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <section>
          <h2 className="text-xl font-bold text-foreground">How tiers work</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
            Earn more by growing your network. Tiers unlock higher commission rates,
            exclusive merch, and campaign invitations. Progress is tracked automatically
            based on lifetime commissions earned and active partners you've brought in.
          </p>
        </section>

        {!loadingTier && currentTier && (
          <section className="rounded-xl border border-[#ff876d]/30 bg-[#ff876d]/5 p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-[#ff876d]">
              Your current tier
            </p>
            <p className="mt-1 text-lg font-bold text-foreground">
              {formatTierName(currentTier.current.name)}
              <span className="ml-2 text-xs font-medium text-muted-foreground">
                · {(currentTier.current.commissionRate * 100).toFixed(0)}% commission
              </span>
            </p>
            {currentTier.next ? (
              <p className="text-xs text-muted-foreground mt-1">
                Next tier: {formatTierName(currentTier.next.name)} at{" "}
                {formatDollarsCompact(currentTier.next.minLifetimeCents)} lifetime &amp;{" "}
                {currentTier.next.minActivePartners} active partners.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                You've reached the top tier. Thank you for being a flagship partner.
              </p>
            )}
          </section>
        )}

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TIER_LADDER.map((tier) => {
            const color = tierColorFor(tier.name);
            const isCurrent = currentName === tier.name;
            return (
              <article
                key={tier.name}
                className={`rounded-xl border p-5 flex flex-col gap-4 transition-colors ${
                  isCurrent
                    ? "border-[#ff876d] bg-[#ff876d]/5 shadow-sm"
                    : `${color.border} bg-card`
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${color.badge}`}
                    >
                      {formatTierName(tier.name)}
                    </span>
                    {isCurrent && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#ff876d]/20 text-[#ff876d] border border-[#ff876d]/40">
                        You
                      </span>
                    )}
                  </div>
                  <p className={`mt-3 text-3xl font-bold ${color.text}`}>
                    {(tier.commissionRate * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs text-muted-foreground">commission on every deal</p>
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    <span className="font-medium text-foreground">
                      {formatDollarsCompact(tier.minLifetimeCents)}
                    </span>{" "}
                    lifetime minimum
                  </p>
                  <p>
                    <span className="font-medium text-foreground">
                      {tier.minActivePartners}
                    </span>{" "}
                    active partners
                  </p>
                </div>

                <ul className="space-y-1.5 text-xs text-foreground">
                  {tier.perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-2">
                      <span
                        className={`mt-1 inline-block h-1.5 w-1.5 rounded-full ${color.bg}`}
                        aria-hidden="true"
                      />
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          <h3 className="text-base font-semibold text-foreground mb-2">Fine print</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Tier eligibility is recalculated daily.</li>
            <li>
              Active partners are referrals who are currently on a paid plan with no
              outstanding clawbacks.
            </li>
            <li>
              Lifetime amount counts approved and paid commissions; held or reversed
              commissions do not count.
            </li>
            <li>
              Promotions and merch drops are subject to availability and program rules.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
