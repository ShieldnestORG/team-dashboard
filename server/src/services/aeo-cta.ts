// AEO funnel CTA configuration
// These are appended to content to drive directory sign-ups

export interface AeoCta {
  tweetSuffix: string;       // ~50 chars, appended to tweet content
  blogCtaBlock: string;      // HTML paragraph for end of blog posts
  youtubeDescriptionBlock: string; // 3-line block for YouTube descriptions
  youtubePinnedComment: string;    // First pinned comment text
}

export const AEO_CTAS: Record<string, AeoCta> = {
  cd: {
    tweetSuffix: '\n\n🔍 Is your company in the AEO-powered directory? → https://directory.coherencedaddy.com',
    blogCtaBlock: '<div style="margin-top:2em;padding:1em;border-left:4px solid #FF6B6B;background:#fff5f5"><strong>Is your company in the best-connected AEO directory?</strong><br>532+ AI/ML, DeFi, Crypto &amp; DevTools companies — <a href="https://directory.coherencedaddy.com" style="color:#FF6B6B">Get Listed →</a></div>',
    youtubeDescriptionBlock: '🔗 Get your company listed in the AEO-powered directory:\nhttps://directory.coherencedaddy.com\n📊 Real-time intelligence on 532+ AI/ML, DeFi, Crypto & DevTools companies.',
    youtubePinnedComment: '🔍 Want your company featured in the Coherence Daddy AEO Directory? Get listed today → https://directory.coherencedaddy.com',
  },
  tokns: {
    tweetSuffix: '\n\n📈 Track it all on tokns.fi → https://app.tokns.fi',
    blogCtaBlock: '<div style="margin-top:2em;padding:1em;border-left:4px solid #a78bfa;background:#f5f3ff"><strong>Track crypto, NFTs, and staking in one place.</strong><br><a href="https://app.tokns.fi" style="color:#7c3aed">Try tokns.fi →</a></div>',
    youtubeDescriptionBlock: '📈 Track your crypto portfolio on tokns.fi:\nhttps://app.tokns.fi\n💎 NFTs, staking, swaps — all in one dashboard.',
    youtubePinnedComment: '📈 Track all the projects mentioned in this video on tokns.fi → https://app.tokns.fi',
  },
  tx: {
    tweetSuffix: '\n\n⛓️ Build on TX Blockchain → https://tx.org',
    blogCtaBlock: '<div style="margin-top:2em;padding:1em;border-left:4px solid #84cc16;background:#f7fee7"><strong>Build on TX Blockchain — the Cosmos SDK L1 with IBC.</strong><br><a href="https://tx.org" style="color:#65a30d">Explore TX →</a></div>',
    youtubeDescriptionBlock: '⛓️ Build on TX Blockchain (Cosmos SDK, IBC-enabled):\nhttps://tx.org\n🚀 The fastest-growing L1 in the Cosmos ecosystem.',
    youtubePinnedComment: '⛓️ Interested in TX Blockchain? Explore the ecosystem → https://tx.org',
  },
  shieldnest: {
    tweetSuffix: '\n\n🛡️ Privacy-first dev infrastructure → https://shieldnest.org',
    blogCtaBlock: '<div style="margin-top:2em;padding:1em;border-left:4px solid #38bdf8;background:#f0f9ff"><strong>Privacy-first development infrastructure by ShieldNest.</strong><br><a href="https://shieldnest.org" style="color:#0284c7">Learn More →</a></div>',
    youtubeDescriptionBlock: '🛡️ Privacy-first dev infrastructure by ShieldNest:\nhttps://shieldnest.org\n🔐 We build secure, scalable systems for the next web.',
    youtubePinnedComment: '🛡️ Want privacy-first infrastructure for your project? Check out ShieldNest → https://shieldnest.org',
  },
  directory: {
    tweetSuffix: '\n\n📂 Browse 532+ companies in the AEO directory → https://directory.coherencedaddy.com',
    blogCtaBlock: '<div style="margin-top:2em;padding:1em;border-left:4px solid #FF6B6B;background:#fff5f5"><strong>Discover 532+ AI/ML, DeFi, Crypto &amp; DevTools companies.</strong><br>The AEO-powered directory with real-time intelligence — <a href="https://directory.coherencedaddy.com" style="color:#FF6B6B">Browse Now →</a></div>',
    youtubeDescriptionBlock: '📂 Discover 532+ tech companies in the AEO-powered directory:\nhttps://directory.coherencedaddy.com\n🔍 AI/ML, DeFi, Crypto & DevTools — all with real-time intelligence.',
    youtubePinnedComment: '📂 Browse the full AEO-powered directory of 532+ tech companies → https://directory.coherencedaddy.com',
  },
  partners: {
    tweetSuffix: '\n\n🤝 Partner with Coherence Daddy to grow your business → https://coherencedaddy.com',
    blogCtaBlock: '<div style="margin-top:2em;padding:1em;border-left:4px solid #f59e0b;background:#fffbeb"><strong>Grow your business with AEO-powered content marketing.</strong><br>Coherence Daddy drives real traffic to local partners — <a href="https://coherencedaddy.com" style="color:#d97706">Become a Partner →</a></div>',
    youtubeDescriptionBlock: '🤝 Grow your business with AEO-powered content marketing:\nhttps://coherencedaddy.com\n📣 Coherence Daddy drives real, qualified traffic to local partners.',
    youtubePinnedComment: '🤝 Want to grow your business with AEO content? Partner with Coherence Daddy → https://coherencedaddy.com',
  },
  default: {
    tweetSuffix: '\n\n🌐 coherencedaddy.com',
    blogCtaBlock: '',
    youtubeDescriptionBlock: 'Learn more at https://coherencedaddy.com',
    youtubePinnedComment: '',
  },
};

export function getAeoCta(brand?: string): AeoCta {
  return AEO_CTAS[brand ?? 'cd'] ?? AEO_CTAS['default'];
}
