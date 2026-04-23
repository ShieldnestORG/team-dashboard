import { useEffect, useState } from "react";
import { HandCoins, BarChart2, DollarSign, ArrowUpRight, CheckCircle2, PlayCircle } from "lucide-react";
import { affiliatesApi, setAffiliateToken } from "@/api/affiliates";
import { AffiliateHowItWorksModal } from "./AffiliateHowItWorks";

// Coherence Daddy design tokens — mirrors coherencedaddy-landing/DESIGN.md
const CD = {
  canvas: "#0E0E10",
  surface: "#18181B",
  surfaceAlt: "#1F1F22",
  ink: "#F2F1ED",
  muted: "#A1A1A6",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",
  accent: "#FF6B4A",
  accentPressed: "#E5553A",
  success: "#4A9D7C",
  danger: "#D94343",
};

// Neutral "lift" shadow — mirrors .btn-lift in coherencedaddy-landing/app/globals.css.
// Dark drops + subtle inset top highlight. NO colored glow (see DESIGN.md §4 — buttons use neutral lift, never accent shadow).
const LIFT_SHADOW =
  "0 10px 24px -8px rgba(0,0,0,0.55), 0 2px 6px -1px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.18)";
const LIFT_SHADOW_HOVER =
  "0 18px 36px -10px rgba(0,0,0,0.65), 0 4px 12px -2px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22)";

const FONT_SANS =
  '"Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const FONT_MONO =
  '"Geist Mono", ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace';

const BENEFITS = [
  {
    icon: HandCoins,
    eyebrow: "01 · Refer",
    title: "Bring us a real business",
    body:
      "Drop any website. We scrape, analyze, and build a full intel profile automatically. You bring the lead — we do the work.",
  },
  {
    icon: BarChart2,
    eyebrow: "02 · Track",
    title: "Watch every prospect",
    body:
      "See submitted clients, onboarding status, competitor analysis, and every piece of intel we build for them in one place.",
  },
  {
    icon: DollarSign,
    eyebrow: "03 · Earn",
    title: "Keep earning while they grow",
    body:
      "A percentage of every monthly subscription from clients you referred. The bigger they get, the bigger your check.",
  },
];

function useGeistFonts() {
  useEffect(() => {
    const id = "cd-geist-fonts";
    if (document.getElementById(id)) return;
    const pre1 = document.createElement("link");
    pre1.rel = "preconnect";
    pre1.href = "https://fonts.googleapis.com";
    const pre2 = document.createElement("link");
    pre2.rel = "preconnect";
    pre2.href = "https://fonts.gstatic.com";
    pre2.crossOrigin = "anonymous";
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@500&display=swap";
    document.head.append(pre1, pre2, link);
  }, []);
}

