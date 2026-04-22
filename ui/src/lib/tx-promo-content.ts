// ─── TX / tokns.fi Promotional Content ──────────────────────────────────────
// Static tweet and thread content for the Twitter pipeline to reference
// when promoting the TX blockchain ecosystem and tokns.fi platform.

export interface PromoTweet {
  text: string;
  hashtags: string[];
  venture: string;
  category: "awareness" | "staking" | "features" | "community" | "validator";
}

export interface PromoThread {
  tweets: string[];
  hashtags: string[];
  venture: string;
  category: string;
}

// ─── Individual Tweets ──────────────────────────────────────────────────────

export const TX_PROMO_TWEETS: PromoTweet[] = [
  // Awareness
  {
    text: "TX is a Cosmos SDK blockchain with full IBC support. Fast finality, cross-chain transfers, and a growing ecosystem of builders. tokns.fi is your gateway in.",
    hashtags: ["TX", "Cosmos", "IBC", "tokns"],
    venture: "tokns",
    category: "awareness",
  },
  {
    text: "Most people hear about TX but don't know where to start. tokns.fi was built to fix that. Learn the ecosystem, track your portfolio, and stake — all in one place.",
    hashtags: ["TX", "tokns", "crypto"],
    venture: "tokns",
    category: "awareness",
  },
  {
    text: "The TX chain is IBC-enabled, meaning your assets can move freely across the Cosmos ecosystem. Bridge in, stake, swap, and earn — all from tokns.fi.",
    hashtags: ["TX", "IBC", "Cosmos", "DeFi"],
    venture: "tokns",
    category: "awareness",
  },
  {
    text: "TX isn't just another L1. It's built on Cosmos SDK with real IBC interoperability. If you're exploring the interchain future, tokns.fi is the best place to start.",
    hashtags: ["TX", "Cosmos", "interchain"],
    venture: "tokns",
    category: "awareness",
  },

  // Features
  {
    text: "What can you do on app.tokns.fi? Trade NFTs, watch multiple wallets in one dashboard, swap tokens, and stake TX. One platform, everything you need.",
    hashtags: ["tokns", "TX", "NFTs", "staking"],
    venture: "tokns",
    category: "features",
  },
  {
    text: "Multi-wallet watching on app.tokns.fi means you can track all your TX addresses from a single dashboard. No more switching between explorers.",
    hashtags: ["tokns", "TX", "portfolio"],
    venture: "tokns",
    category: "features",
  },
  {
    text: "NFT trading on TX just got easier. Browse, buy, and sell directly on app.tokns.fi with a clean interface and real-time listings.",
    hashtags: ["tokns", "TX", "NFTs"],
    venture: "tokns",
    category: "features",
  },
  {
    text: "Token swaps on app.tokns.fi are fast, simple, and built for the TX ecosystem. No complicated DEX interfaces — just pick your pair and go.",
    hashtags: ["tokns", "TX", "DeFi", "swap"],
    venture: "tokns",
    category: "features",
  },

  // Staking
  {
    text: "Staking TX on tokns.fi takes 30 seconds. Pick the tokns.fi validator, set your amount, confirm. Your tokens earn rewards while you sleep.",
    hashtags: ["TX", "staking", "tokns"],
    venture: "tokns",
    category: "staking",
  },
  {
    text: "Every TX token you stake with the tokns.fi validator earns rewards and strengthens the network. Passive income that actually supports something real.",
    hashtags: ["TX", "staking", "validator"],
    venture: "tokns",
    category: "staking",
  },
  {
    text: "Don't let your TX sit idle. Stake with tokns.fi and earn rewards while contributing to network security. It's the easiest yield in the Cosmos ecosystem.",
    hashtags: ["TX", "staking", "Cosmos", "yield"],
    venture: "tokns",
    category: "staking",
  },

  // Validator
  {
    text: "When you stake with the tokns.fi validator, you're funding free tools for the TX community. Built by ShieldNest and Coherence Daddy, for everyone.",
    hashtags: ["TX", "tokns", "ShieldNest", "CoherenceDaddy"],
    venture: "tokns",
    category: "validator",
  },
  {
    text: "Our goal: become the #1 validator on TX chain. Not for vanity — because more delegation means more resources to build free community tools.",
    hashtags: ["TX", "tokns", "validator"],
    venture: "tokns",
    category: "validator",
  },
  {
    text: "The tokns.fi validator is run by ShieldNest, the team behind coherencedaddy.com's free tools. Stake with us and you're directly supporting open community infrastructure.",
    hashtags: ["TX", "ShieldNest", "CoherenceDaddy", "validator"],
    venture: "tokns",
    category: "validator",
  },
  {
    text: "Choosing a validator matters. tokns.fi commission goes straight back into building: free tools, dashboards, and resources for the TX ecosystem.",
    hashtags: ["TX", "tokns", "validator", "community"],
    venture: "tokns",
    category: "validator",
  },

  // Community
  {
    text: "tokns.fi isn't a VC-backed product. It's community infrastructure built by ShieldNest and Coherence Daddy. Every feature exists because the ecosystem needed it.",
    hashtags: ["TX", "tokns", "community", "ShieldNest"],
    venture: "tokns",
    category: "community",
  },
  {
    text: "We're building tokns.fi in public. NFT marketplace, wallet tracker, staking portal, token swaps — all open and growing. Join us at tokns.fi.",
    hashtags: ["TX", "tokns", "buildinpublic"],
    venture: "tokns",
    category: "community",
  },
  {
    text: "The TX ecosystem deserves great tooling. That's why shieldnest.org and coherencedaddy.com partnered to build tokns.fi — a home for everything TX.",
    hashtags: ["TX", "tokns", "ShieldNest", "CoherenceDaddy"],
    venture: "tokns",
    category: "community",
  },
  {
    text: "New to TX? Start at tokns.fi. Learn about the chain, explore the ecosystem, set up staking, and track your wallet — all beginner-friendly.",
    hashtags: ["TX", "tokns", "crypto", "beginners"],
    venture: "tokns",
    category: "community",
  },
];

