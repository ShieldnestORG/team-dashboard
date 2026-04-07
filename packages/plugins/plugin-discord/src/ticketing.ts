import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  PermissionsBitField,
  type Guild,
  type Interaction,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordConfig, TicketData, TicketCategory } from "./types.js";

// ─── Ticket categories ──────────────────────────────────────────────────────

export const TICKET_CATEGORIES: TicketCategory[] = [
  { label: "Account", description: "Login issues, access problems, profile questions", value: "account" },
  { label: "NFT", description: "Marketplace issues, listings, collection questions", value: "nft" },
  { label: "P2E", description: "Quest issues, game bugs, Play to Earn questions", value: "p2e" },
  { label: "Technical", description: "Website errors, wallet connection, platform bugs", value: "technical" },
  { label: "General", description: "Anything that does not fit the above categories", value: "general" },
];

// ─── Auto-close timers (in-memory) ──────────────────────────────────────────

const autoCloseTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Tracks which tickets had a first mod response notification ─────────────

const notifiedTickets = new Set<string>();

// ─── Ticket state helpers ───────────────────────────────────────────────────

export async function getTicket(ctx: PluginContext, threadId: string): Promise<TicketData | null> {
  const state = await ctx.state.get({ scopeKind: "instance", scopeId: "", stateKey: `ticket:${threadId}` });
  if (!state) return null;
  return JSON.parse(state as string) as TicketData;
}

export async function saveTicket(ctx: PluginContext, ticket: TicketData): Promise<void> {
  await ctx.state.set(
    { scopeKind: "instance", scopeId: "", stateKey: `ticket:${ticket.threadId}` },
    JSON.stringify(ticket),
  );
}

export async function getNextTicketNumber(ctx: PluginContext): Promise<number> {
  const state = await ctx.state.get({ scopeKind: "instance", scopeId: "", stateKey: "ticket:counter" });
  const current = state ? parseInt(state as string, 10) : 0;
  const next = current + 1;
  await ctx.state.set({ scopeKind: "instance", scopeId: "", stateKey: "ticket:counter" }, String(next));
  return next;
}

export async function getAllOpenTickets(ctx: PluginContext): Promise<TicketData[]> {
  const state = await ctx.state.get({ scopeKind: "instance", scopeId: "", stateKey: "ticket:index" });
  if (!state) return [];
  const threadIds = JSON.parse(state as string) as string[];
  const tickets: TicketData[] = [];
  for (const id of threadIds) {
    const ticket = await getTicket(ctx, id);
    if (ticket && ticket.status === "open") tickets.push(ticket);
  }
  return tickets;
}

async function addToTicketIndex(ctx: PluginContext, threadId: string): Promise<void> {
  const state = await ctx.state.get({ scopeKind: "instance", scopeId: "", stateKey: "ticket:index" });
  const index: string[] = state ? JSON.parse(state as string) : [];
  if (!index.includes(threadId)) {
    index.push(threadId);
    await ctx.state.set({ scopeKind: "instance", scopeId: "", stateKey: "ticket:index" }, JSON.stringify(index));
  }
}

// ─── Update ticket log embed ────────────────────────────────────────────────

export async function updateTicketLog(
  guild: Guild,
  ticket: TicketData,
  status: string,
  config: DiscordConfig,
  closedBy: string | null = null,
): Promise<void> {
  try {
    if (!ticket.logMessageId || !config.ticketLogChannelId) return;
    const logChannel = await guild.channels.fetch(config.ticketLogChannelId).catch(() => null) as TextChannel | null;
    if (!logChannel) return;
    const logMsg = await logChannel.messages.fetch(ticket.logMessageId).catch(() => null);
    if (!logMsg) return;

    const isAuto = closedBy === "auto";
    const statusText = status === "closed" ? "Closed" : "Open";
    const color = status === "closed" ? 0xef5b5b : 0x5b8def;

    const fields = [
      { name: "Member", value: `<@${ticket.userId}>`, inline: true },
      { name: "Category", value: ticket.category || "General", inline: true },
      { name: "Status", value: statusText, inline: true },
      { name: "Opened", value: `<t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:R>`, inline: true },
      { name: "Attended by", value: ticket.attendedBy ? `<@${ticket.attendedBy}>` : "Awaiting response", inline: true },
      { name: "Thread", value: `[Go to ticket](https://discord.com/channels/${guild.id}/${ticket.threadId})`, inline: true },
    ];

    if (status === "closed") {
      fields.push({
        name: "Closed by",
        value: isAuto ? "Auto (inactivity)" : closedBy ? `<@${closedBy}>` : "Unknown",
        inline: true,
      });
    }

    await logMsg.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setTitle(`Ticket #${String(ticket.number).padStart(4, "0")} -- ${ticket.category || "General"}`)
          .addFields(...fields)
          .setFooter({ text: "ShieldNest x TOKNS -- Ticket Logs" })
          .setTimestamp(),
      ],
    }).catch(() => {});
  } catch (err) {
    console.error("updateTicketLog error:", err);
  }
}

// ─── Handle "Open a Ticket" button click ────────────────────────────────────

