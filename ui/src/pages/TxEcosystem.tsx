import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { pulseApi } from "../api/pulse";
import { queryKeys } from "../lib/queryKeys";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Coins,
  Trophy,
  ExternalLink,
  Globe,
  ShoppingCart,
  Eye,
  ArrowLeftRight,
  Landmark,
  Copy,
  Check,
  Megaphone,
  Shield,
  Wrench,
  Layers,
  Sparkles,
  Radio,
  TrendingUp,
  MessageCircle,
} from "lucide-react";

// ── Ecosystem Links ─────────────────────────────────────────────────────────

const ECOSYSTEM_LINKS = [
  {
    name: "tx.org",
    url: "https://tx.org",
    description: "TX Blockchain — Cosmos SDK L1",
    icon: Layers,
    color: "text-blue-400",
  },
  {
    name: "tokns.fi",
    url: "https://tokns.fi",
    description: "Learn & Earn TX Token",
    icon: Coins,
    color: "text-[#00C896]",
  },
  {
    name: "app.tokns.fi",
    url: "https://app.tokns.fi",
    description: "Trade NFTs, Swap Tokens, Stake",
    icon: ArrowLeftRight,
    color: "text-[#00C896]",
  },
  {
    name: "shieldnest.org",
    url: "https://shieldnest.org",
    description: "Privacy-First Dev Partner",
    icon: Shield,
    color: "text-purple-400",
  },
  {
    name: "coherencedaddy.com",
    url: "https://coherencedaddy.com",
    description: "Free Tools & Community Products",
    icon: Wrench,
    color: "text-amber-400",
  },
];

// ── Key Features ────────────────────────────────────────────────────────────

const KEY_FEATURES = [
  {
    title: "Buy, Sell & Trade NFTs",
    description: "Full NFT marketplace on the TX chain with collection browsing, listing, and trading.",
    icon: ShoppingCart,
  },
  {
    title: "Watch Multiple Wallets",
    description: "Monitor any TX wallet address. Track balances, staking rewards, and transaction history.",
    icon: Eye,
  },
  {
    title: "Swap Tokens",
    description: "Instant token swaps on TX chain DEX with competitive rates and low fees.",
    icon: ArrowLeftRight,
  },
  {
    title: "Stake to tokns.fi Validator",
    description: "Earn staking rewards while supporting community-built free tools and open-source development.",
    icon: Landmark,
  },
];

// ── Promo Copy ──────────────────────────────────────────────────────────────

const PROMO_COPY = {
  short:
    "The best place to learn and earn TX token is tokns.fi. Stake with the tokns.fi validator to support community-built free tools via @shieldnest and @coherencedaddy",
  medium:
    "tokns.fi is the all-in-one platform for the TX ecosystem. Learn about TX blockchain, earn TX tokens, trade NFTs, swap tokens, and stake with the tokns.fi validator. Every delegation supports free tools built by ShieldNest and Coherence Daddy for the community. Whether you're new to crypto or a seasoned trader, tokns.fi makes it easy to participate in the TX ecosystem.",
  long:
    "The TX blockchain is a Cosmos SDK Layer 1 chain built for community ownership and participation. tokns.fi serves as the primary gateway to this ecosystem — offering education, token earning opportunities, an NFT marketplace, token swaps, and wallet monitoring all in one place.\n\nAt app.tokns.fi, users can buy, sell, and trade NFTs across the TX chain, watch multiple wallet addresses for real-time balance and reward tracking, swap tokens through the built-in DEX, and stake TX tokens with validators of their choice.\n\nThe tokns.fi validator is operated by ShieldNest, a privacy-first development company that channels staking commission revenue directly into building free, open-source tools for the community. These tools are published through Coherence Daddy (coherencedaddy.com), which currently offers 27 free tools spanning productivity, development, and crypto utilities.\n\nBy staking with the tokns.fi validator, delegators earn competitive staking rewards while simultaneously funding the development of community resources. This creates a sustainable cycle: users stake, validators earn commission, and that commission funds free products that benefit the entire ecosystem.\n\nThe goal is for the tokns.fi validator to become the #1 validator on the TX chain by delegation — not through marketing spend, but through genuine value creation for the community.",
};

// ── Copy Button ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-[#00C896]" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Page Component ──────────────────────────────────────────────────────────