export function AffiliateLanding() {
  useGeistFonts();

  const [authTab, setAuthTab] = useState<"login" | "register">("login");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState(false);

  const [howOpen, setHowOpen] = useState(false);

  function openHow() {
    setHowOpen(true);
  }
  function closeHow() {
    setHowOpen(false);
  }
  function handleHowApply() {
    setHowOpen(false);
    setAuthTab("register");
    setTimeout(() => {
      document.getElementById("auth-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await affiliatesApi.login({ email: loginEmail, password: loginPassword });
      setAffiliateToken(res.token);
      window.location.href = "/dashboard";
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (regPassword.length < 8) {
      setRegError("Password must be at least 8 characters");
      return;
    }
    if (regPassword !== regConfirm) {
      setRegError("Passwords do not match");
      return;
    }
    setRegLoading(true);
    setRegError(null);
    try {
      await affiliatesApi.register({ name: regName, email: regEmail, password: regPassword });
      setRegSuccess(true);
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <div
      style={{
        backgroundColor: CD.canvas,
        color: CD.ink,
        fontFamily: FONT_SANS,
        minHeight: "100dvh",
      }}
    >
      {/* Header */}
      <header
        style={{ borderBottom: `1px solid ${CD.border}`, backgroundColor: CD.canvas }}
        className="sticky top-0 z-20 backdrop-blur-md"
      >
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-6 py-4">
          <a
            href="https://coherencedaddy.com"
            className="flex items-baseline gap-2 transition-opacity hover:opacity-80"
          >
            <span className="text-base font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
              Coherence Daddy
            </span>
            <span
              style={{ color: CD.muted, fontFamily: FONT_MONO, fontSize: "0.6875rem", letterSpacing: "0.14em" }}
              className="uppercase"
            >
              / Affiliates
            </span>
          </a>
          <div className="hidden items-center gap-4 sm:flex">
            <button
              type="button"
              onClick={openHow}
              className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
              style={{ color: CD.muted }}
              onMouseEnter={(e) => (e.currentTarget.style.color = CD.ink)}
              onMouseLeave={(e) => (e.currentTarget.style.color = CD.muted)}
            >
              <PlayCircle className="h-4 w-4" style={{ color: CD.accent }} />
              How it works
            </button>
            <a
              href="#apply"
              className="text-sm font-medium transition-colors"
              style={{ color: CD.muted }}
              onMouseEnter={(e) => (e.currentTarget.style.color = CD.ink)}
              onMouseLeave={(e) => (e.currentTarget.style.color = CD.muted)}
            >
              Apply &rarr;
            </a>
          </div>
        </div>
      </header>

      {/* Hero — split screen (copy left, auth card right) */}
      <section id="apply" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-40 -top-24 h-[36rem] w-[36rem] rounded-full opacity-30 blur-[140px]"
          style={{ background: `radial-gradient(circle, ${CD.accent} 0%, transparent 70%)` }}
        />

        <div className="relative mx-auto w-full max-w-[1200px] px-6 pb-20 pt-14 md:pt-20 lg:pb-28 lg:pt-24">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.2fr_1fr] lg:items-start lg:gap-16">
            {/* Left: copy */}
            <div className="flex flex-col items-start">
              <span
                className="mb-6 inline-flex items-center gap-3"
                style={{
                  color: CD.muted,
                  fontFamily: FONT_MONO,
                  fontSize: "0.6875rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ display: "inline-block", height: 2, width: "2.5rem", background: CD.ink }}
                />
                Affiliate Program · Since 2024
              </span>

              <h1
                className="text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[1.02]"
                style={{ letterSpacing: "-0.035em", color: CD.ink }}
              >
                Earn commission bringing real{" "}
                <span style={{ color: CD.accent }}>businesses</span> to us.
              </h1>

              <p
                className="mt-6 max-w-[56ch] text-lg leading-relaxed"
                style={{ color: CD.muted }}
              >
                Visit local businesses. Share your referral. Earn every time a client
                subscribes. No fluff, no gimmicks — a percentage of real monthly revenue
                from the clients you bring in.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab("register");
                    document.getElementById("auth-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  className="group inline-flex items-center justify-center gap-2 rounded-[10px] px-5 py-3 text-sm font-semibold"
                  style={{
                    backgroundColor: CD.accent,
                    color: CD.canvas,
                    boxShadow: LIFT_SHADOW,
                    transition:
                      "box-shadow 260ms cubic-bezier(0.22,0.61,0.36,1), transform 260ms cubic-bezier(0.22,0.61,0.36,1), background-color 180ms",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = LIFT_SHADOW_HOVER;
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = LIFT_SHADOW;
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.backgroundColor = CD.accent;
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.backgroundColor = CD.accentPressed;
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                  onMouseUp={(e) => (e.currentTarget.style.backgroundColor = CD.accent)}
                >
                  Apply to the program
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab("login");
                    document.getElementById("auth-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-[10px] px-5 py-3 text-sm font-medium transition-colors"
                  style={{
                    border: `1px solid ${CD.border}`,
                    color: CD.ink,
                    backgroundColor: "transparent",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                    e.currentTarget.style.borderColor = CD.borderStrong;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.borderColor = CD.border;
                  }}
                >
                  Sign in
                </button>
              </div>

              <button
                type="button"
                onClick={openHow}
                className="group mt-6 inline-flex w-full items-center gap-4 rounded-[12px] px-5 py-4 text-left transition-colors sm:w-auto"
                style={{
                  backgroundColor: "rgba(255,107,74,0.08)",
                  border: `1px solid ${CD.accent}`,
                  color: CD.ink,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(255,107,74,0.14)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "rgba(255,107,74,0.08)";
                }}
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform group-hover:scale-105"
                  style={{ backgroundColor: CD.accent, color: CD.canvas }}
                >
                  <PlayCircle className="h-5 w-5" strokeWidth={2} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: "0.6875rem",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: CD.accent,
                    }}
                  >
                    Watch · 60 seconds
                  </span>
                  <span className="text-base font-semibold" style={{ letterSpacing: "-0.01em" }}>
                    See how the affiliate program works
                  </span>
                </span>
                <ArrowUpRight
                  className="ml-2 hidden h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 sm:inline-block"
                  style={{ color: CD.muted }}
                />
              </button>

              <div
                className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"
                style={{ color: CD.muted }}
              >
                <span className="flex items-baseline gap-2">
                  <span style={{ fontFamily: FONT_MONO, color: CD.ink, fontSize: 15 }}>
                    Monthly
                  </span>
                  recurring commission
                </span>
                <span
                  aria-hidden
                  className="hidden h-1 w-1 rounded-full sm:inline-block"
                  style={{ background: "rgba(161,161,166,0.4)" }}
                />
                <span className="flex items-baseline gap-2">
                  <span style={{ fontFamily: FONT_MONO, color: CD.ink, fontSize: 15 }}>
                    0
                  </span>
                  setup cost
                </span>
                <span
                  aria-hidden
                  className="hidden h-1 w-1 rounded-full sm:inline-block"
                  style={{ background: "rgba(161,161,166,0.4)" }}
                />
                <span className="flex items-baseline gap-2">
                  <span style={{ fontFamily: FONT_MONO, color: CD.ink, fontSize: 15 }}>
                    Live
                  </span>
                  prospect tracking
                </span>
              </div>
            </div>

            {/* Right: auth card */}
            <div id="auth-card" className="relative w-full">
              {/* Floating mono tag */}
              <div
                className="absolute -left-3 -top-3 hidden rounded-[6px] px-2 py-1 sm:block"
                style={{
                  backgroundColor: CD.canvas,
                  border: `1px solid ${CD.border}`,
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: CD.muted,
                }}
              >
                cd-affiliates v1
              </div>

              <div
                className="overflow-hidden rounded-[16px]"
                style={{
                  backgroundColor: CD.surface,
                  border: `1px solid ${CD.border}`,
                  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
                }}
              >
                {/* Tabs */}
                <div className="grid grid-cols-2" style={{ borderBottom: `1px solid ${CD.border}` }}>
                  {(["login", "register"] as const).map((tab) => {
                    const isActive = authTab === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setAuthTab(tab)}
                        className="py-3.5 text-xs font-medium transition-colors"
                        style={{
                          color: isActive ? CD.ink : CD.muted,
                          backgroundColor: isActive ? "rgba(255,107,74,0.08)" : "transparent",
                          borderBottom: `2px solid ${isActive ? CD.accent : "transparent"}`,
                          fontFamily: FONT_MONO,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                        }}
                      >
                        {tab === "login" ? "Sign in" : "Apply"}
                      </button>
                    );
                  })}
                </div>

                <div className="px-6 py-7">
                  {authTab === "login" ? (
                    <form onSubmit={handleLogin} className="space-y-5">
                      <CDField
                        label="Email"
                        type="email"
                        required
                        value={loginEmail}
                        onChange={setLoginEmail}
                        placeholder="you@example.com"
                        autoComplete="email"
                      />
                      <CDField
                        label="Password"
                        type="password"
                        required
                        value={loginPassword}
                        onChange={setLoginPassword}
                        placeholder="••••••••"
                        autoComplete="current-password"
                      />
                      <div className="text-right">
                        <a
                          href="/reset-password"
                          className="text-xs font-medium transition-colors"
                          style={{ color: CD.accent }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = CD.accentPressed)}
                          onMouseLeave={(e) => (e.currentTarget.style.color = CD.accent)}
                        >
                          Forgot password?
                        </a>
                      </div>
                      <CDSubmit loading={loginLoading} label="Sign in to dashboard" loadingLabel="Signing in…" />
                      {loginError && <CDError message={loginError} />}
                    </form>
                  ) : regSuccess ? (
                    <div className="py-6 text-center">
                      <div
                        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                        style={{ backgroundColor: "rgba(74,157,124,0.12)" }}
                      >
                        <CheckCircle2 className="h-6 w-6" style={{ color: CD.success }} />
                      </div>
                      <p className="text-base font-semibold" style={{ color: CD.ink }}>
                        Application submitted
                      </p>
                      <p className="mt-1 text-sm" style={{ color: CD.muted }}>
                        We review every application by hand. Expect a decision within 48 hours.
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={handleRegister} className="space-y-5">
                      <CDField
                        label="Full name"
                        type="text"
                        required
                        value={regName}
                        onChange={setRegName}
                        placeholder="Jane Smith"
                        autoComplete="name"
                      />
                      <CDField
                        label="Email"
                        type="email"
                        required
                        value={regEmail}
                        onChange={setRegEmail}
                        placeholder="you@example.com"
                        autoComplete="email"
                      />
                      <CDField
                        label="Password"
                        type="password"
                        required
                        minLength={8}
                        value={regPassword}
                        onChange={setRegPassword}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        hint="At least 8 characters"
                      />
                      <CDField
                        label="Confirm password"
                        type="password"
                        required
                        value={regConfirm}
                        onChange={setRegConfirm}
                        placeholder="••••••••"
                        autoComplete="new-password"
                      />
                      <CDSubmit loading={regLoading} label="Apply to the program" loadingLabel="Submitting…" />
                      {regError && <CDError message={regError} />}
                    </form>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works — asymmetric 3-up */}
      <section
        style={{ borderTop: `1px solid ${CD.border}`, borderBottom: `1px solid ${CD.border}` }}
        className="py-20 md:py-28"
      >
        <div className="mx-auto w-full max-w-[1200px] px-6">
          <div className="mb-12 max-w-[40ch]">
            <span
              className="mb-4 inline-flex items-center gap-3"
              style={{
                color: CD.muted,
                fontFamily: FONT_MONO,
                fontSize: "0.6875rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              <span
                aria-hidden
                style={{ display: "inline-block", height: 2, width: "2.5rem", background: CD.ink }}
              />
              How it works
            </span>
            <h2
              className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold"
              style={{ letterSpacing: "-0.02em", color: CD.ink, lineHeight: 1.1 }}
            >
              Three steps. No jargon.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {BENEFITS.map((b) => (
              <article
                key={b.title}
                className="rounded-[16px] p-7 transition-all"
                style={{
                  backgroundColor: CD.surface,
                  border: `1px solid ${CD.border}`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = CD.borderStrong;
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = CD.border;
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div
                  className="mb-5 flex items-center justify-between"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "0.6875rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: CD.muted,
                  }}
                >
                  <span>{b.eyebrow}</span>
                  <b.icon className="h-4 w-4" style={{ color: CD.accent }} />
                </div>
                <h3
                  className="mb-2 text-[1.375rem] font-semibold"
                  style={{ letterSpacing: "-0.01em", color: CD.ink, lineHeight: 1.2 }}
                >
                  {b.title}
                </h3>
                <p className="text-[0.9375rem] leading-relaxed" style={{ color: CD.muted }}>
                  {b.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10">
        <div
          className="mx-auto w-full max-w-[1200px] px-6 text-center"
          style={{
            color: CD.muted,
            fontFamily: FONT_MONO,
            fontSize: "0.6875rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Coherence Daddy Affiliates · 508(c)(1)(A) Faith-Driven Technology Ministry
        </div>
      </footer>

      <AffiliateHowItWorksModal open={howOpen} onClose={closeHow} onApply={handleHowApply} />
    </div>
  );
}

/* ───────────────────── primitives ───────────────────── */

function CDField({
  label,
  value,
  onChange,
  type = "text",
  required,
  minLength,
  placeholder,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <label className="block">
      <span
        className="mb-2 block"
        style={{
          color: CD.muted,
          fontFamily: FONT_MONO,
          fontSize: "0.6875rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <input
        type={type}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          backgroundColor: CD.surfaceAlt,
          color: CD.ink,
          border: `1px solid ${focused ? CD.accent : CD.border}`,
          outline: focused ? `2px solid ${CD.accent}` : "none",
          outlineOffset: focused ? 2 : 0,
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: "0.9375rem",
          fontFamily: FONT_SANS,
          transition: "border-color 180ms cubic-bezier(0.22,0.61,0.36,1)",
        }}
      />
      {hint && (
        <span
          className="mt-1.5 block text-xs"
          style={{ color: CD.muted, fontSize: "0.75rem" }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

function CDSubmit({
  loading,
  label,
  loadingLabel,
}: {
  loading: boolean;
  label: string;
  loadingLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full rounded-[10px] py-3 text-sm font-semibold disabled:opacity-60"
      style={{
        backgroundColor: CD.accent,
        color: CD.canvas,
        boxShadow: LIFT_SHADOW,
        transition:
          "box-shadow 260ms cubic-bezier(0.22,0.61,0.36,1), transform 260ms cubic-bezier(0.22,0.61,0.36,1), background-color 180ms",
      }}
      onMouseEnter={(e) => {
        if (loading) return;
        e.currentTarget.style.boxShadow = LIFT_SHADOW_HOVER;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = LIFT_SHADOW;
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.backgroundColor = CD.accent;
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.backgroundColor = CD.accentPressed;
        e.currentTarget.style.transform = "translateY(0)";
      }}
      onMouseUp={(e) => (e.currentTarget.style.backgroundColor = CD.accent)}
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

function CDError({ message }: { message: string }) {
  return (
    <div
      className="rounded-[6px] px-3 py-2 text-center text-xs"
      style={{
        backgroundColor: "rgba(217,67,67,0.08)",
        border: `1px solid rgba(217,67,67,0.3)`,
        color: CD.danger,
        fontFamily: FONT_MONO,
        letterSpacing: "0.06em",
      }}
    >
      {message}
    </div>
  );
}