export async function handleOpenTicketButton(
  ctx: PluginContext,
  interaction: Interaction & { customId: string; user: { id: string }; reply: (...args: unknown[]) => Promise<unknown> },
): Promise<void> {
  if (!("reply" in interaction)) return;
  const interactionAny = interaction as any;

  // Check for existing open ticket
  const openTickets = await getAllOpenTickets(ctx);
  const existing = openTickets.find((t) => t.userId === interaction.user.id);
  if (existing) {
    await interactionAny.reply({
      content: `You already have an open ticket -- <#${existing.threadId}>. Please use that thread or wait for it to be closed.`,
      flags: 64,
    });
    return;
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category")
    .setPlaceholder("Select a category for your ticket")
    .addOptions(
      TICKET_CATEGORIES.map((cat) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(cat.label)
          .setDescription(cat.description)
          .setValue(cat.value),
      ),
    );

  await interactionAny.reply({
    content: "Please select a category for your ticket:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)],
    flags: 64,
  }).catch((err: Error) => console.error("[OPEN TICKET] Reply failed:", err.message));
}

// ─── Handle ticket category selection ───────────────────────────────────────

export async function handleTicketCategorySelect(
  ctx: PluginContext,
  interaction: any,
  config: DiscordConfig,
): Promise<void> {
  await interaction.deferReply({ flags: 64 });

  const selectedCategory = interaction.values[0];
  const categoryLabel = TICKET_CATEGORIES.find((c) => c.value === selectedCategory)?.label || selectedCategory;

  // Double-check no existing open ticket
  const openTickets = await getAllOpenTickets(ctx);
  const existing = openTickets.find((t: TicketData) => t.userId === interaction.user.id);
  if (existing) {
    await interaction.editReply({
      content: `You already have an open ticket -- <#${existing.threadId}>. Please use that thread or wait for it to be closed.`,
    });
    return;
  }

  const ticketNumber = await getNextTicketNumber(ctx);
  const ticketChannel = interaction.guild.channels.cache.get(config.ticketChannelId) as TextChannel | undefined;
  if (!ticketChannel) {
    await interaction.editReply({ content: "Ticket channel not found. Please contact an admin." });
    return;
  }

  const thread = await ticketChannel.threads.create({
    name: `${categoryLabel} -- ticket-${String(ticketNumber).padStart(4, "0")}`,
    autoArchiveDuration: 1440,
    type: 12, // PrivateThread
    reason: `Support ticket for ${interaction.user.tag}`,
  }).catch(() => null);

  if (!thread) {
    await interaction.editReply({
      content: "Could not create ticket thread. Make sure the bot has permission to create private threads.",
    });
    return;
  }

  await thread.members.add(interaction.user.id).catch(() => {});

  const ticket: TicketData = {
    number: ticketNumber,
    threadId: thread.id,
    userId: interaction.user.id,
    category: categoryLabel,
    status: "open",
    createdAt: new Date().toISOString(),
    closedAt: null,
    closedBy: null,
    logMessageId: null,
    attendedBy: null,
  };

  await saveTicket(ctx, ticket);
  await addToTicketIndex(ctx, thread.id);

  // Post to ticket log channel
  if (config.ticketLogChannelId) {
    const logChannel = await interaction.guild.channels.fetch(config.ticketLogChannelId).catch(() => null) as TextChannel | null;
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(0x5b8def)
        .setTitle(`Ticket #${String(ticketNumber).padStart(4, "0")} -- ${categoryLabel}`)
        .addFields(
          { name: "Member", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Category", value: categoryLabel, inline: true },
          { name: "Status", value: "Open", inline: true },
          { name: "Opened", value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
          { name: "Attended by", value: "Awaiting response", inline: true },
          { name: "Thread", value: `[Go to ticket](https://discord.com/channels/${interaction.guild.id}/${thread.id})`, inline: true },
        )
        .setFooter({ text: "ShieldNest x TOKNS -- Ticket Logs" })
        .setTimestamp();

      const logMsg = await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
      if (logMsg) {
        ticket.logMessageId = logMsg.id;
        await saveTicket(ctx, ticket);
      }
    }
  }

  // Send ticket instructions
  const supportRole = config.roleModerator ? interaction.guild.roles.cache.get(config.roleModerator) : null;
  const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Secondary),
  );

  await thread.send({ content: supportRole ? `${supportRole}` : undefined, components: [closeRow] });
  await thread.send({ content: `Hi ${interaction.user}, please describe your issue and our team will be with you shortly.` });

  // Auto-close timer
  startAutoCloseTimer(ctx, thread as unknown as ThreadChannel, ticket, config);

  ctx.logger.info("Ticket opened", { ticketNumber, category: categoryLabel });

  await interaction.editReply({ content: `Your ticket has been opened -- ${thread.toString()}`, components: [] });
}

// ─── Close a ticket ─────────────────────────────────────────────────────────