export function TxEcosystem() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "TX Ecosystem" }]);
  }, [setBreadcrumbs]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      {/* ── Hero Section ──────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#00C896]/10">
            <Coins className="h-5 w-5 text-[#00C896]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">TX Ecosystem Hub</h1>
            <p className="text-sm text-muted-foreground">
              Promote TX.org and the tokns.fi platform — the best place to learn, earn, buy, sell,
              trade NFTs, watch wallets, swap tokens, and stake TX.
            </p>
          </div>
        </div>
      </div>

      {/* ── Social Pulse Widget ────────────────────────────────────────── */}
      <PulseWidget />

      {/* ── Validator Goal Card ───────────────────────────────────────── */}
      <Card className="rounded-xl border-[#00C896]/20 bg-gradient-to-br from-[#00C896]/5 to-transparent">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00C896]/10">
              <Trophy className="h-6 w-6 text-[#00C896]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl">Goal: #1 Validator on TX Chain</CardTitle>
                <Badge className="bg-[#00C896]/15 text-[#00C896] border-[#00C896]/30">
                  tokns.fi validator
                </Badge>
              </div>
              <CardDescription className="mt-1">
                Staking with the tokns.fi validator helps support the community and funds free
                products through ShieldNest and Coherence Daddy.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Strategy</p>
              <p className="mt-1 text-sm">Build delegation through genuine community value</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Revenue Use</p>
              <p className="mt-1 text-sm">Commission funds free tools via ShieldNest</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Community Impact</p>
              <p className="mt-1 text-sm">27+ free tools on coherencedaddy.com</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Ecosystem Links Grid ──────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Ecosystem Properties</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {ECOSYSTEM_LINKS.map((link) => (
            <Card key={link.name} className="rounded-xl">
              <CardContent className="flex flex-col items-start gap-3 pt-0">
                <div className="flex items-center gap-2">
                  <link.icon className={`h-5 w-5 ${link.color}`} />
                  <span className="text-sm font-semibold">{link.name}</span>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <p className="text-xs text-muted-foreground">{link.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ── Key Features Section ──────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Key Features</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {KEY_FEATURES.map((feature) => (
            <Card key={feature.title} className="rounded-xl">
              <CardContent className="space-y-2 pt-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#00C896]/10">
                  <feature.icon className="h-4 w-4 text-[#00C896]" />
                </div>
                <h3 className="text-sm font-semibold">{feature.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ── Promotion Content Section ─────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Promotion Copy</h2>
          <span className="text-xs text-muted-foreground">Pre-written content for agents</span>
        </div>

        <div className="space-y-4">
          {/* Short */}
          <Card className="rounded-xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">Short</CardTitle>
                  <Badge variant="outline" className="text-xs">
                    Tweet-length
                  </Badge>
                </div>
                <CopyButton text={PROMO_COPY.short} />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">{PROMO_COPY.short}</p>
            </CardContent>
          </Card>

          {/* Medium */}
          <Card className="rounded-xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">Medium</CardTitle>
                  <Badge variant="outline" className="text-xs">
                    Social post
                  </Badge>
                </div>
                <CopyButton text={PROMO_COPY.medium} />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">{PROMO_COPY.medium}</p>
            </CardContent>
          </Card>

          {/* Long */}
          <Card className="rounded-xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">Long</CardTitle>
                  <Badge variant="outline" className="text-xs">
                    Blog / Article
                  </Badge>
                </div>
                <CopyButton text={PROMO_COPY.long} />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {PROMO_COPY.long}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Social Pulse Widget ──────────────────────────────────────────────────────

function PulseWidget() {
  const { data: summary } = useQuery({
    queryKey: queryKeys.pulse.summary(24),
    queryFn: () => pulseApi.getSummary(24),
    refetchInterval: 120_000,
  });

  const { data: xrpl } = useQuery({
    queryKey: queryKeys.pulse.xrplBridge,
    queryFn: () => pulseApi.getXrplBridge(),
    refetchInterval: 120_000,
  });

  return (
    <Card className="rounded-xl border-blue-400/20 bg-gradient-to-br from-blue-500/5 to-purple-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-blue-400" />
            <CardTitle className="text-sm">Social Pulse</CardTitle>
            <Badge className="bg-blue-400/10 text-blue-400 border-blue-400/30 text-[10px]">LIVE</Badge>
          </div>
          <a href="/social-pulse" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            View Dashboard &rarr;
          </a>
        </div>
        <CardDescription className="text-xs">
          Real-time X/Twitter intelligence for the TX ecosystem
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <MessageCircle className="h-3 w-3" />
              <span className="text-[10px]">Tweets (24h)</span>
            </div>
            <p className="text-lg font-bold tabular-nums">{summary?.totalTweets24h ?? 0}</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <TrendingUp className="h-3 w-3" />
              <span className="text-[10px]">Sentiment</span>
            </div>
            <p className="text-lg font-bold tabular-nums">
              {summary ? `${Math.round(summary.overallSentiment * 100)}%` : "--"}
            </p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <ArrowLeftRight className="h-3 w-3" />
              <span className="text-[10px]">XRPL Bridge</span>
            </div>
            <p className="text-lg font-bold tabular-nums">{xrpl?.totalMentions24h ?? 0}</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Sparkles className="h-3 w-3" />
              <span className="text-[10px]">Staking Talk</span>
            </div>
            <p className="text-lg font-bold tabular-nums">{xrpl?.stakingMentionPct ?? 0}%</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