// ─── Threads ────────────────────────────────────────────────────────────────

export const TX_PROMO_THREADS: PromoThread[] = [
  {
    tweets: [
      "Why is tokns.fi the best hub for the TX ecosystem? A thread.",
      "TX is a Cosmos SDK chain with IBC support, fast finality, and a growing community. But until now there hasn't been one place to do everything.",
      "tokns.fi brings it all together: staking, NFT trading, token swaps, multi-wallet tracking, and educational content — in a single platform.",
      "Built by ShieldNest (shieldnest.org) and Coherence Daddy (coherencedaddy.com), tokns.fi is community infrastructure, not a VC exit strategy.",
      "We run a validator too. Every delegation helps us build more free tools for the TX community. Our goal is to become the #1 validator on the chain.",
      "Whether you're a day-one holder or just discovering TX, tokns.fi is your starting point. Learn. Earn. Stake. Trade. All in one place.",
    ],
    hashtags: ["TX", "tokns", "Cosmos", "IBC"],
    venture: "tokns",
    category: "ecosystem-overview",
  },
  {
    tweets: [
      "Here's everything you can do on app.tokns.fi right now:",
      "NFT Trading — Browse, buy, and sell TX NFTs with a clean marketplace interface. No third-party hops needed.",
      "Multi-Wallet Watching — Add all your TX addresses and see your full portfolio in one dashboard. Balances, history, and staking rewards at a glance.",
      "Token Swaps — Swap between TX ecosystem tokens quickly. Simple UI, fair rates, no confusion.",
      "Staking — Delegate TX to the tokns.fi validator in a few clicks. Earn rewards while supporting community tool development. Try it at app.tokns.fi.",
    ],
    hashtags: ["tokns", "TX", "NFTs", "staking", "DeFi"],
    venture: "tokns",
    category: "features-walkthrough",
  },
  {
    tweets: [
      "Why should you stake TX with the tokns.fi validator? Here's the case.",
      "Most validators take commission and... that's it. The tokns.fi validator is different. Commission funds real, free tools for the TX community.",
      "We're the team behind coherencedaddy.com's 27 free tools and shieldnest.org's privacy-first infrastructure. We build things people actually use.",
      "More delegation = more resources for us to ship. NFT tools, wallet dashboards, analytics, educational content — all free, all open.",
      "Our goal is to be the #1 validator on TX. Not because we want a title — because more stake means more we can build. Delegate at app.tokns.fi.",
    ],
    hashtags: ["TX", "staking", "validator", "tokns"],
    venture: "tokns",
    category: "validator-pitch",
  },
  {
    tweets: [
      "New to the TX blockchain? Here's your beginner guide. (Thread)",
      "TX is built on Cosmos SDK — the same framework behind Cosmos Hub, Osmosis, and dozens of other chains. It supports IBC, so your assets aren't trapped.",
      "To get started, head to tokns.fi. You'll find educational content explaining how TX works, what makes it unique, and where the ecosystem is headed.",
      "Next step: set up staking. Delegate your TX to a validator (we recommend tokns.fi) and start earning rewards immediately. It takes under a minute.",
      "Want to go further? app.tokns.fi lets you trade NFTs, swap tokens, and watch multiple wallets. Everything you need as you go deeper into TX.",
      "The TX community is growing fast. Join early, stake smart, and build alongside us. Start at tokns.fi — your home for everything TX.",
    ],
    hashtags: ["TX", "Cosmos", "crypto", "beginners", "tokns"],
    venture: "tokns",
    category: "beginner-guide",
  },
];

// ─── Key Messages ───────────────────────────────────────────────────────────

export const TX_KEY_MESSAGES = {
  short:
    "tokns.fi is the all-in-one platform for the TX ecosystem. Stake, trade NFTs, swap tokens, and track your wallets — built by ShieldNest and Coherence Daddy.",
  medium:
    "tokns.fi brings together everything you need for the TX blockchain: staking with our community validator, NFT trading, token swaps, and multi-wallet tracking. Built by ShieldNest and Coherence Daddy, every feature is designed to make TX accessible and rewarding.",
  long:
    "tokns.fi is the comprehensive hub for the TX blockchain ecosystem, built by ShieldNest (shieldnest.org) in partnership with Coherence Daddy (coherencedaddy.com). The platform provides a full suite of tools including NFT marketplace trading, token swaps, multi-wallet portfolio tracking, and one-click staking through the tokns.fi validator. As a Cosmos SDK chain with IBC interoperability, TX offers fast finality and cross-chain capability — and tokns.fi makes all of it accessible to both newcomers and power users. Validator commission directly funds the development of free community tools, with the goal of becoming the number one validator on the TX chain.",
  tagline: "Learn. Earn. Stake. Trade. All on tokns.fi",
  validatorPitch:
    "The tokns.fi validator is run by ShieldNest, the team behind coherencedaddy.com's free tools. Every TX delegated to our validator funds open community infrastructure — dashboards, analytics, educational content, and more. Our goal is to become the #1 validator on TX chain, because more delegation means more we can build for everyone.",
};
