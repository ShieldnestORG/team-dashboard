import { clearAffiliateToken } from "@/api/affiliates";
import { CD, FONT_MONO, LABEL_CAPS_STYLE } from "@/lib/cdDesign";

interface NavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/earnings", label: "Earnings" },
  { href: "/payouts", label: "Payouts" },
  { href: "/clawbacks", label: "Clawbacks" },
  { href: "/tiers", label: "Tiers" },
  { href: "/learn", label: "Learn" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/promo", label: "Promo" },
  { href: "/merch", label: "Merch" },
  { href: "/program-rules", label: "Program Rules" },
];

interface AffiliateNavProps {
  /** Path of the current page (e.g. "/dashboard") for active-link styling. */
  active?: string;
  /** Optional title / subtitle shown to the left of the links. */
  title?: string;
  subtitle?: string;
  /** Optional trailing slot rendered at the far right (before Log Out). */
  trailing?: React.ReactNode;
  /** When true, omit the Log Out button (used for pages with their own auth flow). */
  hideLogout?: boolean;
}

export function AffiliateNav({
  active,
  title,
  subtitle,
  trailing,
  hideLogout,
}: AffiliateNavProps) {
  function handleLogout() {
    clearAffiliateToken();
    window.location.href = "/";
  }

  return (
    <header
      className="sticky top-0 z-20 backdrop-blur-md"
      style={{
        backgroundColor: "rgba(14,14,16,0.85)",
        borderBottom: `1px solid ${CD.border}`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Brand lockup — mirrors site-header.tsx */}
        <a
          href="/dashboard"
          className="group flex min-w-0 items-center gap-3 transition-opacity hover:opacity-80"
          aria-label="Affiliate dashboard home"
        >
          <img
            src="/apple-touch-icon.png"
            alt=""
            className="h-9 w-9 flex-shrink-0"
            style={{ borderRadius: 8 }}
          />
          <div className="min-w-0 leading-tight">
            <div className="flex items-baseline gap-2">
              <span
                className="text-base font-semibold tracking-tight"
                style={{ letterSpacing: "-0.02em", color: CD.ink }}
              >
                Coherence Daddy
              </span>
              <span
                style={{
                  ...LABEL_CAPS_STYLE,
                  color: CD.muted,
                }}
                className="hidden sm:inline"
              >
                / Affiliates
              </span>
            </div>
            {(title || subtitle) && (
              <div className="mt-0.5 truncate">
                {subtitle && (
                  <span style={{ ...LABEL_CAPS_STYLE, color: CD.accent }}>
                    {subtitle}
                  </span>
                )}
                {title && (
                  <span
                    className="ml-2 truncate text-sm font-medium"
                    style={{ color: CD.muted }}
                  >
                    · {title}
                  </span>
                )}
              </div>
            )}
          </div>
        </a>

        {/* Right cluster: nav + trailing + logout */}
        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
          <nav className="flex items-center gap-0.5" aria-label="Affiliate sections">
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.href;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className="inline-flex items-center whitespace-nowrap px-3 py-1.5 transition-colors"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: "0.6875rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: isActive ? CD.accent : CD.muted,
                    borderBottom: `1.5px solid ${isActive ? CD.accent : "transparent"}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.color = CD.ink;
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.color = CD.muted;
                  }}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>
          {trailing}
          {!hideLogout && (
            <button
              onClick={handleLogout}
              className="ml-2 transition-colors"
              style={{
                fontFamily: FONT_MONO,
                fontSize: "0.6875rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: CD.muted,
                background: "transparent",
                border: "none",
                padding: "6px 8px",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = CD.ink)}
              onMouseLeave={(e) => (e.currentTarget.style.color = CD.muted)}
            >
              Log out
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
