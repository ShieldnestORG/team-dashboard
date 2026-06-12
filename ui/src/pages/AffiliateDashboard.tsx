import { useEffect, useState } from "react";
import {
  affiliatesApi,
  getAffiliateToken,
  clearAffiliateToken,
  AffiliateApiError,
  type Affiliate,
  type AffiliateProspect,
  type ClosePreference,
  type FirstTouchStatus,
  type FirstTouchType,
  type LeaderboardResponse,
  type PromoCampaign,
  type RelationshipWarmth,
  type SubmitProspectOptions,
  type TierResponse,
} from "@/api/affiliates";
import { AffiliateNav } from "@/components/AffiliateNav";
import { formatTierName } from "@/lib/affiliateTiers";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CDPage,
  BrutalistCard,
  EditorialCard,
  LabelCaps,
  Mono,
  Cascade,
  CDPrimaryButton,
} from "@/components/cd/CDPrimitives";
import { CD, FONT_MONO, formatDollars } from "@/lib/cdDesign";
import { PROGRAM_RULES } from "@/content/affiliate-program-rules";
import { getGuideState } from "@/lib/learnProgress";

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string; border: string }> = {
  none:      { label: "Queued",    bg: "rgba(255,255,255,0.04)", text: CD.muted,   border: CD.border },
  scraping:  { label: "Scanning",  bg: "rgba(255,255,255,0.04)", text: CD.ink,     border: CD.borderStrong },
  analyzing: { label: "Analyzing", bg: "rgba(255,107,74,0.10)",  text: CD.accent,  border: "rgba(255,107,74,0.35)" },
  complete:  { label: "Ready",     bg: "rgba(74,157,124,0.10)",  text: CD.success, border: "rgba(74,157,124,0.35)" },
  failed:    { label: "Failed",    bg: "rgba(217,67,67,0.10)",   text: CD.danger,  border: "rgba(217,67,67,0.35)" },
};

function OnboardingBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE[status] ?? STATUS_BADGE.none;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5"
      style={{
        backgroundColor: cfg.bg,
        color: cfg.text,
        border: `1px solid ${cfg.border}`,
        borderRadius: 4,
        fontFamily: FONT_MONO,
        fontSize: "0.625rem",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      {cfg.label}
    </span>
  );
}

const TOUCH_TYPE_OPTIONS: { value: FirstTouchType; label: string }[] = [
  { value: "in_person", label: "In-person visit" },
  { value: "call", label: "Phone call" },
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "social_dm", label: "Social DM" },
];

const WARMTH_OPTIONS: { value: RelationshipWarmth; label: string; hint: string }[] = [
  { value: "strong", label: "Strong", hint: "I know them well" },
  { value: "medium", label: "Medium", hint: "We've connected before" },
  { value: "weak", label: "Weak", hint: "Just a brief intro" },
];

const CLOSE_PATH_OPTIONS: { value: ClosePreference; label: string; helper?: string; recommended?: boolean }[] = [
  {
    value: "cd_closes",
    label: "Let Coherence Daddy close it.",
    helper: "Coherence Daddy handles the whole sale. Simplest — recommended.",
    recommended: true,
  },
  {
    value: "affiliate_assists",
    label: "We'll close it together.",
    helper: "You help pitch and follow up; we close together.",
  },
  {
    value: "affiliate_attempts_first",
    label: "I'll attempt first, then hand off.",
    helper: "You lead the conversation, then hand off to us.",
  },
];

// Derived from the canonical rules module — same copy the /program-rules page shows.
const POLICY_STEPS: { title: string; body: string }[] = PROGRAM_RULES.map((r) => ({
  title: r.title,
  body: r.summary,
}));

function todayIsoDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function AffiliateDashboard() {
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [prospects, setProspects] = useState<AffiliateProspect[]>([]);
  const [prospectCount, setProspectCount] = useState(0);
  const [convertedCount, setConvertedCount] = useState(0);
  const [pendingCents, setPendingCents] = useState(0);
  const [approvedCents, setApprovedCents] = useState(0);
  const [scheduledCents, setScheduledCents] = useState(0);
  const [paidCents, setPaidCents] = useState(0);
  const [lifetimeCents, setLifetimeCents] = useState(0);
  const [clawbackBalanceCents, setClawbackBalanceCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [prospectUrl, setProspectUrl] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Optional "lead context" fields
  const [showLeadContext, setShowLeadContext] = useState(false);
  const [firstTouchStatus, setFirstTouchStatus] = useState<FirstTouchStatus | "">("");
  const [warmth, setWarmth] = useState<RelationshipWarmth | "">("");
  const [touchType, setTouchType] = useState<FirstTouchType | "">("");
  const [touchDate, setTouchDate] = useState("");
  const [touchNotes, setTouchNotes] = useState("");
  const [closePref, setClosePref] = useState<ClosePreference>("cd_closes");

  // Policy acceptance
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [policyStep, setPolicyStep] = useState(0);
  const [policyProgress, setPolicyProgress] = useState(0);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyReplay, setPolicyReplay] = useState(false);

  function openPolicyReplay() {
    setPolicyReplay(true);
    setPolicyStep(0);
    setPolicyProgress(0);
    setPolicyError(null);
    setShowPolicyModal(true);
  }

  // Phase 4 widgets
  const [tier, setTier] = useState<TierResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [promoCampaigns, setPromoCampaigns] = useState<PromoCampaign[]>([]);

  // Getting-started panel dismissal (only relevant once the affiliate has graduated)
  const [gettingStartedDismissed, setGettingStartedDismissed] = useState(() => {
    try {
      return localStorage.getItem("affiliateGettingStartedDismissed") === "1";
    } catch {
      return false;
    }
  });

  function dismissGettingStarted() {
    setGettingStartedDismissed(true);
    try {
      localStorage.setItem("affiliateGettingStartedDismissed", "1");
    } catch {
      /* ignore storage failures */
    }
  }

  useEffect(() => {
    if (!getAffiliateToken()) {
      window.location.href = "/";
      return;
    }

    Promise.all([affiliatesApi.me(), affiliatesApi.listProspects({ limit: 10 })])
      .then(([meRes, prospectsRes]) => {
        setAffiliate(meRes.affiliate);
        setProspectCount(meRes.prospectCount);
        setConvertedCount(meRes.convertedCount);
        setPendingCents(meRes.pendingCents ?? 0);
        setApprovedCents(meRes.approvedCents ?? 0);
        setScheduledCents(meRes.scheduledCents ?? 0);
        setPaidCents(meRes.paidCents ?? 0);
        setLifetimeCents(meRes.lifetimeCents ?? 0);
        setClawbackBalanceCents(meRes.clawbackBalanceCents ?? 0);
        setProspects(prospectsRes.prospects);
        if (meRes.affiliate.status === "active" && !meRes.affiliate.policyAcceptedAt) {
          setShowPolicyModal(true);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      })
      .finally(() => setLoading(false));

    affiliatesApi.getTier().then(setTier).catch(() => undefined);
    affiliatesApi.getLeaderboard("month").then(setLeaderboard).catch(() => undefined);
    affiliatesApi
      .listPromoCampaigns()
      .then((r) => setPromoCampaigns(r.campaigns))
      .catch(() => undefined);
  }, []);

  function handleLogout() {
    clearAffiliateToken();
    window.location.href = "/";
  }

  function resetProspectForm() {
    setProspectUrl("");
    setShowLeadContext(false);
    setFirstTouchStatus("");
    setWarmth("");
    setTouchType("");
    setTouchDate("");
    setTouchNotes("");
    setClosePref("cd_closes");
    setSubmitError(null);
  }

  function handleOpenNewClient() {
    if (affiliate && affiliate.status === "active" && !affiliate.policyAcceptedAt) {
      setShowPolicyModal(true);
      return;
    }
    setShowModal(true);
  }

  useEffect(() => {
    if (showPolicyModal) {
      setPolicyStep(0);
      setPolicyError(null);
    }
  }, [showPolicyModal]);

  // 10-second read timer that re-starts on every step transition
  useEffect(() => {
    if (!showPolicyModal) return;
    const STEP_DURATION_MS = 10_000;
    setPolicyProgress(0);
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const p = Math.min(1, elapsed / STEP_DURATION_MS);
      setPolicyProgress(p);
      if (p >= 1) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, [policyStep, showPolicyModal]);

  async function handleAcceptPolicy() {
    if (policyReplay) {
      setShowPolicyModal(false);
      setPolicyReplay(false);
      return;
    }
    setPolicyLoading(true);
    setPolicyError(null);
    try {
      const res = await affiliatesApi.acceptPolicy();
      setAffiliate((prev) => (prev ? { ...prev, policyAcceptedAt: res.acceptedAt } : prev));
      setShowPolicyModal(false);
    } catch (err) {
      setPolicyError(err instanceof Error ? err.message : "Failed to accept policy");
    } finally {
      setPolicyLoading(false);
    }
  }

  async function handleSubmitProspect(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prospectUrl.trim();
    if (!trimmed) return;
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      const options: SubmitProspectOptions = {};
      if (showLeadContext && firstTouchStatus) {
        options.firstTouchStatus = firstTouchStatus;
        if (firstTouchStatus === "yes") {
          if (warmth) options.relationshipWarmth = warmth;
          if (touchType) options.firstTouchType = touchType;
          if (touchDate) options.firstTouchDate = new Date(touchDate).toISOString();
          if (touchNotes.trim()) options.firstTouchNotes = touchNotes.trim().slice(0, 500);
        }
      }
      if (showLeadContext && closePref && closePref !== "cd_closes") {
        options.closePreference = closePref;
      }
      const res = await affiliatesApi.submitProspect(
        trimmed,
        Object.keys(options).length > 0 ? options : undefined,
      );
      setShowModal(false);
      resetProspectForm();
      window.location.href = `/prospects/${res.prospect.slug}`;
    } catch (err) {
      if (err instanceof AffiliateApiError && err.status === 403 && err.code === "POLICY_NOT_ACCEPTED") {
        setShowModal(false);
        setShowPolicyModal(true);
        setSubmitError(null);
      } else {
        setSubmitError(err instanceof Error ? err.message : "Failed to submit prospect");
      }
    } finally {
      setSubmitLoading(false);
    }
  }

  if (loading) {
    return (
      <CDPage>
        <div className="flex items-center justify-center" style={{ minHeight: "100dvh" }}>
          <LabelCaps>Loading dashboard…</LabelCaps>
        </div>
      </CDPage>
    );
  }

  if (error) {
    return (
      <CDPage>
        <div className="flex items-center justify-center px-6" style={{ minHeight: "100dvh" }}>
          <div className="max-w-md text-center">
            <p className="mb-4" style={{ color: CD.danger }}>{error}</p>
            <button
              onClick={handleLogout}
              className="text-sm transition-colors"
              style={{ color: CD.muted }}
              onMouseEnter={(e) => (e.currentTarget.style.color = CD.ink)}
              onMouseLeave={(e) => (e.currentTarget.style.color = CD.muted)}
            >
              Log out
            </button>
          </div>
        </div>
      </CDPage>
    );
  }

  if (!affiliate) return null;

  if (affiliate.status === "pending") {
    const appliedDate = new Date(affiliate.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return (
      <CDPage>
        <header
          className="sticky top-0 z-20 backdrop-blur-md"
          style={{
            backgroundColor: "rgba(14,14,16,0.85)",
            borderBottom: `1px solid ${CD.border}`,
          }}
        >
          <div className="mx-auto flex max-w-lg items-center justify-between px-6 py-4">
            <span className="font-semibold" style={{ color: CD.ink, letterSpacing: "-0.02em" }}>
              Coherence Daddy
            </span>
            <button
              onClick={handleLogout}
              style={{
                fontFamily: FONT_MONO,
                fontSize: "0.6875rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: CD.muted,
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              Log out
            </button>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center px-6 py-20">
          <div className="max-w-md text-center">
            <LabelCaps color={CD.accent}>Application Under Review</LabelCaps>
            <h1
              className="mt-4 text-3xl font-bold"
              style={{ letterSpacing: "-0.03em", color: CD.ink }}
            >
              We're reviewing your application.
            </h1>
            <p className="mt-4 text-base leading-relaxed" style={{ color: CD.muted }}>
              Our team typically responds within 1–2 business days. We'll email you the
              moment you're approved.
            </p>
            <p className="mt-6" style={{ color: CD.mutedSoft, fontFamily: FONT_MONO, fontSize: "0.75rem" }}>
              Applied {appliedDate}
            </p>
            <p className="mt-6 text-sm" style={{ color: CD.muted }}>
              Questions?{" "}
              <a
                href="mailto:info@coherencedaddy.com"
                style={{ color: CD.accent }}
                className="font-medium underline-offset-4 hover:underline"
              >
                info@coherencedaddy.com
              </a>
            </p>
          </div>
        </div>
      </CDPage>
    );
  }

  const liveCampaign = promoCampaigns.find((c) => c.status === "live") ?? null;
  const policyAccepted = Boolean(affiliate.policyAcceptedAt);
  const hasProspects = prospectCount > 0;
  const aeoGuideRead = getGuideState("aeo-vs-seo") === "completed";
  // A brand-new affiliate still needs orientation until they've both accepted
  // the rules and sent their first lead. Once they have, the panel collapses to
  // a small dismissible tip; once dismissed, returning users never see it again.
  const isBrandNew = !policyAccepted || !hasProspects;
  const showGettingStarted = isBrandNew || !gettingStartedDismissed;
  const leaderboardTop5 = (leaderboard?.top ?? []).slice(0, 5);
  const meInTop5 = leaderboard?.me
    ? leaderboardTop5.some((r) => r.rank === leaderboard.me?.rank)
    : false;

  return (
    <CDPage>
      <AffiliateNav
        active="/dashboard"
        subtitle="Affiliate"
        title={affiliate.name}
        trailing={
          <span
            className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1"
            style={{
              fontFamily: FONT_MONO,
              fontSize: "0.6875rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: CD.accent,
              border: `1px solid rgba(255,107,74,0.35)`,
              backgroundColor: "rgba(255,107,74,0.08)",
              borderRadius: 9999,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: 9999,
                backgroundColor: CD.accent,
              }}
            />
            {(parseFloat(affiliate.commissionRate) * 100).toFixed(0)}% commission
          </span>
        }
      />

      <main className="mx-auto w-full max-w-[1200px] px-6 py-10 space-y-8">
        {/* Getting started — guided onboarding for brand-new affiliates */}
        {showGettingStarted && (
          <Cascade index={0}>
            {isBrandNew ? (
              <EditorialCard
                className="p-6 sm:p-7"
                style={{
                  backgroundColor: "rgba(255,107,74,0.05)",
                  border: `1px solid rgba(255,107,74,0.30)`,
                }}
              >
                <LabelCaps color={CD.accent}>Welcome — you're in</LabelCaps>
                <h2
                  className="mt-2 text-2xl font-bold"
                  style={{ color: CD.ink, letterSpacing: "-0.02em" }}
                >
                  Let's get your first lead moving.
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: CD.muted }}>
                  Four quick steps and you're earning. You bring the relationship —
                  we handle the analysis, outreach, and closing. Your job is to point us at
                  great businesses and track them right here.
                </p>

                <ol className="mt-6 space-y-3">
                  <GettingStartedStep
                    n={1}
                    done={policyAccepted}
                    active={!policyAccepted}
                    title="Accept the program rules"
                    body="A 60-second read so you know exactly how credit and closing work."
                    action={
                      !policyAccepted
                        ? { label: "Review rules →", onClick: () => setShowPolicyModal(true) }
                        : undefined
                    }
                  />
                  <GettingStartedStep
                    n={2}
                    done={aeoGuideRead}
                    active={policyAccepted && !aeoGuideRead}
                    title="Read the one guide that matters"
                    body="AEO vs SEO, explained like you're talking to your uncle — the 2-minute read every owner conversation builds on."
                    action={
                      !aeoGuideRead
                        ? {
                            label: "Open the guide →",
                            onClick: () => {
                              window.location.href = "/learn/aeo-vs-seo";
                            },
                          }
                        : undefined
                    }
                  />
                  <GettingStartedStep
                    n={3}
                    done={hasProspects}
                    active={policyAccepted && !hasProspects}
                    title="Submit your first business lead"
                    body="Drop a website. We scan and analyze it in 30–60 seconds and start the intel profile."
                    action={
                      !hasProspects
                        ? { label: "+ New client", onClick: handleOpenNewClient, primary: true }
                        : undefined
                    }
                  />
                  <GettingStartedStep
                    n={4}
                    done={policyAccepted && hasProspects}
                    active={hasProspects}
                    title="Track it & earn"
                    body="Watch each lead move from scan → analysis → conversion below. When a client pays, your commission starts."
                  />
                </ol>

                {policyAccepted && !hasProspects && (
                  <div className="mt-6">
                    <CDPrimaryButton type="button" onClick={handleOpenNewClient}>
                      + New client
                    </CDPrimaryButton>
                  </div>
                )}
              </EditorialCard>
            ) : (
              <div
                className="flex items-center justify-between gap-3 px-4 py-3"
                style={{
                  backgroundColor: "rgba(255,107,74,0.05)",
                  border: `1px solid rgba(255,107,74,0.25)`,
                  borderRadius: 10,
                }}
              >
                <p className="text-sm" style={{ color: CD.muted }}>
                  <span style={{ color: CD.ink, fontWeight: 600 }}>You're all set.</span>{" "}
                  Keep the momentum going — submit another lead anytime with{" "}
                  <button
                    type="button"
                    onClick={handleOpenNewClient}
                    className="underline-offset-4 hover:underline"
                    style={{ color: CD.accent, background: "transparent", border: "none", cursor: "pointer", padding: 0, font: "inherit", fontWeight: 600 }}
                  >
                    + New client
                  </button>
                  .
                </p>
                <button
                  type="button"
                  onClick={dismissGettingStarted}
                  aria-label="Dismiss tip"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "0.6875rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: CD.muted,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}
          </Cascade>
        )}

        {/* Promo banner */}
        {liveCampaign && (
          <Cascade index={0}>
            <a
              href="/promo"
              className="block transition-colors"
              style={{
                position: "relative",
                overflow: "hidden",
                backgroundColor: "rgba(255,107,74,0.06)",
                border: `1px solid rgba(255,107,74,0.35)`,
                borderRadius: 12,
                padding: "16px 20px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,107,74,0.12)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,107,74,0.06)")}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <LabelCaps color={CD.accent}>Live campaign</LabelCaps>
                  <p className="mt-1 text-base font-semibold" style={{ color: CD.ink }}>
                    {liveCampaign.name}
                    <Mono style={{ marginLeft: 8, color: CD.accent }}>
                      #{liveCampaign.hashtag.replace(/^#/, "")}
                    </Mono>
                  </p>
                  {liveCampaign.giveawayPrize && (
                    <p className="mt-1 text-xs" style={{ color: CD.muted }}>
                      Giveaway: {liveCampaign.giveawayPrize}
                    </p>
                  )}
                </div>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "0.6875rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: CD.accent,
                  }}
                >
                  Submit post →
                </span>
              </div>
            </a>
          </Cascade>
        )}

        {/* Hero brutalist stat block — lifetime, pending, paid */}
        <Cascade index={1}>
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Lifetime — flagship coral tile with ScanLines */}
            <BrutalistCard
              fill={CD.accent}
              borderColor={CD.ink}
              scanLineColor={CD.canvas}
              scanLineOpacity={0.14}
              style={{ minHeight: 168 }}
            >
              <a
                href="/payouts"
                className="block px-6 py-6"
                style={{ color: CD.canvas, textDecoration: "none" }}
              >
                <LabelCaps color={CD.canvas}>Lifetime earnings</LabelCaps>
                <p
                  className="mt-3"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "clamp(2rem,4vw,2.75rem)",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    fontVariantNumeric: "tabular-nums",
                    color: CD.canvas,
                    lineHeight: 1.05,
                  }}
                >
                  {formatDollars(lifetimeCents)}
                </p>
                <p
                  className="mt-3"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "0.6875rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: CD.canvas,
                    opacity: 0.7,
                  }}
                >
                  {(parseFloat(affiliate.commissionRate) * 100).toFixed(0)}% of every recurring deal
                </p>
              </a>
            </BrutalistCard>

            {/* Pending */}
            <BrutalistCard fill={CD.surface} borderColor={CD.ink} showScanLines={false}>
              <a
                href="/earnings?status=pending_activation"
                className="block px-6 py-6"
                style={{ color: CD.ink, textDecoration: "none" }}
              >
                <LabelCaps color={CD.accent}>Pending</LabelCaps>
                <p
                  className="mt-3"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "clamp(1.5rem,3vw,2.25rem)",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    fontVariantNumeric: "tabular-nums",
                    color: CD.accent,
                    lineHeight: 1.05,
                  }}
                >
                  {formatDollars(pendingCents)}
                </p>
                <p className="mt-3 text-xs" style={{ color: CD.muted }}>
                  Activates when clients hit their first paid month.
                </p>
              </a>
            </BrutalistCard>

            {/* Paid */}
            <BrutalistCard fill={CD.surface} borderColor={CD.ink} showScanLines={false}>
              <a
                href="/earnings?status=paid"
                className="block px-6 py-6"
                style={{ color: CD.ink, textDecoration: "none" }}
              >
                <LabelCaps color={CD.success}>Paid</LabelCaps>
                <p
                  className="mt-3"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "clamp(1.5rem,3vw,2.25rem)",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    fontVariantNumeric: "tabular-nums",
                    color: CD.success,
                    lineHeight: 1.05,
                  }}
                >
                  {formatDollars(paidCents)}
                </p>
                <p className="mt-3 text-xs" style={{ color: CD.muted }}>
                  Already wired to your account.
                </p>
              </a>
            </BrutalistCard>
          </section>
        </Cascade>

        {/* Secondary stat strip */}
        <Cascade index={2}>
          <section
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            style={{
              borderTop: `1px solid ${CD.border}`,
              borderBottom: `1px solid ${CD.border}`,
              padding: "20px 0",
            }}
          >
            <StatCell label="Prospects" value={prospectCount.toString()} accent={false} />
            <StatCell
              label="Converted"
              value={convertedCount.toString()}
              accent={false}
              color={CD.success}
            />
            <a href="/earnings?status=approved" className="block hover:opacity-90 transition-opacity">
              <StatCell label="Approved" value={formatDollars(approvedCents)} accent={false} mono />
            </a>
            <a href="/earnings?status=scheduled_for_payout" className="block hover:opacity-90 transition-opacity">
              <StatCell label="Scheduled" value={formatDollars(scheduledCents)} accent={false} mono />
            </a>
          </section>
        </Cascade>

        {/* Outstanding clawback balance — money owed back, netted from future payouts */}
        {clawbackBalanceCents > 0 && (
          <Cascade index={2}>
            <a
              href="/payouts"
              className="block p-4 transition-opacity hover:opacity-90"
              style={{
                backgroundColor: "rgba(217,67,67,0.08)",
                border: `1px solid rgba(217,67,67,0.35)`,
                borderRadius: 10,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p style={{ fontFamily: FONT_MONO, fontSize: "0.625rem", letterSpacing: "0.12em", textTransform: "uppercase", color: CD.danger }}>
                    Outstanding clawback
                  </p>
                  <p className="mt-1 text-sm" style={{ color: CD.muted }}>
                    Recovered from your future payouts until cleared.
                  </p>
                </div>
                <span style={{ fontFamily: FONT_MONO, fontSize: "1.25rem", fontWeight: 600, color: CD.danger, fontVariantNumeric: "tabular-nums" }}>
                  {formatDollars(clawbackBalanceCents)}
                </span>
              </div>
            </a>
          </Cascade>
        )}

        {/* Phase 4 widgets — tier + leaderboard */}
        {(tier || leaderboardTop5.length > 0) && (
          <Cascade index={3}>
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {tier && (
                <EditorialCard className="p-5" style={{ position: "relative" }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-3">
                      <span
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: "0.6875rem",
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          color: CD.accent,
                          backgroundColor: "rgba(255,107,74,0.08)",
                          border: `1px solid rgba(255,107,74,0.35)`,
                          padding: "3px 8px",
                          borderRadius: 4,
                        }}
                      >
                        {formatTierName(tier.current.name)}
                      </span>
                      <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                        {(tier.current.commissionRate * 100).toFixed(0)}% commission
                      </Mono>
                    </div>
                    <a
                      href="/tiers"
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: "0.6875rem",
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: CD.accent,
                      }}
                    >
                      Ladder →
                    </a>
                  </div>

                  {tier.next ? (
                    <div className="mt-5 space-y-4">
                      <LabelCaps>Progress to {formatTierName(tier.next.name)}</LabelCaps>
                      {(() => {
                        const lifetimePct = Math.min(
                          1,
                          tier.progress.lifetimeCents /
                            Math.max(1, tier.next.minLifetimeCents),
                        );
                        return (
                          <ProgressRow
                            label="Lifetime"
                            current={`$${(tier.progress.lifetimeCents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                            target={`$${(tier.next.minLifetimeCents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                            pct={lifetimePct}
                          />
                        );
                      })()}
                      {(() => {
                        const partnersPct = Math.min(
                          1,
                          tier.progress.activePartners /
                            Math.max(1, tier.next.minActivePartners),
                        );
                        return (
                          <ProgressRow
                            label="Active partners"
                            current={tier.progress.activePartners.toString()}
                            target={tier.next.minActivePartners.toString()}
                            pct={partnersPct}
                          />
                        );
                      })()}
                    </div>
                  ) : (
                    <p className="mt-5 text-sm" style={{ color: CD.muted }}>
                      You're at the top tier. Nice.
                    </p>
                  )}

                  {tier.current.perks.length > 0 && (
                    <ul className="mt-5 space-y-1.5 text-sm" style={{ color: CD.ink }}>
                      {tier.current.perks.slice(0, 3).map((perk) => (
                        <li key={perk} className="flex items-start gap-2">
                          <span
                            aria-hidden="true"
                            style={{
                              marginTop: 8,
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
                  )}
                </EditorialCard>
              )}

              {leaderboardTop5.length > 0 && (
                <EditorialCard className="p-5">
                  <div className="flex items-center justify-between gap-2">
                    <LabelCaps>Top 5 this month</LabelCaps>
                    <a
                      href="/leaderboard"
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: "0.6875rem",
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: CD.accent,
                      }}
                    >
                      Full board →
                    </a>
                  </div>
                  <ol className="mt-4 space-y-1">
                    {leaderboardTop5.map((row) => {
                      const isMe = leaderboard?.me?.rank === row.rank;
                      return (
                        <li
                          key={`${row.rank}-${row.affiliateId}`}
                          className="flex items-center justify-between gap-2 px-2 py-1.5"
                          style={{
                            backgroundColor: isMe ? "rgba(255,107,74,0.08)" : "transparent",
                            border: isMe ? `1px solid rgba(255,107,74,0.25)` : "1px solid transparent",
                            borderRadius: 6,
                          }}
                        >
                          <span className="flex min-w-0 items-baseline gap-3">
                            <Mono style={{ color: CD.muted, fontSize: "0.75rem", width: 28 }}>
                              #{row.rank}
                            </Mono>
                            <span
                              className="truncate text-sm"
                              style={{ color: isMe ? CD.accent : CD.ink, fontWeight: isMe ? 600 : 500 }}
                            >
                              {row.name}
                              {isMe && (
                                <span
                                  className="ml-2"
                                  style={{
                                    fontFamily: FONT_MONO,
                                    fontSize: "0.625rem",
                                    letterSpacing: "0.14em",
                                    textTransform: "uppercase",
                                    color: CD.accent,
                                  }}
                                >
                                  You
                                </span>
                              )}
                            </span>
                          </span>
                          <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                            ${(row.score / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                          </Mono>
                        </li>
                      );
                    })}
                  </ol>
                  {leaderboard?.me && !meInTop5 && (
                    <p
                      className="mt-3 pt-3 text-xs"
                      style={{ color: CD.muted, borderTop: `1px solid ${CD.border}` }}
                    >
                      You're ranked{" "}
                      <span style={{ color: CD.accent, fontWeight: 600 }}>
                        #{leaderboard.me.rank}
                      </span>
                      .
                    </p>
                  )}
                </EditorialCard>
              )}
            </section>
          </Cascade>
        )}

        {/* Program rules replay */}
        {affiliate.policyAcceptedAt && (
          <div
            className="flex items-center justify-between gap-3 px-4 py-2.5"
            style={{
              backgroundColor: "rgba(255,255,255,0.02)",
              border: `1px solid ${CD.border}`,
              borderRadius: 10,
            }}
          >
            <p className="text-xs" style={{ color: CD.muted }}>
              Program rules accepted{" "}
              {new Date(affiliate.policyAcceptedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
              .
            </p>
            <button
              type="button"
              onClick={openPolicyReplay}
              style={{
                fontFamily: FONT_MONO,
                fontSize: "0.6875rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: CD.accent,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Review rules →
            </button>
          </div>
        )}

        {/* Primary action — submit a lead */}
        <Cascade index={4}>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <button
              onClick={handleOpenNewClient}
              style={{
                position: "relative",
                overflow: "hidden",
                textAlign: "left",
                padding: "24px 24px",
                background: CD.surface,
                border: `2px solid ${CD.ink}`,
                borderRadius: 0,
                cursor: "pointer",
                color: CD.ink,
                fontFamily: "inherit",
                transition: "transform 180ms",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-1px)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
            >
              <LabelCaps color={CD.accent}>+ New client</LabelCaps>
              <p className="mt-2 text-lg font-semibold" style={{ color: CD.ink }}>
                Submit a new business lead
              </p>
              <p className="mt-1 text-sm" style={{ color: CD.muted }}>
                Drop a website. We scrape, analyze, and start the intel profile in 30–60 seconds.
              </p>
            </button>
            <button
              onClick={() =>
                document.getElementById("prospects")?.scrollIntoView({ behavior: "smooth" })
              }
              className="text-left"
              style={{
                padding: "24px 24px",
                background: "rgba(255,255,255,0.025)",
                border: `1px solid ${CD.border}`,
                borderRadius: 16,
                cursor: "pointer",
                color: CD.ink,
                fontFamily: "inherit",
                transition: "background-color 180ms, border-color 180ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                e.currentTarget.style.borderColor = CD.borderStrong;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.025)";
                e.currentTarget.style.borderColor = CD.border;
              }}
            >
              <LabelCaps>Your pipeline</LabelCaps>
              <p className="mt-2 text-lg font-semibold" style={{ color: CD.ink }}>
                View submitted prospects
              </p>
              <p className="mt-1 text-sm" style={{ color: CD.muted }}>
                Track scraping, analysis, and conversion status for every lead you've sent.
              </p>
            </button>
          </section>
        </Cascade>

        {/* Prospects List */}
        <section id="prospects" className="space-y-4 pt-2">
          <div className="flex items-end justify-between gap-3">
            <LabelCaps>Your prospects</LabelCaps>
            <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
              {prospectCount} total
            </Mono>
          </div>
          {prospects.length === 0 ? (
            <EditorialCard className="px-6 py-12 text-center" style={{ borderStyle: "dashed" }}>
              <p className="text-base font-semibold" style={{ color: CD.ink }}>
                No leads yet — let's change that.
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed" style={{ color: CD.muted }}>
                Drop a business website and we'll analyze it in 30–60 seconds. From there
                we handle the outreach while you track every step right here.
              </p>
              <button
                onClick={handleOpenNewClient}
                className="mt-4 text-sm font-medium underline-offset-4 hover:underline"
                style={{ color: CD.accent, background: "transparent", border: "none", cursor: "pointer" }}
              >
                Submit your first client →
              </button>
            </EditorialCard>
          ) : (
            <EditorialCard style={{ overflow: "hidden" }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${CD.border}`, textAlign: "left" }}>
                      <th className="px-4 py-3">
                        <LabelCaps>Business</LabelCaps>
                      </th>
                      <th className="px-4 py-3 hidden sm:table-cell">
                        <LabelCaps>Status</LabelCaps>
                      </th>
                      <th className="px-4 py-3 hidden md:table-cell">
                        <LabelCaps>Submitted</LabelCaps>
                      </th>
                      <th className="px-4 py-3 text-right">
                        <LabelCaps>Action</LabelCaps>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {prospects.map((p) => (
                      <tr
                        key={p.id}
                        className="transition-colors"
                        style={{ borderBottom: `1px solid ${CD.border}` }}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium" style={{ color: CD.ink }}>{p.name}</p>
                          <p className="text-xs" style={{ color: CD.muted }}>{p.industry}</p>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <OnboardingBadge status={p.onboardingStatus} />
                            {p.isPaying && (
                              <span
                                style={{
                                  fontFamily: FONT_MONO,
                                  fontSize: "0.625rem",
                                  letterSpacing: "0.12em",
                                  textTransform: "uppercase",
                                  color: CD.success,
                                  backgroundColor: "rgba(74,157,124,0.10)",
                                  border: `1px solid rgba(74,157,124,0.35)`,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                }}
                              >
                                Converted
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
                            {new Date(p.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </Mono>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <a
                            href={`/prospects/${p.slug}`}
                            style={{
                              fontFamily: FONT_MONO,
                              fontSize: "0.6875rem",
                              letterSpacing: "0.14em",
                              textTransform: "uppercase",
                              color: CD.accent,
                            }}
                          >
                            View →
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </EditorialCard>
          )}
        </section>
      </main>

      {/* New Client Modal — preserved logic, light CD reskin */}
      <Dialog
        open={showModal}
        onOpenChange={(open) => {
          if (submitLoading) return;
          setShowModal(open);
          if (!open) resetProspectForm();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Client</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitProspect} className="space-y-4">
            <div>
              <label className="mb-1.5 block" style={{ ...{ fontFamily: FONT_MONO, fontSize: "0.6875rem", letterSpacing: "0.14em", textTransform: "uppercase" }, color: CD.muted }}>
                Business website
              </label>
              <input
                type="url"
                required
                value={prospectUrl}
                onChange={(e) => setProspectUrl(e.target.value)}
                placeholder="https://clientwebsite.com"
                disabled={submitLoading}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none disabled:opacity-60"
                style={{
                  backgroundColor: "rgba(255,255,255,0.03)",
                  borderColor: CD.border,
                  color: CD.ink,
                }}
              />
              {submitLoading && (
                <p className="mt-1.5 text-xs" style={{ color: CD.muted }}>
                  Analyzing website… this can take 30–60 seconds.
                </p>
              )}
              {submitError && (
                <p className="mt-1.5 text-xs" style={{ color: CD.danger }}>{submitError}</p>
              )}
            </div>

            {/* Optional: lead context */}
            <div style={{ border: `1px solid ${CD.border}`, borderRadius: 10 }}>
              <button
                type="button"
                onClick={() => setShowLeadContext((v) => !v)}
                disabled={submitLoading}
                className="flex w-full items-center justify-between px-3 py-2 disabled:opacity-60"
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "0.6875rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: CD.muted,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
                aria-expanded={showLeadContext}
              >
                <span>Tell us about this lead (optional)</span>
                <span aria-hidden="true">{showLeadContext ? "−" : "+"}</span>
              </button>
              {showLeadContext && (
                <div
                  className="space-y-4 px-3 pb-3 pt-1"
                  style={{ borderTop: `1px solid ${CD.border}` }}
                >
                  <div>
                    <p className="mb-1" style={{ ...{ fontFamily: FONT_MONO, fontSize: "0.6875rem", letterSpacing: "0.14em", textTransform: "uppercase" }, color: CD.muted }}>
                      Have you already spoken with the owner?
                    </p>
                    <p className="mb-2 text-xs leading-relaxed" style={{ color: CD.muted }}>
                      Logging a warm intro helps us coordinate outreach and prioritize your lead.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(["yes", "no"] as const).map((opt) => {
                        const active = firstTouchStatus === opt;
                        return (
                          <label
                            key={opt}
                            className="flex cursor-pointer items-center gap-1.5 px-3 py-1 text-xs"
                            style={{
                              backgroundColor: active ? "rgba(255,107,74,0.10)" : "transparent",
                              color: active ? CD.accent : CD.ink,
                              border: `1px solid ${active ? "rgba(255,107,74,0.40)" : CD.border}`,
                              borderRadius: 9999,
                              fontWeight: 500,
                              textTransform: "capitalize",
                            }}
                          >
                            <input
                              type="radio"
                              name="firstTouchStatus"
                              value={opt}
                              checked={active}
                              onChange={() => setFirstTouchStatus(opt)}
                              disabled={submitLoading}
                              className="sr-only"
                            />
                            {opt}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {firstTouchStatus === "yes" && (
                    <div className="space-y-3 pl-5" style={{ borderLeft: `2px solid ${CD.border}` }}>
                      <div>
                        <p className="mb-1.5" style={{ ...{ fontFamily: FONT_MONO, fontSize: "0.6875rem", letterSpacing: "0.14em", textTransform: "uppercase" }, color: CD.muted }}>
                          Relationship
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {WARMTH_OPTIONS.map((opt) => {
                            const active = warmth === opt.value;
                            return (
                              <label
                                key={opt.value}
                                className="flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-[11px]"
                                style={{
                                  backgroundColor: active ? "rgba(255,107,74,0.10)" : "transparent",
                                  color: active ? CD.accent : CD.muted,
                                  border: `1px solid ${active ? "rgba(255,107,74,0.40)" : CD.border}`,
                                  borderRadius: 9999,
                                }}
                              >
                                <input
                                  type="radio"
                                  name="warmth"
                                  value={opt.value}
                                  checked={active}
                                  onChange={() => setWarmth(opt.value)}
                                  disabled={submitLoading}
                                  className="sr-only"
                                />
                                <span className="font-medium">{opt.label}</span>
                                <span style={{ color: CD.muted }}>· {opt.hint}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block" style={{ ...{ fontFamily: FONT_MONO, fontSize: "0.6875rem", letterSpacing: "0.14em", textTransform: "uppercase" }, color: CD.muted }}>
                            How you touched base
                          </label>
                          <select
                            value={touchType}
                            onChange={(e) => setTouchType(e.target.value as FirstTouchType | "")}
                            disabled={submitLoading}
                            className="w-full px-2.5 py-1.5 text-xs focus:outline-none disabled:opacity-60"
                            style={{
                              backgroundColor: "rgba(255,255,255,0.03)",
                              border: `1px solid ${CD.border}`,
                              color: CD.ink,
                              borderRadius: 6,
                            }}
                          >
                            <option value="">Select…</option>
                            {TOUCH_TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block" style={{ ...{ fontFamily: FONT_MONO, fontSize: "0.6875rem", letterSpacing: "0.14em", textTransform: "uppercase" }, color: CD.muted }}>
                            When
                          </label>
                          <input
                            type="date"
                            max={todayIsoDate()}
                            value={touchDate}
                            onChange={(e) => setTouchDate(e.target.value)}
                            disabled={submitLoading}
                            className="w-full px-2.5 py-1.5 text-xs focus:outline-none disabled:opacity-60"
                            style={{
                              backgroundColor: "rgba(255,255,255,0.03)",
                              border: `1px solid ${CD.border}`,
                              color: CD.ink,
                              borderRadius: 6,
                            }}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block" style={{ ...{ fontFamily: FONT_MONO, fontSize: "0.6875rem", letterSpacing: "0.14em", textTransform: "uppercase" }, color: CD.muted }}>
                          Short note (optional)
                        </label>
                        <textarea
                          value={touchNotes}
                          onChange={(e) => setTouchNotes(e.target.value.slice(0, 500))}
                          disabled={submitLoading}
                          rows={2}
                          maxLength={500}
                          placeholder="Anything useful about the conversation…"
                          className="w-full resize-none px-2.5 py-1.5 text-xs focus:outline-none disabled:opacity-60"
                          style={{
                            backgroundColor: "rgba(255,255,255,0.03)",
                            border: `1px solid ${CD.border}`,
                            color: CD.ink,
                            borderRadius: 6,
                          }}
                        />
                        <p className="mt-0.5 text-right" style={{ color: CD.muted, fontFamily: FONT_MONO, fontSize: "0.625rem" }}>
                          {touchNotes.length}/500
                        </p>
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="mb-1" style={{ ...{ fontFamily: FONT_MONO, fontSize: "0.6875rem", letterSpacing: "0.14em", textTransform: "uppercase" }, color: CD.muted }}>
                      Who closes?
                    </p>
                    <p className="mb-2 text-xs leading-relaxed" style={{ color: CD.muted }}>
                      How a deal is closed can affect the commission tier on that deal.
                    </p>
                    <div className="space-y-1.5">
                      {CLOSE_PATH_OPTIONS.map((opt) => {
                        const active = closePref === opt.value;
                        return (
                          <label
                            key={opt.value}
                            className="flex cursor-pointer items-start gap-2 px-2.5 py-1.5 text-xs"
                            style={{
                              backgroundColor: active ? "rgba(255,107,74,0.10)" : "transparent",
                              color: active ? CD.accent : CD.ink,
                              border: `1px solid ${active ? "rgba(255,107,74,0.40)" : CD.border}`,
                              borderRadius: 6,
                            }}
                          >
                            <input
                              type="radio"
                              name="closePreference"
                              value={opt.value}
                              checked={active}
                              onChange={() => setClosePref(opt.value)}
                              disabled={submitLoading}
                              className="mt-0.5 h-3.5 w-3.5"
                              style={{ accentColor: CD.accent }}
                            />
                            <span className="flex-1">
                              <span className="flex items-center gap-1.5">
                                <span>{opt.label}</span>
                                {opt.recommended && (
                                  <span
                                    style={{
                                      fontFamily: FONT_MONO,
                                      fontSize: "0.5625rem",
                                      letterSpacing: "0.14em",
                                      textTransform: "uppercase",
                                      color: CD.accent,
                                      backgroundColor: "rgba(255,107,74,0.12)",
                                      border: `1px solid rgba(255,107,74,0.40)`,
                                      padding: "1px 6px",
                                      borderRadius: 9999,
                                      fontWeight: 600,
                                    }}
                                  >
                                    Recommended
                                  </span>
                                )}
                              </span>
                              {opt.helper && (
                                <span
                                  className="mt-0.5 block"
                                  style={{
                                    color: opt.recommended ? CD.accent : CD.muted,
                                    opacity: opt.recommended ? 0.85 : 1,
                                    fontSize: "0.625rem",
                                  }}
                                >
                                  {opt.helper}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={() => { setShowModal(false); resetProspectForm(); }}
                disabled={submitLoading}
                className="px-4 py-2 text-sm disabled:opacity-60"
                style={{ color: CD.muted, background: "transparent", border: "none", cursor: "pointer" }}
              >
                Cancel
              </button>
              <CDPrimaryButton type="submit" disabled={submitLoading || !prospectUrl.trim()}>
                {submitLoading ? "Analyzing website…" : "Lock it in"}
              </CDPrimaryButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Policy Acceptance Modal — preserved logic */}
      <Dialog
        open={showPolicyModal}
        onOpenChange={(open) => {
          if (!open && policyReplay) {
            setShowPolicyModal(false);
            setPolicyReplay(false);
          }
        }}
      >
        <DialogContent
          showCloseButton={policyReplay}
          onEscapeKeyDown={(e) => { if (!policyReplay) e.preventDefault(); }}
          onPointerDownOutside={(e) => { if (!policyReplay) e.preventDefault(); }}
          onInteractOutside={(e) => { if (!policyReplay) e.preventDefault(); }}
          className="sm:max-w-2xl max-h-[85vh] overflow-y-auto p-8"
          overlayClassName="bg-black/85 backdrop-blur-sm"
        >
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {policyReplay ? "Program rules refresher" : "One quick thing before you submit leads"}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-1 flex items-center gap-1.5">
            {POLICY_STEPS.map((_, i) => {
              const fill = i < policyStep ? 1 : i === policyStep ? policyProgress : 0;
              return (
                <span
                  key={i}
                  className="h-1 flex-1 overflow-hidden"
                  style={{ backgroundColor: CD.border, borderRadius: 9999 }}
                >
                  <span
                    className="block h-full origin-left"
                    style={{ backgroundColor: CD.accent, transform: `scaleX(${fill})` }}
                  />
                </span>
              );
            })}
          </div>

          <div className="min-h-[200px] space-y-4 text-base">
            <LabelCaps>
              Rule {policyStep + 1} of {POLICY_STEPS.length}
            </LabelCaps>
            <h3 className="text-xl font-semibold" style={{ color: CD.ink }}>
              {POLICY_STEPS[policyStep].title}
            </h3>
            <p className="leading-relaxed" style={{ color: CD.muted }}>
              {POLICY_STEPS[policyStep].body}
            </p>

            {policyStep === POLICY_STEPS.length - 1 && (
              <p className="pt-2">
                <a
                  href="/program-rules"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "0.6875rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: CD.accent,
                  }}
                >
                  Read full program rules →
                </a>
              </p>
            )}

            {policyError && (
              <p className="text-xs" style={{ color: CD.danger }}>{policyError}</p>
            )}
          </div>

          <DialogFooter className="items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {!policyReplay && (
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={policyLoading}
                  className="text-xs disabled:opacity-60"
                  style={{ color: CD.muted, background: "transparent", border: "none", cursor: "pointer" }}
                >
                  Log out
                </button>
              )}
              {policyStep > 0 && (
                <button
                  type="button"
                  onClick={() => setPolicyStep((s) => Math.max(0, s - 1))}
                  disabled={policyLoading}
                  className="text-xs disabled:opacity-60"
                  style={{ color: CD.muted, background: "transparent", border: "none", cursor: "pointer" }}
                >
                  ← Back
                </button>
              )}
            </div>
            {(() => {
              const canProceed = policyReplay || policyProgress >= 1;
              const secondsLeft = Math.ceil((1 - policyProgress) * 10);
              const isFinal = policyStep === POLICY_STEPS.length - 1;
              return (
                <CDPrimaryButton
                  type="button"
                  onClick={() => {
                    if (!canProceed) return;
                    if (isFinal) {
                      handleAcceptPolicy();
                    } else {
                      setPolicyStep((s) => Math.min(POLICY_STEPS.length - 1, s + 1));
                    }
                  }}
                  disabled={policyLoading || !canProceed}
                  style={{ minWidth: "10rem", opacity: canProceed ? 1 : 0.5 }}
                >
                  {!canProceed
                    ? `Keep reading… ${secondsLeft}s`
                    : isFinal
                    ? policyLoading
                      ? "Saving…"
                      : policyReplay
                      ? "Done"
                      : "I understand and agree"
                    : "Next →"}
                </CDPrimaryButton>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CDPage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Local helpers
// ─────────────────────────────────────────────────────────────────────────────

function GettingStartedStep({
  n,
  done,
  active,
  title,
  body,
  action,
}: {
  n: number;
  done: boolean;
  active: boolean;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void; primary?: boolean };
}) {
  // Marker color: done = success, active = accent, upcoming = muted outline.
  const markerBg = done ? CD.success : active ? CD.accent : "transparent";
  const markerBorder = done ? CD.success : active ? CD.accent : CD.borderStrong;
  const markerText = done || active ? CD.canvas : CD.muted;
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center"
        style={{
          width: 24,
          height: 24,
          borderRadius: 9999,
          backgroundColor: markerBg,
          border: `1.5px solid ${markerBorder}`,
          color: markerText,
          fontFamily: FONT_MONO,
          fontSize: "0.75rem",
          fontWeight: 600,
          marginTop: 1,
        }}
      >
        {done ? "✓" : n}
      </span>
      <div className="flex-1">
        <p
          className="text-sm font-semibold"
          style={{ color: done ? CD.muted : CD.ink }}
        >
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: CD.muted }}>
          {body}
        </p>
        {action &&
          (action.primary ? (
            <button
              type="button"
              onClick={action.onClick}
              className="mt-2"
              style={{
                fontFamily: FONT_MONO,
                fontSize: "0.6875rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: CD.canvas,
                backgroundColor: CD.accent,
                border: "none",
                borderRadius: 8,
                padding: "6px 14px",
                cursor: "pointer",
              }}
            >
              {action.label}
            </button>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              className="mt-1.5"
              style={{
                fontFamily: FONT_MONO,
                fontSize: "0.6875rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: CD.accent,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {action.label}
            </button>
          ))}
      </div>
    </li>
  );
}

function StatCell({
  label,
  value,
  accent,
  color,
  mono,
}: {
  label: string;
  value: string;
  accent?: boolean;
  color?: string;
  mono?: boolean;
}) {
  const v = color ?? (accent ? CD.accent : CD.ink);
  return (
    <div>
      <LabelCaps>{label}</LabelCaps>
      <p
        className="mt-1.5"
        style={{
          fontFamily: mono ? FONT_MONO : "inherit",
          fontSize: "1.5rem",
          fontWeight: 600,
          letterSpacing: "-0.01em",
          fontVariantNumeric: "tabular-nums",
          color: v,
          lineHeight: 1.1,
        }}
      >
        {value}
      </p>
    </div>
  );
}

function ProgressRow({
  label,
  current,
  target,
  pct,
}: {
  label: string;
  current: string;
  target: string;
  pct: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs" style={{ color: CD.muted }}>{label}</span>
        <Mono style={{ color: CD.muted, fontSize: "0.75rem" }}>
          {current} / {target}
        </Mono>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden"
        style={{ backgroundColor: CD.border, borderRadius: 9999 }}
      >
        <div
          className="h-full"
          style={{
            width: `${(pct * 100).toFixed(1)}%`,
            backgroundColor: CD.accent,
            borderRadius: 9999,
            transition: "width 480ms cubic-bezier(0.22,0.61,0.36,1)",
          }}
        />
      </div>
    </div>
  );
}
