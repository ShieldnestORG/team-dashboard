import { EmbedBuilder, type Message, type TextChannel, type ThreadChannel, type GuildTextBasedChannel } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordConfig } from "./types.js";

/** Safe channel send — casts to a sendable channel type. */
function ch(message: Message): GuildTextBasedChannel {
  return message.channel as GuildTextBasedChannel;
}
import {
  getWarnings,
  addWarning,
  clearWarnings,
  sendModLog,
  isModerator,
  isAdmin,
} from "./moderation.js";
import {
  getTicket,
  getAllOpenTickets,
  closeTicket,
  setupTicketPanel,
  updateTicketLog,
  saveTicket,
} from "./ticketing.js";

// ─── Duration parser ────────────────────────────────────────────────────────

function parseDuration(str: string): number | null {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const map: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(match[1]) * map[match[2]];
}

// ─── Response helper (DM for some commands) ─────────────────────────────────

const DM_RESPONSE_COMMANDS = ["tickets"];

async function sendResponse(message: Message, command: string, payload: any): Promise<void> {
  if (DM_RESPONSE_COMMANDS.includes(command)) {
    try {
      await message.author.send(payload);
    } catch {
      const msg = await ch(message).send(payload);
      setTimeout(() => msg.delete().catch(() => {}), 10000);
    }
  } else {
    await ch(message).send(payload);
  }
}

function noPerms(message: Message): Promise<Message> {
  return ch(message).send("You do not have permission to use this command.");
}

// ─── Main command dispatcher ────────────────────────────────────────────────

export async function handleCommand(
  ctx: PluginContext,
  message: Message,
  config: DiscordConfig,
): Promise<void> {
  const content = message.content;
  if (!content.startsWith("!")) return;

  const args = content.slice(1).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  if (!command) return;

  const member = message.member;
  if (!member) return;

  const _isMod = isModerator(member, config);
  const _isAdmin = isAdmin(member);

  switch (command) {
    case "warn":
      return handleWarn(ctx, message, args, _isMod, config);
    case "warnings":
      return handleWarnings(ctx, message, _isMod);
    case "clearwarnings":
      return handleClearWarnings(ctx, message, _isAdmin, config);
    case "mute":
      return handleMute(message, args, _isMod, config);
    case "unmute":
      return handleUnmute(message, _isMod, config);
    case "kick":
      return handleKick(message, args, _isMod, config);
    case "ban":
      return handleBan(message, args, _isAdmin, config);
    case "unban":
      return handleUnban(message, args, _isAdmin);
    case "purge":
      return handlePurge(message, args, _isMod);
    case "announce":
      return handleAnnounce(message, args, _isAdmin);
    case "addrole":
      return handleAddRole(message, args, _isAdmin);
    case "removerole":
      return handleRemoveRole(message, args, _isAdmin);
    case "serverinfo":
      return handleServerInfo(message);
    case "userinfo":
      return handleUserInfo(message);
    case "setup-tickets":
      return handleSetupTickets(message, _isAdmin, config);
    case "close":
      return handleClose(ctx, message, _isMod, config);
    case "closeall":
      return handleCloseAll(ctx, message, _isAdmin, config);
    case "tickets":
      return handleTickets(ctx, message, command, _isMod);
    case "help":
      return handleHelp(message);
  }
}

// ─── Individual command handlers ────────────────────────────────────────────

async function handleWarn(ctx: PluginContext, message: Message, args: string[], _isMod: boolean, config: DiscordConfig): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isMod) { await noPerms(message); return; }
  const target = message.mentions.members?.first();
  if (!target) { await ch(message).send("Please mention a member to warn."); return; }
  const reason = args.slice(1).join(" ") || "No reason provided";
  const warnings = await addWarning(ctx, target.id, reason, message.author.id);
  await sendModLog(message.guild!, "Warning Issued", message.author, target.user, reason, 0xd4a843, config);
  await ch(message).send(`**${target.user.tag}** has been warned. *(${warnings.length} total warning${warnings.length > 1 ? "s" : ""})*\nReason: ${reason}`);
  if (warnings.length >= config.warningsBeforeKick) {
    await target.kick("Reached warning threshold -- auto-kick").catch(() => {});
    await sendModLog(message.guild!, "Auto-Kicked", { tag: "ShieldAssist" }, target.user, `Reached ${config.warningsBeforeKick} warnings`, 0xef5b5b, config);
  } else if (warnings.length >= config.warningsBeforeMute) {
    await target.timeout(10 * 60 * 1000, "Reached warning threshold -- auto-mute").catch(() => {});
    await sendModLog(message.guild!, "Auto-Muted (10 min)", { tag: "ShieldAssist" }, target.user, `Reached ${config.warningsBeforeMute} warnings`, 0xff8c00, config);
  }
}

