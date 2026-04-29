import { clearAffiliateToken } from "@/api/affiliates";

interface NavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/earnings", label: "Earnings" },
  { href: "/payouts", label: "Payouts" },
  { href: "/tiers", label: "Tiers" },
  { href: "/learn", label: "Learn" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/promo", label: "Promo" },
  { href: "/merch", label: "Merch" },
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
    <header className="bg-card border-b border-border sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <a
          href="/dashboard"
          className="flex items-center gap-3 min-w-0 group"
          aria-label="Affiliate dashboard home"
        >
          <img
            src="/brand/face-coral.svg"
            alt="Coherence Daddy"
            className="h-9 w-9 flex-shrink-0 transition-opacity group-hover:opacity-90"
          />
          <div className="min-w-0">
            {subtitle && (
              <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
            )}
            {title && (
              <h1 className="text-lg font-bold text-foreground truncate">{title}</h1>
            )}
          </div>
        </a>
        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
          <nav className="flex items-center gap-1 text-xs font-medium">
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.href;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 transition-colors border ${
                    isActive
                      ? "bg-[#ff876d]/15 text-[#ff876d] border-[#ff876d]/40"
                      : "bg-card text-muted-foreground border-transparent hover:text-foreground hover:border-border"
                  }`}
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
              className="text-sm text-muted-foreground hover:text-foreground transition-colors ml-1 sm:ml-2"
            >
              Log Out
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
