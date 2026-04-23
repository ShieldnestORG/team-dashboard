import { useCallback, useEffect, useState } from "react";
import {
  X,
  ArrowLeft,
  ArrowRight,
  Coffee,
  Link2,
  Cpu,
  Handshake,
  DollarSign,
  Sparkles,
  TrendingUp,
  ShoppingBag,
  Gift,
  PenLine,
  Star,
} from "lucide-react";

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
};

const FONT_SANS =
  '"Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const FONT_MONO =
  '"Geist Mono", ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace';

const LIFT_SHADOW =
  "0 10px 24px -8px rgba(0,0,0,0.55), 0 2px 6px -1px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.18)";
const LIFT_SHADOW_HOVER =
  "0 18px 36px -10px rgba(0,0,0,0.65), 0 4px 12px -2px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22)";

type Slide = {
  icon: typeof Coffee;
  eyebrow: string;
  title: string;
  body: string;
  visual:
    | "place"
    | "url"
    | "review"
    | "cpu"
    | "handshake"
    | "money"
    | "closer"
    | "merch"
    | "gift";
  section: "how" | "earn";
};

const SLIDES: Slide[] = [
  {
    icon: Coffee,
    eyebrow: "Step 01",
    title: "Spot a place you love.",
    body:
      "Somewhere you actually hang out. Meet the owner. Leave a real review. We vet every company — coherent, community-first, never a money grab.",
    visual: "place",
    section: "how",
  },
  {
    icon: Link2,
    eyebrow: "Step 02",
    title: "Paste. Add the context.",
    body:
      "Drop the URL. Log how you know them, warm vs. cold, a few notes. Takes a minute.",
    visual: "url",
    section: "how",
  },
  {
    icon: PenLine,
    eyebrow: "Step 03",
    title: "Leave an honest review.",
    body:
      "A real sentence about why this place matters. Vetted companies join our partners and directory — your word is the signal.",
    visual: "review",
    section: "how",
  },
  {
    icon: Cpu,
    eyebrow: "Step 04",
    title: "We do the work.",
    body: "We scrape, score, and build their profile. You wait.",
    visual: "cpu",
    section: "how",
  },
  {
    icon: Handshake,
    eyebrow: "Step 05",
    title: "They become a client.",
    body: "We close the deal. You stay on the record as the referrer.",
    visual: "handshake",
    section: "how",
  },
  {
    icon: DollarSign,
    eyebrow: "Step 06",
    title: "You get paid. Every month.",
    body: "A share of every subscription, for as long as they keep paying.",
    visual: "money",
    section: "how",
  },
  {
    icon: TrendingUp,
    eyebrow: "Earn more · 01",
    title: "Close it yourself.",
    body:
      "Know the ecosystem? Teach the owner and close the deal yourself — higher commission, paid every month.",
    visual: "closer",
    section: "earn",
  },
  {
    icon: ShoppingBag,
    eyebrow: "Earn more · 02",
    title: "Share the merch.",
    body:
      "Four genres of drops. Anyone who buys through your link earns you a cut — climb tiers for bigger shares.",
    visual: "merch",
    section: "earn",
  },
  {
    icon: Gift,
    eyebrow: "Earn more · 03",
    title: "Giveaways, soon.",
    body:
      "Bonus pots, referral streaks, seasonal drops. Announcements land in your dashboard first.",
    visual: "gift",
    section: "earn",
  },
];