async function handleWarnings(ctx: PluginContext, message: Message, _isMod: boolean): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isMod) { await noPerms(message); return; }
  const target = message.mentions.members?.first();
  if (!target) { await ch(message).send("Please mention a member."); return; }
  const warnings = await getWarnings(ctx, target.id);
  if (warnings.length === 0) { await ch(message).send(`**${target.user.tag}** has no warnings.`); return; }
  const list = warnings.map((w, i) => `**${i + 1}.** ${w.reason} -- <t:${Math.floor(new Date(w.date).getTime() / 1000)}:R>`).join("\n");
  await ch(message).send({
    embeds: [new EmbedBuilder().setColor(0xd4a843).setTitle(`Warnings for ${target.user.tag}`).setDescription(list)],
  });
}

async function handleClearWarnings(ctx: PluginContext, message: Message, _isAdmin: boolean, config: DiscordConfig): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isAdmin) { await noPerms(message); return; }
  const target = message.mentions.members?.first();
  if (!target) { await ch(message).send("Please mention a member."); return; }
  await clearWarnings(ctx, target.id);
  await sendModLog(message.guild!, "Warnings Cleared", message.author, target.user, "Manually cleared by admin", 0x3dd68c, config);
  await ch(message).send(`All warnings cleared for **${target.user.tag}**.`);
}

async function handleMute(message: Message, args: string[], _isMod: boolean, config: DiscordConfig): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isMod) { await noPerms(message); return; }
  const target = message.mentions.members?.first();
  if (!target) { await ch(message).send("Please mention a member."); return; }
  const durationArg = args[1] || "10m";
  const ms = parseDuration(durationArg);
  if (!ms) { await ch(message).send("Invalid duration. Use: 10m, 1h, 1d"); return; }
  await target.timeout(ms, args.slice(2).join(" ") || "Muted by moderator").catch(() => {});
  await sendModLog(message.guild!, "Member Muted", message.author, target.user, `Duration: ${durationArg}`, 0xff8c00, config);
  await ch(message).send(`**${target.user.tag}** has been muted for **${durationArg}**.`);
}

async function handleUnmute(message: Message, _isMod: boolean, config: DiscordConfig): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isMod) { await noPerms(message); return; }
  const target = message.mentions.members?.first();
  if (!target) { await ch(message).send("Please mention a member."); return; }
  await target.timeout(null).catch(() => {});
  await sendModLog(message.guild!, "Member Unmuted", message.author, target.user, "Unmuted by moderator", 0x3dd68c, config);
  await ch(message).send(`**${target.user.tag}** has been unmuted.`);
}

async function handleKick(message: Message, args: string[], _isMod: boolean, config: DiscordConfig): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isMod) { await noPerms(message); return; }
  const target = message.mentions.members?.first();
  if (!target) { await ch(message).send("Please mention a member."); return; }
  const reason = args.slice(1).join(" ") || "No reason provided";
  await target.kick(reason).catch(() => {});
  await sendModLog(message.guild!, "Member Kicked", message.author, target.user, reason, 0xef5b5b, config);
  await ch(message).send(`**${target.user.tag}** has been kicked.\nReason: ${reason}`);
}

async function handleBan(message: Message, args: string[], _isAdmin: boolean, config: DiscordConfig): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isAdmin) { await noPerms(message); return; }
  const target = message.mentions.members?.first();
  if (!target) { await ch(message).send("Please mention a member."); return; }
  const reason = args.slice(1).join(" ") || "No reason provided";
  await target.ban({ reason }).catch(() => {});
  await sendModLog(message.guild!, "Member Banned", message.author, target.user, reason, 0xef5b5b, config);
  await ch(message).send(`**${target.user.tag}** has been banned.\nReason: ${reason}`);
}