export async function closeTicket(
  ctx: PluginContext,
  guild: Guild,
  thread: ThreadChannel,
  closedById: string,
  config: DiscordConfig,
): Promise<boolean> {
  const ticket = await getTicket(ctx, thread.id);
  if (!ticket) return false;

  ticket.status = "closed";
  ticket.closedAt = new Date().toISOString();
  ticket.closedBy = closedById;
  await saveTicket(ctx, ticket);

  clearAutoCloseTimer(thread.id);

  await thread.send({ content: "This ticket has been closed." }).catch(() => {});
  await thread.setLocked(true).catch(() => {});
  await thread.setArchived(true).catch(() => {});
  await updateTicketLog(guild, ticket, "closed", config, closedById);

  try {
    const m = await guild.members.fetch(ticket.userId).catch(() => null);
    if (m && m.id !== closedById) {
      await m.send("Your support ticket has been closed. If you need further help, feel free to open a new ticket.").catch(() => {});
    }
  } catch { /* ignore DM failures */ }

  ctx.logger.info("Ticket closed", { ticketNumber: ticket.number, closedBy: closedById });

  return true;
}

// ─── Auto-close timer management ────────────────────────────────────────────

export function startAutoCloseTimer(
  ctx: PluginContext,
  thread: ThreadChannel,
  ticket: TicketData,
  config: DiscordConfig,
): void {
  clearAutoCloseTimer(thread.id);
  const timer = setTimeout(async () => {
    const t = await getTicket(ctx, thread.id);
    if (!t || t.status === "closed") return;
    t.status = "closed";
    t.closedAt = new Date().toISOString();
    t.closedBy = "auto";
    await saveTicket(ctx, t);
    await thread.send({ content: "This ticket has been closed due to inactivity." }).catch(() => {});
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true).catch(() => {});
    await updateTicketLog(thread.guild, t, "closed", config, "auto");
    autoCloseTimers.delete(thread.id);
    ctx.logger.info("Ticket auto-closed", { ticketNumber: t.number });
    try {
      const m = await thread.guild.members.fetch(t.userId).catch(() => null);
      if (m) await m.send("Your support ticket was automatically closed due to inactivity. If you still need help, feel free to open a new ticket.").catch(() => {});
    } catch { /* ignore */ }
  }, (config.ticketAutoCloseMinutes || 5) * 60 * 1000);
  autoCloseTimers.set(thread.id, timer);
}

export function clearAutoCloseTimer(threadId: string): void {
  const timer = autoCloseTimers.get(threadId);
  if (timer) {
    clearTimeout(timer);
    autoCloseTimers.delete(threadId);
  }
}

export function hasAutoCloseTimer(threadId: string): boolean {
  return autoCloseTimers.has(threadId);
}

// ─── Handle first mod response in ticket ────────────────────────────────────

export async function handleTicketModResponse(
  ctx: PluginContext,
  message: any,
  config: DiscordConfig,
): Promise<void> {
  const ticket = await getTicket(ctx, message.channel.id);
  if (!ticket || ticket.status !== "open") return;

  const member = message.member;
  const _isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
  const _isMod = (config.roleModerator && member.roles.cache.has(config.roleModerator)) || _isAdmin;
  const isOwner = message.author.id === ticket.userId;

  if (_isMod && !isOwner && !notifiedTickets.has(message.channel.id)) {
    notifiedTickets.add(message.channel.id);
    ticket.attendedBy = message.author.id;
    await saveTicket(ctx, ticket);
    await updateTicketLog(message.guild, ticket, "open", config);

    ctx.logger.info("Ticket attended", { ticketNumber: ticket.number, attendedBy: message.author.id });

    try {
      const m = await message.guild.members.fetch(ticket.userId).catch(() => null);
      if (m) {
        await m.send(
          `A member of our team has responded to your ticket. Head over to your thread to continue the conversation: https://discord.com/channels/${message.guild.id}/${message.channel.id}`,
        ).catch(() => {});
      }
    } catch { /* ignore */ }
  }
}

// ─── Handle ticket thread reopened (unarchived) ─────────────────────────────

export async function handleTicketReopen(
  ctx: PluginContext,
  oldThread: ThreadChannel,
  newThread: ThreadChannel,
  config: DiscordConfig,
): Promise<void> {
  if (!oldThread.archived || newThread.archived) return;
  const ticket = await getTicket(ctx, newThread.id);
  if (!ticket) return;

  ticket.status = "open";
  ticket.closedAt = null;
  ticket.closedBy = null;
  await saveTicket(ctx, ticket);
  await updateTicketLog(newThread.guild, ticket, "open", config);

  ctx.logger.info("Ticket reopened", { ticketNumber: ticket.number });

  try {
    const m = await newThread.guild.members.fetch(ticket.userId).catch(() => null);
    if (m) {
      await m.send(
        `Your support ticket has been reopened. Head back to your thread to continue: https://discord.com/channels/${newThread.guild.id}/${newThread.id}`,
      ).catch(() => {});
    }
  } catch { /* ignore */ }
}

// ─── Setup tickets panel command ────────────────────────────────────────────

export async function setupTicketPanel(channel: TextChannel): Promise<void> {
  await channel.send({
    content: "Need help from our team? Click the button below to open a support ticket.",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("open_ticket").setLabel("Open a Ticket").setStyle(ButtonStyle.Primary),
      ),
    ],
  });
}