export function AffiliateHowItWorksModal({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [mounted, setMounted] = useState(false);

  const total = SLIDES.length;
  const isLast = idx === total - 1;

  const go = useCallback(
    (dir: 1 | -1) => {
      setDirection(dir);
      setIdx((prev) => {
        const next = prev + dir;
        if (next < 0) return 0;
        if (next >= total) return total - 1;
        return next;
      });
    },
    [total],
  );

  useEffect(() => {
    if (!open) return;
    setIdx(0);
    setDirection(1);
    const t = requestAnimationFrame(() => setMounted(true));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(t);
      setMounted(false);
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, go]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How the affiliate program works"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
      style={{
        fontFamily: FONT_SANS,
        backgroundColor: "rgba(14,14,16,0.82)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        opacity: mounted ? 1 : 0,
        transition: "opacity 260ms cubic-bezier(0.22,0.61,0.36,1)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-[760px] overflow-hidden rounded-[16px]"
        style={{
          backgroundColor: CD.surface,
          border: `1px solid ${CD.border}`,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
          transform: mounted ? "translateY(0) scale(1)" : "translateY(12px) scale(0.98)",
          transition: "transform 320ms cubic-bezier(0.22,0.61,0.36,1)",
        }}
      >
        {/* Ambient coral */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 h-[24rem] w-[24rem] rounded-full opacity-25 blur-[120px]"
          style={{ background: `radial-gradient(circle, ${CD.accent} 0%, transparent 70%)` }}
        />

        {/* Header bar */}
        <div
          className="relative flex items-center justify-between px-6 py-4"
          style={{ borderBottom: `1px solid ${CD.border}` }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: "0.6875rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: CD.muted,
              transition: "color 180ms",
            }}
          >
            {SLIDES[idx].section === "how" ? (
              <>How it works · 60 seconds</>
            ) : (
              <span style={{ color: CD.accent }}>Bonus · Ways to earn more</span>
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[8px] p-1.5 transition-colors"
            style={{ color: CD.muted }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = CD.ink;
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = CD.muted;
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Slide stage — active slide is relative (drives height), neighbors are absolute overlay */}
        <div className="relative overflow-hidden">
          {SLIDES.map((slide, i) => {
            const isActive = i === idx;
            const isBehind = Math.abs(i - idx) > 1 && !isActive;
            if (isBehind) return null;

            const offset = isActive ? 0 : i < idx ? -40 : 40;
            return (
              <div
                key={i}
                aria-hidden={!isActive}
                className={
                  isActive
                    ? "relative px-6 py-8 sm:px-8 sm:py-10 md:px-12"
                    : "absolute inset-0 px-6 py-8 sm:px-8 sm:py-10 md:px-12"
                }
                style={{
                  opacity: isActive ? 1 : 0,
                  transform: `translateX(${offset}px)`,
                  transition:
                    "opacity 320ms cubic-bezier(0.22,0.61,0.36,1), transform 320ms cubic-bezier(0.22,0.61,0.36,1)",
                  pointerEvents: isActive ? "auto" : "none",
                }}
              >
                <SlideBody slide={slide} index={i} active={isActive} direction={direction} />
              </div>
            );
          })}
        </div>

        {/* Footer: progress dots + nav */}
        <div
          className="relative flex items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4"
          style={{ borderTop: `1px solid ${CD.border}`, backgroundColor: CD.surface }}
        >
          <div className="flex items-center gap-1.5 sm:gap-2">
            {SLIDES.map((_, i) => {
              const active = i === idx;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setDirection(i > idx ? 1 : -1);
                    setIdx(i);
                  }}
                  aria-label={`Go to slide ${i + 1}`}
                  style={{
                    height: 6,
                    width: active ? 22 : 6,
                    borderRadius: 3,
                    border: "none",
                    backgroundColor: active ? CD.accent : "rgba(255,255,255,0.18)",
                    transition:
                      "width 260ms cubic-bezier(0.22,0.61,0.36,1), background-color 180ms",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={idx === 0}
              aria-label="Previous"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors disabled:opacity-30"
              style={{
                color: CD.ink,
                border: `1px solid ${CD.border}`,
                backgroundColor: "transparent",
              }}
              onMouseEnter={(e) => {
                if (idx === 0) return;
                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
                e.currentTarget.style.borderColor = CD.borderStrong;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.borderColor = CD.border;
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            {isLast ? (
              <button
                type="button"
                onClick={onApply}
                className="group inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold"
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
                Apply now
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next"
                className="inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-sm font-medium transition-colors"
                style={{
                  color: CD.ink,
                  border: `1px solid ${CD.border}`,
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
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────── slide body ──────────────────── */

function SlideBody({
  slide,
  index,
  active,
  direction,
}: {
  slide: Slide;
  index: number;
  active: boolean;
  direction: 1 | -1;
}) {
  return (
    <div className="relative mx-auto flex h-full max-w-[560px] flex-col items-center text-center">
      {/* Eyebrow */}
      <StaggerItem active={active} delay={80} dir={direction}>
        <span
          className="inline-flex items-center gap-3"
          style={{
            fontFamily: FONT_MONO,
            fontSize: "0.6875rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: CD.muted,
          }}
        >
          <span
            aria-hidden
            style={{ display: "inline-block", height: 2, width: "2rem", background: CD.ink }}
          />
          {slide.eyebrow}
          <span aria-hidden>· {index + 1} / {SLIDES.length}</span>
        </span>
      </StaggerItem>

      {/* Visual */}
      <StaggerItem active={active} delay={160} dir={direction}>
        <div className="my-5 sm:my-7">
          <SlideVisual variant={slide.visual} active={active} Icon={slide.icon} />
        </div>
      </StaggerItem>

      {/* Title */}
      <StaggerItem active={active} delay={220} dir={direction}>
        <h3
          className="text-[clamp(1.75rem,4vw,2.75rem)] font-semibold"
          style={{
            color: CD.ink,
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
          }}
        >
          {slide.title}
        </h3>
      </StaggerItem>

      {/* Body */}
      <StaggerItem active={active} delay={280} dir={direction}>
        <p
          className="mt-4 max-w-[42ch] text-[1rem] leading-relaxed md:text-[1.0625rem]"
          style={{ color: CD.muted }}
        >
          {slide.body}
        </p>
      </StaggerItem>
    </div>
  );
}

function StaggerItem({
  active,
  delay,
  dir,
  children,
}: {
  active: boolean;
  delay: number;
  dir: 1 | -1;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        opacity: active ? 1 : 0,
        transform: active ? "translateY(0)" : `translateY(${dir === 1 ? 8 : -8}px)`,
        transition: `opacity 360ms cubic-bezier(0.22,0.61,0.36,1) ${delay}ms, transform 360ms cubic-bezier(0.22,0.61,0.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/* ──────────────────── visuals ─────────────────────── */

function SlideVisual({
  variant,
  active,
  Icon,
}: {
  variant: Slide["visual"];
  active: boolean;
  Icon: typeof Coffee;
}) {
  const common = (
    <div
      className="relative mx-auto flex h-24 w-24 items-center justify-center rounded-full sm:h-28 sm:w-28"
      style={{
        backgroundColor: CD.surfaceAlt,
        border: `1px solid ${CD.border}`,
      }}
    >
      {/* soft pulse ring */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          border: `1px solid ${CD.accent}`,
          opacity: active ? 0.4 : 0,
          animation: active ? "cdPulse 2.4s ease-out infinite" : "none",
        }}
      />
      <Icon className="h-11 w-11" style={{ color: CD.accent }} strokeWidth={1.5} />
      <style>{`
        @keyframes cdPulse {
          0% { transform: scale(1); opacity: 0.5; }
          80% { transform: scale(1.35); opacity: 0; }
          100% { transform: scale(1.35); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes cdPulse { 0%,100% { transform: scale(1); opacity: 0; } }
        }
      `}</style>
    </div>
  );

  if (variant === "url") {
    return (
      <div className="flex flex-col items-center gap-3">
        {common}
        <div
          className="w-full max-w-[320px] rounded-[10px] p-3"
          style={{
            backgroundColor: CD.canvas,
            border: `1px solid ${CD.border}`,
          }}
        >
          <div
            className="mb-2 flex items-center gap-2 rounded-[6px] px-2 py-1.5"
            style={{
              backgroundColor: CD.surfaceAlt,
              border: `1px solid ${CD.border}`,
              fontFamily: FONT_MONO,
              fontSize: "0.8125rem",
              color: CD.ink,
            }}
          >
            <span style={{ color: CD.muted }}>https://</span>
            <TypedText
              active={active}
              text="theirshop.com"
              speedMs={55}
              style={{ color: CD.ink }}
            />
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 2,
                height: 12,
                background: CD.accent,
                animation: active ? "cdBlink 1s steps(1) infinite" : "none",
              }}
            />
            <style>{`@keyframes cdBlink { 50% { opacity: 0; } }`}</style>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { label: "In person", delay: 320 },
              { label: "Warm", delay: 400 },
              { label: "Regular", delay: 480 },
            ].map((chip) => (
              <span
                key={chip.label}
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: "0.6875rem",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: CD.muted,
                  backgroundColor: CD.surfaceAlt,
                  border: `1px solid ${CD.border}`,
                  borderRadius: 9999,
                  padding: "2px 8px",
                  opacity: active ? 1 : 0,
                  transform: active ? "translateY(0)" : "translateY(4px)",
                  transition: `opacity 360ms ease ${chip.delay}ms, transform 360ms ease ${chip.delay}ms`,
                }}
              >
                {chip.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "review") {
    return (
      <div className="flex flex-col items-center gap-3">
        {common}
        <div
          className="w-full max-w-[340px] rounded-[10px] p-3.5 text-left"
          style={{
            backgroundColor: CD.canvas,
            border: `1px solid ${CD.border}`,
          }}
        >
          <div className="mb-2 flex items-center gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <Star
                key={i}
                className="h-3.5 w-3.5"
                style={{
                  color: CD.accent,
                  fill: CD.accent,
                  opacity: active ? 1 : 0,
                  transform: active ? "scale(1)" : "scale(0.6)",
                  transition: `opacity 260ms ease ${260 + i * 80}ms, transform 260ms cubic-bezier(0.22,0.61,0.36,1) ${260 + i * 80}ms`,
                }}
              />
            ))}
          </div>
          <TypedReview
            active={active}
            text="Family-run since '08. Maria knows every regular by name. Their espresso rewired my mornings."
          />
          <div
            className="mt-2 flex items-center justify-between"
            style={{
              fontFamily: FONT_MONO,
              fontSize: "0.6875rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: CD.muted,
            }}
          >
            <span>— you, verified</span>
            <span style={{ color: CD.accent }}>Vetted</span>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "money") {
    return (
      <div className="flex flex-col items-center gap-4">
        {common}
        <div
          className="flex items-center gap-3"
          style={{ fontFamily: FONT_MONO, fontSize: "0.75rem", letterSpacing: "0.08em" }}
        >
          {["Mo 1", "Mo 2", "Mo 3", "Mo 4"].map((m, i) => (
            <span
              key={m}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1"
              style={{
                backgroundColor: CD.canvas,
                border: `1px solid ${CD.border}`,
                color: CD.muted,
                transform: active ? "translateY(0)" : "translateY(4px)",
                opacity: active ? 1 : 0,
                transition: `opacity 360ms ease ${340 + i * 80}ms, transform 360ms ease ${340 + i * 80}ms`,
              }}
            >
              <DollarSign className="h-3 w-3" style={{ color: CD.accent }} />
              {m}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "cpu") {
    return (
      <div className="flex flex-col items-center gap-4">
        {common}
        <div className="flex flex-col items-center gap-1.5">
          {["scraping", "analyzing", "ready"].map((label, i) => (
            <div
              key={label}
              className="flex items-center gap-2"
              style={{
                fontFamily: FONT_MONO,
                fontSize: "0.75rem",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: CD.muted,
                opacity: active ? 1 : 0,
                transform: active ? "translateY(0)" : "translateY(4px)",
                transition: `opacity 400ms ease ${320 + i * 160}ms, transform 400ms ease ${320 + i * 160}ms`,
              }}
            >
              <Sparkles className="h-3 w-3" style={{ color: CD.accent }} />
              {label}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "closer") {
    return (
      <div className="flex flex-col items-center gap-4">
        {common}
        <div
          className="flex items-end gap-1.5"
          style={{ height: 34 }}
          aria-hidden
        >
          {[12, 18, 24, 30].map((h, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                width: 8,
                height: h,
                borderRadius: 2,
                backgroundColor: i === 3 ? CD.accent : "rgba(255,255,255,0.14)",
                transformOrigin: "bottom",
                transform: active ? "scaleY(1)" : "scaleY(0.2)",
                opacity: active ? 1 : 0,
                transition: `transform 420ms cubic-bezier(0.22,0.61,0.36,1) ${340 + i * 90}ms, opacity 420ms ease ${340 + i * 90}ms`,
              }}
            />
          ))}
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
          Higher % when you close
        </span>
      </div>
    );
  }

  if (variant === "merch") {
    return (
      <div className="flex flex-col items-center gap-4">
        {common}
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {["Faith", "Tech", "Street", "Art"].map((g, i) => (
            <span
              key={g}
              style={{
                fontFamily: FONT_MONO,
                fontSize: "0.75rem",
                letterSpacing: "0.06em",
                color: CD.ink,
                backgroundColor: CD.canvas,
                border: `1px solid ${CD.border}`,
                borderRadius: 6,
                padding: "4px 8px",
                opacity: active ? 1 : 0,
                transform: active ? "translateY(0)" : "translateY(6px)",
                transition: `opacity 360ms ease ${300 + i * 80}ms, transform 360ms ease ${300 + i * 80}ms`,
              }}
            >
              {g}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "gift") {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          {common}
          {active &&
            [0, 1, 2, 3].map((i) => (
              <span
                key={i}
                aria-hidden
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  backgroundColor: i % 2 === 0 ? CD.accent : CD.ink,
                  animation: `cdSparkle 1.6s ease-out ${i * 0.2}s infinite`,
                  transformOrigin: "center",
                  // @ts-expect-error custom CSS vars for keyframes
                  "--sx": `${[28, -32, 22, -26][i]}px`,
                  "--sy": `${[-28, -22, 30, 26][i]}px`,
                }}
              />
            ))}
          <style>{`
            @keyframes cdSparkle {
              0% { transform: scale(0) translate(0,0); opacity: 0; }
              20% { opacity: 1; }
              100% { transform: scale(1) translate(var(--sx), var(--sy)); opacity: 0; }
            }
            @media (prefers-reduced-motion: reduce) {
              @keyframes cdSparkle { 0%,100% { opacity: 0; } }
            }
          `}</style>
        </div>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: "0.6875rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: CD.muted,
          }}
        >
          Announcements coming soon
        </span>
      </div>
    );
  }

  if (variant === "place") {
    return (
      <div className="flex flex-col items-center gap-4">
        {common}
        <div
          className="inline-flex items-center gap-1.5"
          style={{ fontFamily: FONT_MONO, fontSize: "0.75rem", color: CD.muted }}
          aria-hidden
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                transform: active ? "scale(1)" : "scale(0)",
                opacity: active ? 1 : 0,
                transition: `transform 320ms cubic-bezier(0.22,0.61,0.36,1) ${280 + i * 70}ms, opacity 320ms ease ${280 + i * 70}ms`,
                clipPath:
                  "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
                backgroundColor: CD.accent,
              }}
            />
          ))}
          <span className="ml-2">Your honest review</span>
        </div>
      </div>
    );
  }

  return common;
}

function TypedReview({ active, text }: { active: boolean; text: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!active) {
      setShown(0);
      return;
    }
    let i = 0;
    setShown(0);
    const id = setInterval(() => {
      i += 2;
      setShown(Math.min(i, text.length));
      if (i >= text.length) clearInterval(id);
    }, 18);
    return () => clearInterval(id);
  }, [active, text]);
  return (
    <p
      className="text-[0.8125rem] leading-snug"
      style={{ color: CD.ink, minHeight: "3.2em" }}
    >
      {text.slice(0, shown)}
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 2,
          height: "0.9em",
          background: CD.accent,
          marginLeft: 2,
          verticalAlign: "middle",
          animation: active && shown < text.length ? "cdBlink 1s steps(1) infinite" : "none",
        }}
      />
    </p>
  );
}

function TypedText({
  active,
  text,
  speedMs,
  style,
}: {
  active: boolean;
  text: string;
  speedMs: number;
  style?: React.CSSProperties;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!active) {
      setShown(0);
      return;
    }
    let i = 0;
    setShown(0);
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) clearInterval(id);
    }, speedMs);
    return () => clearInterval(id);
  }, [active, text, speedMs]);
  return <span style={style}>{text.slice(0, shown)}</span>;
}
