import { useEffect, useState } from "react";
import { affiliatesApi, getAffiliateToken, type TierResponse } from "@/api/affiliates";
import { AffiliateNav } from "@/components/AffiliateNav";
import {
  CDPage,
  EditorialCard,
  BrutalistCard,
  LabelCaps,
  Mono,
  Cascade,
} from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO, formatDollarsCompact } from "@/lib/cdDesign";
import { TIER_LADDER, formatTierName } from "@/lib/affiliateTiers";

export function AffiliateTiers() {
  const [currentTier, setCurrentTier] = useState<TierResponse | null>(null);
  const [loadingTier, setLoadingTier] = useState(true);
  const hasToken = !!getAffiliateToken();

  useEffect(() => {
    if (!hasToken) {
      setLoadingTier(false);
      return;
    }
    affiliatesApi
      .getTier()
      .then((res) => setCurrentTier(res))
      .catch(() => undefined)
      .finally(() => setLoadingTier(false));
  }, [hasToken]);

  const currentName = currentTier?.current.name.toLowerCase();

  return (
    <CDPage>
      {hasToken ? (
        <AffiliateNav active="/tiers" subtitle="Affiliate" title="Tier Ladder" />
      ) : (
        <header
          className="sticky top-0 z-20 backdrop-blur-md"
          style={{
            backgroundColor: "rgba(14,14,16,0.85)",
            borderBottom: `1px solid ${CD.border}`,
          }}
        >
          <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-6 py-4">
            <a href="/" className="flex items-baseline gap-2" style={{ color: CD.ink }}>
              <span className="text-base font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
                Coherence Daddy
              </span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "0.6875rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: CD.muted,
                }}
              >
                / Tiers
              </span>
            </a>
            <a
              href="/"
              style={{
                fontFamily: FONT_MONO,
                fontSize: "0.6875rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: CD.accent,
              }}
            >
              Apply →
            </a>
          </div>
        </header>
      )}

      <main className="mx-auto w-full max-w-[1200px] px-6 py-12 space-y-10">
        <section className="max-w-3xl">
          <LabelCaps color={CD.accent}>Tier ladder</LabelCaps>
          <h2
            className="mt-3 text-4xl font-bold"
            style={{ letterSpacing: "-0.03em", color: CD.ink, lineHeight: 1.05 }}
          >
            Earn more by growing your network.
          </h2>
          <p className="mt-5 text-base leading-relaxed" style={{ color: CD.muted }}>
            Tiers unlock higher commission rates, exclusive merch, and campaign invitations.
            Progress is tracked automatically based on lifetime commissions earned and active
            partners you've brought in.
          </p>
        </section>

        {!loadingTier && currentTier && (
          <Cascade index={0}>
            <BrutalistCard
              fill={CD.accent}
              borderColor={CD.ink}
              scanLineColor={CD.canvas}
              scanLineOpacity={0.14}
            >
              <div className="px-6 py-6" style={{ color: CD.canvas }}>
                <LabelCaps color={CD.canvas}>Your current tier</LabelCaps>
                <p
                  className="mt-3"
                  style={{
                    fontSize: "clamp(2rem,4vw,3rem)",
                    fontWeight: 700,
                    letterSpacing: "-0.03em",
                    color: CD.canvas,
                    lineHeight: 1.05,
                  }}
                >
                  {formatTierName(currentTier.current.name)}
                </p>
                <p
                  className="mt-2"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "0.875rem",
                    color: CD.canvas,
                    opacity: 0.85,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {(currentTier.current.commissionRate * 100).toFixed(0)}% commission rate
                </p>
                {currentTier.next ? (
                  <p
                    className="mt-3 text-sm"
                    style={{ color: CD.canvas, opacity: 0.85 }}
                  >
                    Next: <strong>{formatTierName(currentTier.next.name)}</strong> at{" "}
                    <Mono style={{ color: CD.canvas }}>
                      {formatDollarsCompact(currentTier.next.minLifetimeCents)}
                    </Mono>{" "}
                    lifetime &amp; {currentTier.next.minActivePartners} active partners.
                  </p>
                ) : (
                  <p className="mt-3 text-sm" style={{ color: CD.canvas, opacity: 0.85 }}>
                    You've reached the top tier. Thank you for being a flagship partner.
                  </p>
                )}
              </div>
            </BrutalistCard>
          </Cascade>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TIER_LADDER.map((tier, i) => {
            const isCurrent = currentName === tier.name;
            return (
              <Cascade key={tier.name} index={i + 1}>
                <article
                  className="h-full"
                  style={{
                    position: "relative",
                    backgroundColor: isCurrent ? "rgba(255,107,74,0.06)" : "rgba(255,255,255,0.025)",
                    border: isCurrent
                      ? `2px solid ${CD.accent}`
                      : `1px solid ${CD.border}`,
                    borderRadius: isCurrent ? 0 : 12,
                    padding: 20,
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    minHeight: 280,
                  }}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: "0.6875rem",
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          color: CD.ink,
                          border: `1px solid ${CD.borderStrong}`,
                          padding: "3px 8px",
                          borderRadius: 4,
                        }}
                      >
                        {formatTierName(tier.name)}
                      </span>
                      {isCurrent && (
                        <span
                          style={{
                            fontFamily: FONT_MONO,
                            fontSize: "0.5625rem",
                            letterSpacing: "0.14em",
                            textTransform: "uppercase",
                            color: CD.accent,
                            backgroundColor: "rgba(255,107,74,0.12)",
                            border: `1px solid rgba(255,107,74,0.40)`,
                            padding: "2px 6px",
                            borderRadius: 4,
                          }}
                        >
                          You
                        </span>
                      )}
                    </div>
                    <p
                      className="mt-4"
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: "2.25rem",
                        fontWeight: 600,
                        letterSpacing: "-0.02em",
                        color: isCurrent ? CD.accent : CD.ink,
                        lineHeight: 1.05,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {(tier.commissionRate * 100).toFixed(0)}%
                    </p>
                    <p className="text-xs" style={{ color: CD.muted }}>
                      commission on every deal
                    </p>
                  </div>

                  <div className="space-y-1 text-xs" style={{ color: CD.muted }}>
                    <p>
                      <Mono style={{ color: CD.ink, fontWeight: 600 }}>
                        {formatDollarsCompact(tier.minLifetimeCents)}
                      </Mono>{" "}
                      lifetime minimum
                    </p>
                    <p>
                      <Mono style={{ color: CD.ink, fontWeight: 600 }}>
                        {tier.minActivePartners}
                      </Mono>{" "}
                      active partners
                    </p>
                  </div>

                  <ul className="space-y-2 text-xs" style={{ color: CD.ink }}>
                    {tier.perks.map((perk) => (
                      <li key={perk} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          style={{
                            marginTop: 6,
                            width: 4,
                            height: 4,
                            borderRadius: 9999,
                            backgroundColor: CD.accent,
                            flexShrink: 0,
                          }}
                        />
                        <span>{perk}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              </Cascade>
            );
          })}
        </section>

        <EditorialCard className="p-6">
          <LabelCaps>Fine print</LabelCaps>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm" style={{ color: CD.muted }}>
            <li>Tier eligibility is recalculated daily.</li>
            <li>
              Active partners are referrals currently on a paid plan with no outstanding clawbacks.
            </li>
            <li>
              Lifetime amount counts approved and paid commissions; held or reversed commissions do not count.
            </li>
            <li>Promotions and merch drops are subject to availability and program rules.</li>
          </ul>
        </EditorialCard>
      </main>
    </CDPage>
  );
}
