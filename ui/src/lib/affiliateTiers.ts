// Hard-coded fallback tier ladder used by the public tiers page and any
// client-side display that needs the full ladder. The authoritative source of
// truth is the server; this mirror keeps the UI useful if the public endpoint
// is not yet exposed. Keep in sync with server-side tier thresholds.

export interface TierDefinition {
  name: string;
  displayOrder: number;
  commissionRate: number; // 0.10, 0.12, etc.
  minLifetimeCents: number;
  minActivePartners: number;
  perks: string[];
  /** Tailwind-friendly color tokens for badges/accents. */
  color: {
    text: string;
    bg: string;
    border: string;
    badge: string;
  };
}

export const TIER_LADDER: TierDefinition[] = [
  {
    name: "bronze",
    displayOrder: 1,
    commissionRate: 0.1,
    minLifetimeCents: 0,
    minActivePartners: 0,
    perks: [
      "10% commission on all referrals",
      "Affiliate dashboard access",
      "Starter merch request after first converted lead",
    ],
    color: {
      text: "text-amber-600",
      bg: "bg-amber-600/10",
      border: "border-amber-600/40",
      badge: "bg-amber-600/20 text-amber-600 border-amber-600/40",
    },
  },
  {
    name: "silver",
    displayOrder: 2,
    commissionRate: 0.12,
    minLifetimeCents: 1000_00,
    minActivePartners: 3,
    perks: [
      "12% commission on all referrals",
      "Silver merch drop eligibility",
      "Promo campaign invitations",
    ],
    color: {
      text: "text-zinc-400",
      bg: "bg-zinc-400/10",
      border: "border-zinc-400/40",
      badge: "bg-zinc-400/20 text-zinc-400 border-zinc-400/40",
    },
  },
  {
    name: "gold",
    displayOrder: 3,
    commissionRate: 0.15,
    minLifetimeCents: 5000_00,
    minActivePartners: 10,
    perks: [
      "15% commission on all referrals",
      "Priority admin support",
      "Featured on partner leaderboard",
      "Quarterly gold merch bundle",
    ],
    color: {
      text: "text-yellow-500",
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/40",
      badge: "bg-yellow-500/20 text-yellow-500 border-yellow-500/40",
    },
  },
  {
    name: "platinum",
    displayOrder: 4,
    commissionRate: 0.2,
    minLifetimeCents: 20000_00,
    minActivePartners: 25,
    perks: [
      "20% commission on all referrals",
      "Dedicated account strategist",
      "Invitation to annual partner summit",
      "Custom co-branded merch",
    ],
    color: {
      text: "text-indigo-500",
      bg: "bg-indigo-500/10",
      border: "border-indigo-500/40",
      badge: "bg-indigo-500/20 text-indigo-500 border-indigo-500/40",
    },
  },
];

const DEFAULT_COLOR = {
  text: "text-muted-foreground",
  bg: "bg-muted",
  border: "border-border",
  badge: "bg-muted text-muted-foreground border-border",
};

export function tierColorFor(name: string | null | undefined): TierDefinition["color"] {
  if (!name) return DEFAULT_COLOR;
  const match = TIER_LADDER.find((t) => t.name.toLowerCase() === name.toLowerCase());
  return match?.color ?? DEFAULT_COLOR;
}

export function formatTierName(name: string | null | undefined): string {
  if (!name) return "—";
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

export function formatDollarsCompact(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
