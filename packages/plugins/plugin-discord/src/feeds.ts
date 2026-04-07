import {
  EmbedBuilder,
  ChannelType,
  type Client,
  type TextChannel,
  type Guild,
} from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordConfig, FeedChannelIds, IntelReport, TweetPost } from "./types.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const COLORS = {
  twitterBlue: 0x1da1f2,
  gold: 0xd4a843,
  green: 0x3dd68c,
  red: 0xef5b5b,
  cosmosSlate: 0x6f7390,
  purple: 0x7b2d8e,
  githubDark: 0x24292e,
  redditOrange: 0xff4500,
};

const SEND_DELAY_MS = 350; // delay between Discord sends to respect rate limits

// ─── Interval handles ───────────────────────────────────────────────────────

let twitterPoller: ReturnType<typeof setInterval> | null = null;
let intelPoller: ReturnType<typeof setInterval> | null = null;
let pricePoller: ReturnType<typeof setInterval> | null = null;

// ─── Channel creation ───────────────────────────────────────────────────────

const FEED_DEFS = [
  { key: "twitterFeed" as const, configKey: "twitterFeedChannelId" as const, name: "twitter-feed", topic: "Live mirror of posted tweets and engagement updates" },
  { key: "priceAlerts" as const, configKey: "priceFeedChannelId" as const, name: "price-alerts", topic: "Price movement alerts and chain metrics" },
  { key: "intelFeed" as const, configKey: "intelFeedChannelId" as const, name: "intel-feed", topic: "News, GitHub releases, trending projects, and market intel" },
];

export async function ensureFeedChannels(
  client: Client,
  config: DiscordConfig,
  ctx: PluginContext,
): Promise<FeedChannelIds> {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) throw new Error("Guild not found for feed channels");

  const channels: FeedChannelIds = { twitterFeed: "", priceAlerts: "", intelFeed: "" };

  for (const def of FEED_DEFS) {
    // 1. Use configured ID if valid
    const configuredId = config[def.configKey];
    if (configuredId) {
      const existing = guild.channels.cache.get(configuredId);
      if (existing) { channels[def.key] = configuredId; continue; }
    }

    // 2. Check state for previously created channel
    const stateKey = `feed:channel:${def.key}`;
    const savedId = await ctx.state.get({ scopeKind: "instance", scopeId: "", stateKey });
    if (savedId) {
      const existing = guild.channels.cache.get(savedId as string);
      if (existing) { channels[def.key] = savedId as string; continue; }
    }

    // 3. Find by name
    const byName = guild.channels.cache.find((ch) => ch.name === def.name && ch.type === ChannelType.GuildText);
    if (byName) {
      channels[def.key] = byName.id;
      await ctx.state.set({ scopeKind: "instance", scopeId: "", stateKey }, byName.id);
      continue;
    }

    // 4. Create
    try {
      const created = await guild.channels.create({
        name: def.name,
        type: ChannelType.GuildText,
        parent: config.feedCategoryId || undefined,
        topic: def.topic,
      });
      channels[def.key] = created.id;
      await ctx.state.set({ scopeKind: "instance", scopeId: "", stateKey }, created.id);
      ctx.logger.info(`Created feed channel #${def.name}`, { channelId: created.id });
    } catch (err) {
      ctx.logger.error(`Failed to create #${def.name} — set the channel ID manually`, { error: String(err) });
    }
  }

  return channels;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function safeSend(channel: TextChannel | undefined, embed: EmbedBuilder, ctx: PluginContext): Promise<void> {
  if (!channel) return;
  try {
    await channel.send({ embeds: [embed] });
    await sleep(SEND_DELAY_MS);
  } catch (err) {
    ctx.logger.error("Failed to send feed embed", { error: String(err) });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + "..." : str;
}

async function getLastPoll(ctx: PluginContext, feedKey: string): Promise<string> {
  const state = await ctx.state.get({ scopeKind: "instance", scopeId: "", stateKey: `feed:${feedKey}:lastPoll` });
  if (state) return state as string;
  // First run: default to 30 minutes ago to avoid flooding
  return new Date(Date.now() - 30 * 60 * 1000).toISOString();
}

async function setLastPoll(ctx: PluginContext, feedKey: string, timestamp: string): Promise<void> {
  await ctx.state.set({ scopeKind: "instance", scopeId: "", stateKey: `feed:${feedKey}:lastPoll` }, timestamp);
}

// ─── Embed builders ─────────────────────────────────────────────────────────

function buildTweetEmbed(tweet: TweetPost): EmbedBuilder {
  const tweetUrl = `https://x.com/i/status/${tweet.tweet_id}`;
  return new EmbedBuilder()
    .setColor(COLORS.twitterBlue)
    .setAuthor({ name: "New Tweet Posted" })
    .setDescription(truncate(tweet.tweet_text, 4000))
    .addFields(
      { name: "Likes", value: String(tweet.like_count || 0), inline: true },
      { name: "Retweets", value: String(tweet.retweet_count || 0), inline: true },
      { name: "Replies", value: String(tweet.reply_count || 0), inline: true },
    )
    .setURL(tweetUrl)
    .setFooter({ text: "via X" })
    .setTimestamp(new Date(tweet.posted_at));
}

function buildPriceAlertEmbed(report: IntelReport): EmbedBuilder {
  const body = report.body || "";
  const isUp = !body.includes("-") || body.includes("+");
  const arrow = isUp ? "\u2191" : "\u2193";
  return new EmbedBuilder()
    .setColor(isUp ? COLORS.green : COLORS.red)
    .setTitle(`${arrow} ${report.company_name || report.company_slug}`)
    .setDescription(truncate(report.headline, 256))
    .setURL(report.source_url || undefined as unknown as string)
    .setFooter({ text: "Price Alert" })
    .setTimestamp(new Date(report.captured_at));
}

function buildChainMetricsEmbed(network: string, data: Record<string, unknown>): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.cosmosSlate)
    .setTitle(`${network.toUpperCase()} Chain Metrics`)
    .addFields(
      { name: "Staking APR", value: `${(data.stakingApr as number)?.toFixed(2) ?? "N/A"}%`, inline: true },
      { name: "Bonded Ratio", value: `${(data.bondedRatio as number)?.toFixed(1) ?? "N/A"}%`, inline: true },
      { name: "Inflation", value: `${(data.inflationRate as number)?.toFixed(2) ?? "N/A"}%`, inline: true },
    )
    .setFooter({ text: "via Mintscan" })
    .setTimestamp();
}

