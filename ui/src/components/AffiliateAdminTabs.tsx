import { Link } from "@/lib/router";

type TabKey =
  | "affiliates"
  | "leads"
  | "attribution"
  | "commissions"
  | "payouts"
  | "compliance"
  | "engagement"
  | "tiers"
  | "campaigns"
  | "merch";

interface Tab {
  key: TabKey;
  label: string;
  href: string;
}

const TABS: Tab[] = [
  { key: "affiliates", label: "Affiliates", href: "/affiliates" },
  { key: "leads", label: "Leads", href: "/affiliates/leads" },
  { key: "attribution", label: "Attribution", href: "/affiliates/attribution" },
  { key: "commissions", label: "Commissions", href: "/affiliates/commissions" },
  { key: "payouts", label: "Payouts", href: "/affiliates/payouts" },
  { key: "compliance", label: "Compliance", href: "/affiliates/compliance" },
  { key: "engagement", label: "Engagement", href: "/affiliates/engagement" },
  { key: "tiers", label: "Tiers", href: "/affiliates/tiers" },
  { key: "campaigns", label: "Campaigns", href: "/affiliates/campaigns" },
  { key: "merch", label: "Merch", href: "/affiliates/merch" },
];

export function AffiliateAdminTabs({ active }: { active: TabKey }) {
  return (
    <div className="border-b border-border">
      <nav className="flex items-center gap-1 -mb-px overflow-x-auto" aria-label="Affiliate admin sections">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              to={tab.href}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? "border-[#ff876d] text-[#ff876d]"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