async function handleUnban(message: Message, args: string[], _isAdmin: boolean): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isAdmin) { await noPerms(message); return; }
  const userId = args[0];
  if (!userId) { await ch(message).send("Please provide the user ID to unban."); return; }
  await message.guild!.members.unban(userId).catch(() => {});
  await ch(message).send(`User **${userId}** has been unbanned.`);
}

async function handlePurge(message: Message, args: string[], _isMod: boolean): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isMod) { await noPerms(message); return; }
  const amount = parseInt(args[0]);
  if (isNaN(amount) || amount < 1 || amount > 100) { await ch(message).send("Please provide a number between 1 and 100."); return; }
  await (ch(message) as TextChannel).bulkDelete(amount + 1, true).catch(() => {});
  const confirm = await ch(message).send(`Deleted **${amount}** messages.`);
  setTimeout(() => confirm.delete().catch(() => {}), 3000);
}

async function handleAnnounce(message: Message, args: string[], _isAdmin: boolean): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isAdmin) { await noPerms(message); return; }
  const channelId = args[0]?.replace(/[<#>]/g, "");
  const targetChannel = message.guild!.channels.cache.get(channelId) as TextChannel | undefined;
  if (!targetChannel) { await ch(message).send("Please mention a valid channel. Usage: !announce #channel Your message here"); return; }
  const text = args.slice(1).join(" ");
  if (!text) { await ch(message).send("Please include the announcement text after the channel."); return; }
  await targetChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xd4a843)
        .setTitle("Announcement")
        .setDescription(text)
        .setFooter({ text: `Posted by ${message.author.tag}` })
        .setTimestamp(),
    ],
  });
  await ch(message).send(`Announcement posted in ${targetChannel}.`);
}

async function handleAddRole(message: Message, args: string[], _isAdmin: boolean): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isAdmin) { await noPerms(message); return; }
  const target = message.mentions.members?.first();
  const role = message.guild!.roles.cache.get(args[1]?.replace(/[<@&>]/g, ""));
  if (!target || !role) { await ch(message).send("Usage: !addrole @member @role"); return; }
  await target.roles.add(role).catch(() => {});
  await ch(message).send(`Added **${role.name}** to **${target.user.tag}**.`);
}

async function handleRemoveRole(message: Message, args: string[], _isAdmin: boolean): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isAdmin) { await noPerms(message); return; }
  const target = message.mentions.members?.first();
  const role = message.guild!.roles.cache.get(args[1]?.replace(/[<@&>]/g, ""));
  if (!target || !role) { await ch(message).send("Usage: !removerole @member @role"); return; }
  await target.roles.remove(role).catch(() => {});
  await ch(message).send(`Removed **${role.name}** from **${target.user.tag}**.`);
}

async function handleServerInfo(message: Message): Promise<void> {
  await message.delete().catch(() => {});
  const guild = message.guild!;
  await ch(message).send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5b8def)
        .setTitle(guild.name)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .addFields(
          { name: "Members", value: `${guild.memberCount}`, inline: true },
          { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
          { name: "Owner", value: `<@${guild.ownerId}>`, inline: true },
          { name: "Channels", value: `${guild.channels.cache.size}`, inline: true },
          { name: "Roles", value: `${guild.roles.cache.size}`, inline: true },
          { name: "Boosts", value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
        )
        .setFooter({ text: `ID: ${guild.id}` })
        .setTimestamp(),
    ],
  });
}

async function handleUserInfo(message: Message): Promise<void> {
  await message.delete().catch(() => {});
  const target = message.mentions.members?.first() || message.member!;
  await ch(message).send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5b8def)
        .setTitle(target.user.tag)
        .setThumbnail(target.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: "Username", value: target.user.tag, inline: true },
          { name: "ID", value: target.id, inline: true },
          { name: "Joined", value: `<t:${Math.floor(target.joinedTimestamp! / 1000)}:R>`, inline: true },
          { name: "Registered", value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: "Roles", value: target.roles.cache.filter((r) => r.id !== message.guild!.id).map((r) => r.toString()).join(", ") || "None", inline: false },
        )
        .setTimestamp(),
    ],
  });
}