function buildIntelEmbed(report: IntelReport): EmbedBuilder {
  const colorMap: Record<string, number> = {
    news: COLORS.purple,
    github: COLORS.githubDark,
    reddit: COLORS.redditOrange,
    twitter: COLORS.twitterBlue,
    discovery: COLORS.green,
  };
  const labelMap: Record<string, string> = {
    news: "News",
    github: "GitHub Release",
    reddit: "Reddit",
    twitter: "Twitter Intel",
    discovery: "Trending Project",
  };

  const color = colorMap[report.report_type] ?? COLORS.purple;
  const label = labelMap[report.report_type] ?? report.report_type;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(truncate(report.headline, 256))
    .setFooter({ text: `${label} | ${report.company_name || report.company_slug}` })
    .setTimestamp(new Date(report.captured_at));

  if (report.body) {
    embed.setDescription(truncate(report.body, 300));
  }
  if (report.source_url) {
    embed.setURL(report.source_url);
  }

  return embed;
}

// ─── Pollers ────────────────────────────────────────────────────────────────

export function startTwitterFeedPoller(
  client: Client,
  config: DiscordConfig,
  channelIds: FeedChannelIds,
  ctx: PluginContext,
): void {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;
  const channel = guild.channels.cache.get(channelIds.twitterFeed) as TextChannel | undefined;

  const poll = async () => {
    try {
      const since = await getLastPoll(ctx, "twitter");
      const res = await fetch(`${config.dashboardApiUrl}/x/analytics/recent-posts?since=${encodeURIComponent(since)}&limit=10`);
      if (!res.ok) return;
      const data = await res.json() as { posts: TweetPost[] };
      if (!data.posts || data.posts.length === 0) return;

      // Post oldest first
      const sorted = [...data.posts].sort((a, b) => new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime());
      for (const tweet of sorted) {
        await safeSend(channel, buildTweetEmbed(tweet), ctx);
      }

      // Update cursor to the most recent tweet
      const latest = sorted[sorted.length - 1];
      await setLastPoll(ctx, "twitter", latest.posted_at);
      ctx.logger.info(`Twitter feed: posted ${sorted.length} tweets`, {});
    } catch (err) {
      ctx.logger.error("Twitter feed poll error", { error: String(err) });
    }
  };

  // Initial poll after 10s delay
  setTimeout(poll, 10_000);
  twitterPoller = setInterval(poll, 2 * 60 * 1000); // every 2 minutes
}

