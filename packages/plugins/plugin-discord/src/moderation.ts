import {
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type Message,
  type TextChannel,
  type User,
  PermissionsBitField,
} from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordConfig, Warning, SpamEntry, ModActionLog } from "./types.js";

// ─── In-memory spam tracker ─────────────────────────────────────────────────

const spamTracker = new Map<string, SpamEntry>();

// ─── Warning state helpers ──────────────────────────────────────────────────

export async function getWarnings(ctx: PluginContext, userId: string): Promise<Warning[]> {
  const state = await ctx.state.get({
    scopeKind: "instance",
    scopeId: "",
    stateKey: `warnings:${userId}`,
  });
  if (!state) return [];
  const parsed = JSON.parse(state as string) as Warning[];
  return parsed;
}

export async function addWarning(
  ctx: PluginContext,
  userId: string,
  reason: string,
  adminId: string,
): Promise<Warning[]> {
  const warnings = await getWarnings(ctx, userId);
  warnings.push({ reason, adminId, date: new Date().toISOString() });
  await ctx.state.set(
    { scopeKind: "instance", scopeId: "", stateKey: `warnings:${userId}` },
    JSON.stringify(warnings),
  );
  return warnings;
}

export async function clearWarnings(ctx: PluginContext, userId: string): Promise<void> {
  await ctx.state.set(
    { scopeKind: "instance", scopeId: "", stateKey: `warnings:${userId}` },
    JSON.stringify([]),
  );
}

// ─── Mod action logging ─────────────────────────────────────────────────────

async function logModAction(ctx: PluginContext, action: ModActionLog): Promise<void> {
  const key = `modlog:${new Date().toISOString().slice(0, 10)}`;
  const existing = await ctx.state.get({ scopeKind: "instance", scopeId: "", stateKey: key });
  const logs: ModActionLog[] = existing ? JSON.parse(existing as string) : [];
  logs.push(action);
  await ctx.state.set({ scopeKind: "instance", scopeId: "", stateKey: key }, JSON.stringify(logs));

  ctx.logger.info("Mod action logged", { action: action.action, target: action.targetUserTag });
}

// ─── Mod log embed (posts to announcements channel) ─────────────────────────

export async function sendModLog(
  guild: Guild,
  title: string,
  admin: { tag?: string; id?: string } | User,
  target: User,
  reason: string,
  color: number,
  config: DiscordConfig,
): Promise<void> {
  if (!config.announcementsChannelId) return;
  const logChannel = guild.channels.cache.get(config.announcementsChannelId) as TextChannel | undefined;
  if (!logChannel) return;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: "Member", value: `${target.tag} (${target.id})`, inline: true },
      { name: "By", value: ("tag" in admin ? admin.tag : undefined) || "ShieldAssist", inline: true },
      { name: "Reason", value: reason, inline: false },
    )
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

// ─── Auto-warn (called by auto-mod checks) ─────────────────────────────────

export async function autoWarn(
  ctx: PluginContext,
  member: GuildMember,
  reason: string,
  channel: TextChannel,
  config: DiscordConfig,
): Promise<void> {
  const warnings = await addWarning(ctx, member.id, `[AUTO] ${reason}`, "ShieldAssist");
  const msg = await channel
    .send(`Warning: ${member} -- **Auto-warning:** ${reason} *(${warnings.length} total)*)`)
    .catch(() => null);
  if (msg) setTimeout(() => msg.delete().catch(() => {}), 8000);

  await sendModLog(
    member.guild,
    "Auto-Warning",
    { tag: "ShieldAssist", id: "0" },
    member.user,
    reason,
    0xd4a843,
    config,
  );

  await logModAction(ctx, {
    action: "auto_warning",
    targetUserId: member.id,
    targetUserTag: member.user.tag,
    adminId: "ShieldAssist",
    adminTag: "ShieldAssist",
    reason,
    timestamp: new Date().toISOString(),
  });

  if (warnings.length >= config.warningsBeforeKick) {
    await member.kick("Reached warning threshold (auto)").catch(() => {});
    await sendModLog(member.guild, "Auto-Kicked", { tag: "ShieldAssist" }, member.user, `Reached ${config.warningsBeforeKick} warnings`, 0xef5b5b, config);
    await logModAction(ctx, { action: "auto_kick", targetUserId: member.id, targetUserTag: member.user.tag, adminId: "ShieldAssist", adminTag: "ShieldAssist", reason: `Reached ${config.warningsBeforeKick} warnings`, timestamp: new Date().toISOString() });
  } else if (warnings.length >= config.warningsBeforeMute) {
    await member.timeout(10 * 60 * 1000, `Reached ${config.warningsBeforeMute} warnings (auto)`).catch(() => {});
    await sendModLog(member.guild, "Auto-Muted (10 min)", { tag: "ShieldAssist" }, member.user, `Reached ${config.warningsBeforeMute} warnings`, 0xff8c00, config);
  }
}

// ─── Auto-moderation checks (called on every non-mod message) ───────────────

export async function runAutoMod(
  ctx: PluginContext,
  message: Message,
  config: DiscordConfig,
): Promise<boolean> {
  const content = message.content.toLowerCase();
  const member = message.member;
  if (!member) return false;

  // Banned words
  const bannedWords = config.bannedWords || ["spam", "scam", "rug", "phishing"];
  if (bannedWords.some((w) => content.includes(w))) {
    await message.delete().catch(() => {});
    await autoWarn(ctx, member, "Use of banned word", message.channel as TextChannel, config);
    return true;
  }

  // @everyone/@here mentions
  if (message.mentions.everyone) {
    await message.delete().catch(() => {});
    await autoWarn(ctx, member, "Unauthorized @everyone or @here mention", message.channel as TextChannel, config);
    return true;
  }

  // Spam detection
  const userId = message.author.id;
  const now = Date.now();
  const tracker = spamTracker.get(userId) || { count: 0, last: 0 };
  tracker.count = now - tracker.last < config.spamWindowMs ? tracker.count + 1 : 1;
  tracker.last = now;
  spamTracker.set(userId, tracker);
  if (tracker.count >= config.spamThreshold) {
    await message.delete().catch(() => {});
    await autoWarn(ctx, member, "Spamming messages", message.channel as TextChannel, config);
    spamTracker.set(userId, { count: 0, last: 0 });
    return true;
  }

  // Discord invite links
  if (content.includes("discord.gg/") || content.includes("discord.com/invite/")) {
    await message.delete().catch(() => {});
    await autoWarn(ctx, member, "Posting unauthorised Discord invite links", message.channel as TextChannel, config);
    return true;
  }

  return false;
}

// ─── Check if member is a moderator ─────────────────────────────────────────

export function isModerator(member: GuildMember, config: DiscordConfig): boolean {
  const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
  return isAdmin || (!!config.roleModerator && member.roles.cache.has(config.roleModerator));
}

export function isAdmin(member: GuildMember): boolean {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

// ─── Get recent mod actions from state ──────────────────────────────────────

export async function getRecentModActions(
  ctx: PluginContext,
  days: number = 7,
  limit: number = 50,
): Promise<ModActionLog[]> {
  const actions: ModActionLog[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `modlog:${d.toISOString().slice(0, 10)}`;
    const existing = await ctx.state.get({ scopeKind: "instance", scopeId: "", stateKey: key });
    if (existing) {
      const parsed = JSON.parse(existing as string) as ModActionLog[];
      actions.push(...parsed);
    }
  }
  actions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return actions.slice(0, limit);
}