async function handleSetupTickets(message: Message, _isAdmin: boolean, config: DiscordConfig): Promise<void> {
  if (!_isAdmin) { await noPerms(message); return; }
  const ticketChannel = message.guild!.channels.cache.get(config.ticketChannelId) as TextChannel | undefined;
  if (!ticketChannel) { await ch(message).send("Ticket channel not configured."); return; }
  await setupTicketPanel(ticketChannel);
  await message.delete().catch(() => {});
}

async function handleClose(ctx: PluginContext, message: Message, _isMod: boolean, config: DiscordConfig): Promise<void> {
  if (!_isMod) { await noPerms(message); return; }
  const thread = message.channel;
  if (!thread.isThread()) { await ch(message).send("This command can only be used inside a ticket thread."); return; }
  const success = await closeTicket(ctx, message.guild!, thread as ThreadChannel, message.author.id, config);
  if (!success) await ch(message).send("This does not appear to be a ticket thread.");
}

async function handleCloseAll(ctx: PluginContext, message: Message, _isAdmin: boolean, config: DiscordConfig): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isAdmin) { await noPerms(message); return; }
  const openTickets = await getAllOpenTickets(ctx);
  if (openTickets.length === 0) { await ch(message).send("No open tickets to close."); return; }

  const statusMsg = await ch(message).send(`Closing ${openTickets.length} open ticket${openTickets.length > 1 ? "s" : ""}...`);
  let closed = 0;
  for (const ticket of openTickets) {
    try {
      const thread = await message.guild!.channels.fetch(ticket.threadId).catch(() => null) as ThreadChannel | null;
      if (thread) {
        await closeTicket(ctx, message.guild!, thread, message.author.id, config);
        closed++;
      }
    } catch (err) {
      console.error(`[CLOSEALL] Failed to close ticket #${ticket.number}:`, err);
    }
  }
  await statusMsg.edit(`Closed **${closed}** ticket${closed > 1 ? "s" : ""}.`);
  setTimeout(() => statusMsg.delete().catch(() => {}), 5000);
}

async function handleTickets(ctx: PluginContext, message: Message, command: string, _isMod: boolean): Promise<void> {
  await message.delete().catch(() => {});
  if (!_isMod) { await noPerms(message); return; }
  const open = await getAllOpenTickets(ctx);
  if (open.length === 0) { await sendResponse(message, command, "No open tickets right now."); return; }
  const list = open.map((t) =>
    `[#${String(t.number).padStart(4, "0")}](https://discord.com/channels/${message.guild!.id}/${t.threadId}) -- <@${t.userId}> -- opened <t:${Math.floor(new Date(t.createdAt).getTime() / 1000)}:R>`,
  ).join("\n");
  await sendResponse(message, command, {
    embeds: [new EmbedBuilder().setColor(0x5b8def).setTitle(`Open Tickets (${open.length})`).setDescription(list).setTimestamp()],
  });
}

async function handleHelp(message: Message): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0xd4a843)
    .setTitle("ShieldAssist -- Command List")
    .addFields(
      {
        name: "Moderation (Moderator / Admin)",
        value: "`!warn @user [reason]` -- Warn a member\n`!warnings @user` -- View warnings\n`!mute @user [duration]` -- Mute (e.g. 10m, 1h)\n`!unmute @user` -- Unmute\n`!kick @user [reason]` -- Kick\n`!purge [1-100]` -- Delete messages\n`!close` -- Close ticket thread\n`!tickets` -- List open tickets",
      },
      {
        name: "Admin Only",
        value: "`!ban @user [reason]` -- Ban\n`!unban [userID]` -- Unban\n`!clearwarnings @user` -- Clear warnings\n`!addrole @user @role` -- Add role\n`!removerole @user @role` -- Remove role\n`!announce #channel [message]` -- Post announcement\n`!setup-tickets` -- Post ticket panel\n`!closeall` -- Close all open tickets",
      },
      {
        name: "Info (Everyone)",
        value: "`!serverinfo` -- Server stats\n`!userinfo [@user]` -- Member info\n`!help` -- This message (sent as DM)",
      },
    )
    .setFooter({ text: "ShieldNest x TOKNS" });

  try {
    await message.author.send({ embeds: [embed] });
    await message.delete().catch(() => {});
  } catch {
    const reply = await ch(message).send({ embeds: [embed] });
    setTimeout(() => {
      reply.delete().catch(() => {});
      message.delete().catch(() => {});
    }, 5000);
  }
}