export function startIntelFeedPoller(
  client: Client,
  config: DiscordConfig,
  channelIds: FeedChannelIds,
  ctx: PluginContext,
): void {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;
  const channel = guild.channels.cache.get(channelIds.intelFeed) as TextChannel | undefined;

  const poll = async () => {
    try {
      const since = await getLastPoll(ctx, "intel");
      const types = "news,github,twitter,reddit,discovery";
      const res = await fetch(`${config.dashboardApiUrl}/intel/feed?since=${encodeURIComponent(since)}&type=${types}&limit=20`);
      if (!res.ok) return;
      const data = await res.json() as { reports: IntelReport[] };
      if (!data.reports || data.reports.length === 0) return;

      const sorted = [...data.reports].sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
      for (const report of sorted) {
        await safeSend(channel, buildIntelEmbed(report), ctx);
      }

      const latest = sorted[sorted.length - 1];
      await setLastPoll(ctx, "intel", latest.captured_at);
      ctx.logger.info(`Intel feed: posted ${sorted.length} reports`, {});
    } catch (err) {
      ctx.logger.error("Intel feed poll error", { error: String(err) });
    }
  };

  setTimeout(poll, 15_000);
  intelPoller = setInterval(poll, 3 * 60 * 1000); // every 3 minutes
}

export function startPriceFeedPoller(
  client: Client,
  config: DiscordConfig,
  channelIds: FeedChannelIds,
  ctx: PluginContext,
): void {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;
  const channel = guild.channels.cache.get(channelIds.priceAlerts) as TextChannel | undefined;

  let lastChainPoll = 0;

  const poll = async () => {
    try {
      // Price reports
      const since = await getLastPoll(ctx, "price");
      const res = await fetch(`${config.dashboardApiUrl}/intel/feed?since=${encodeURIComponent(since)}&type=price&limit=20`);
      if (res.ok) {
        const data = await res.json() as { reports: IntelReport[] };
        if (data.reports && data.reports.length > 0) {
          // Filter for significant moves (headline usually contains percentage)
          const significant = data.reports.filter((r) => {
            const match = r.headline.match(/([+-]?\d+\.?\d*)%/);
            if (!match) return true; // include if no % found (unusual headline)
            return Math.abs(parseFloat(match[1])) >= 5;
          });

          const sorted = [...significant].sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
          for (const report of sorted) {
            await safeSend(channel, buildPriceAlertEmbed(report), ctx);
          }

          const latest = data.reports.sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())[0];
          await setLastPoll(ctx, "price", latest.captured_at);
          if (sorted.length > 0) {
            ctx.logger.info(`Price feed: posted ${sorted.length} alerts`, {});
          }
        }
      }

      // Chain metrics every 4 hours
      const now = Date.now();
      if (now - lastChainPoll > 4 * 60 * 60 * 1000) {
        lastChainPoll = now;
        for (const network of ["cosmos", "osmosis", "txhuman"]) {
          try {
            const chainRes = await fetch(`${config.dashboardApiUrl}/intel/chain/${network}`);
            if (chainRes.ok) {
              const chainData = await chainRes.json() as Record<string, unknown>;
              if (chainData && (chainData.stakingApr || chainData.bondedRatio)) {
                await safeSend(channel, buildChainMetricsEmbed(network, chainData), ctx);
              }
            }
          } catch { /* skip failed chain */ }
        }
      }
    } catch (err) {
      ctx.logger.error("Price feed poll error", { error: String(err) });
    }
  };

  setTimeout(poll, 20_000);
  pricePoller = setInterval(poll, 5 * 60 * 1000); // every 5 minutes
}

// ─── Stop all pollers ───────────────────────────────────────────────────────

export function stopFeedPollers(): void {
  if (twitterPoller) { clearInterval(twitterPoller); twitterPoller = null; }
  if (intelPoller) { clearInterval(intelPoller); intelPoller = null; }
  if (pricePoller) { clearInterval(pricePoller); pricePoller = null; }
}
