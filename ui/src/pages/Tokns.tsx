import { useEffect } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Hexagon,
  ExternalLink,
  ShoppingCart,
  Eye,
  ArrowLeftRight,
  Landmark,
  Sparkles,
  TrendingUp,
  Users,
  BarChart3,
  Layers,
  Globe,
} from "lucide-react";

// ── Tokns Properties ────────────────────────────────────────────────────────

const TOKNS_PROPERTIES = [
  {
    name: "tokns.fi",
    url: "https://tokns.fi",
    description: "Main landing — learn about TX, earning, and staking",
    icon: Globe,
    badge: "Marketing",
  },
  {
    name: "app.tokns.fi",
    url: "https://app.tokns.fi",
    description: "DApp — NFTs, swaps, staking, wallet tracking",
    icon: Layers,
    badge: "Product",
  },
];

const PLATFORM_FEATURES = [
  { title: "NFT Marketplace", description: "Buy, sell, and trade NFTs on the TX chain", icon: ShoppingCart },
  { title: "Multi-Wallet Watch", description: "Monitor balances, rewards, and history across wallets", icon: Eye },
  { title: "Token Swaps", description: "Instant swaps via TX chain DEX with low fees", icon: ArrowLeftRight },
  { title: "Validator Staking", description: "Stake with tokns.fi validator to earn and support community tools", icon: Landmark },
  { title: "Learn & Earn", description: "Educational content about TX blockchain and crypto", icon: Sparkles },
  { title: "Analytics", description: "Portfolio tracking, reward history, and performance stats", icon: BarChart3 },
];

// ── Page Component ──────────────────────────────────────────────────────────

export default function Tokns() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Tokns" }]);
  }, [setBreadcrumbs]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      {/* Hero */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#00C896]/10">
            <Hexagon className="h-5 w-5 text-[#00C896]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tokns Admin</h1>
            <p className="text-sm text-muted-foreground">
              Manage tokns.fi platform — the TX blockchain gateway for NFTs, swaps, staking, and learning.
            </p>
          </div>
        </div>
      </div>

      {/* Properties */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Properties</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {TOKNS_PROPERTIES.map((prop) => (
            <Card key={prop.name} className="rounded-xl">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <prop.icon className="h-4 w-4 text-[#00C896]" />
                    <CardTitle className="text-sm">{prop.name}</CardTitle>
                    <Badge variant="outline" className="text-[10px]">{prop.badge}</Badge>
                  </div>
                  <a
                    href={prop.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{prop.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Validator Stats */}
      <Card className="rounded-xl border-[#00C896]/20 bg-gradient-to-br from-[#00C896]/5 to-transparent">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-[#00C896]" />
            <CardTitle>tokns.fi Validator</CardTitle>
            <Badge className="bg-[#00C896]/15 text-[#00C896] border-[#00C896]/30">TX Chain</Badge>
          </div>
          <CardDescription>
            ShieldNest-operated validator — commission funds free community tools
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Status" value="Active" icon={TrendingUp} />
            <StatCard label="Goal" value="#1 Validator" icon={Sparkles} />
            <StatCard label="Operator" value="ShieldNest" icon={Users} />
            <StatCard label="Revenue Use" value="Free Tools" icon={BarChart3} />
          </div>
        </CardContent>
      </Card>

      {/* Platform Features */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Platform Features</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORM_FEATURES.map((feature) => (
            <Card key={feature.title} className="rounded-xl">
              <CardContent className="space-y-2 pt-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#00C896]/10">
                  <feature.icon className="h-4 w-4 text-[#00C896]" />
                </div>
                <h3 className="text-sm font-semibold">{feature.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle className="text-sm">Quick Links</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "TX Explorer", url: "https://tx.org" },
              { label: "tokns.fi", url: "https://tokns.fi" },
              { label: "App", url: "https://app.tokns.fi" },
              { label: "Coherence Daddy", url: "https://coherencedaddy.com" },
              { label: "ShieldNest", url: "https://shieldnest.org" },
            ].map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                {link.label}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        <Icon className="h-3 w-3" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
