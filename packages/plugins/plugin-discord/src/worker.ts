import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type {
  ToolRunContext,
  ToolResult,
  PluginContext,
  PluginJobContext,
} from "@paperclipai/plugin-sdk";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type ThreadChannel,
  type TextChannel,
} from "discord.js";
import type { DiscordConfig, BotStatus, TicketData, DailyStats } from "./types.js";
import {
  runAutoMod,
  isModerator,
  getWarnings,
  addWarning,
  getRecentModActions,
  sendModLog,
} from "./moderation.js";
import {
  handleOpenTicketButton,
  handleTicketCategorySelect,
  handleTicketModResponse,
  handleTicketReopen,
  getTicket,
  getAllOpenTickets,
  closeTicket,
  hasAutoCloseTimer,
  clearAutoCloseTimer,
  startAutoCloseTimer,
} from "./ticketing.js";
import { handleCommand } from "./commands.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getConfig(ctx: PluginContext): Promise<DiscordConfig> {
  const raw = await ctx.config.get();
  return {
    discordToken: (raw.discordToken as string) || "",
    guildId: (raw.guildId as string) || "",
    ticketChannelId: (raw.ticketChannelId as string) || "",
    ticketLogChannelId: (raw.ticketLogChannelId as string) || "",
    supportChannelId: (raw.supportChannelId as string) || "",
    announcementsChannelId: (raw.announcementsChannelId as string) || "",
    welcomeChannelId: (raw.welcomeChannelId as string) || "",
    roleMember: (raw.roleMember as string) || "",
    roleModerator: (raw.roleModerator as string) || "",
    roleAdmin: (raw.roleAdmin as string) || "",
    roleNftCollector: (raw.roleNftCollector as string) || "",
    roleGamer: (raw.roleGamer as string) || "",
    roleDeveloper: (raw.roleDeveloper as string) || "",
    roleInvestor: (raw.roleInvestor as string) || "",
    bannedWords: (raw.bannedWords as string[]) || ["spam", "scam", "rug", "phishing"],
    spamThreshold: (raw.spamThreshold as number) || 5,
    spamWindowMs: (raw.spamWindowMs as number) || 5000,
    ticketAutoCloseMinutes: (raw.ticketAutoCloseMinutes as number) || 5,
    warningsBeforeMute: (raw.warningsBeforeMute as number) || 3,
    warningsBeforeKick: (raw.warningsBeforeKick as number) || 5,
  };
}

// ─── Onboarding role map builder ────────────────────────────────────────────

function buildOnboardingRoleMap(config: DiscordConfig): Record<string, string> {
  const map: Record<string, string> = {};
  if (config.roleNftCollector) {
    map["nft collector"] = config.roleNftCollector;
    map["nfts & collecting"] = config.roleNftCollector;
  }
  if (config.roleGamer) {
    map["play to earn gaming"] = config.roleGamer;
    map["gamer"] = config.roleGamer;
  }
  if (config.roleDeveloper) {
    map["building & development"] = config.roleDeveloper;
    map["developer"] = config.roleDeveloper;
  }
  if (config.roleInvestor) {
    map["investing & trading"] = config.roleInvestor;
    map["investor"] = config.roleInvestor;
  }
  return map;
}

// ─── Module-level state ─────────────────────────────────────────────────────

let currentContext: PluginContext | null = null;
let discordClient: Client | null = null;
let botStartedAt: string | null = null;

// ─── Plugin definition ──────────────────────────────────────────────────────

const plugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;
    const config = await getConfig(ctx);

    if (!config.discordToken) {
      ctx.logger.warn("Discord token not configured — bot will not start. Set discordToken in plugin settings.");
      return;
    }

    ctx.logger.info("Discord bot plugin v0.1.0 starting...");

    // ══════════════════════════════════════════════════════════════════════════
    // DISCORD CLIENT
    // ══════════════════════════════════════════════════════════════════════════

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessageTyping,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });
    discordClient = client;

    // ── Bot ready ───────────────────────────────────────────────────────────

    client.once(Events.ClientReady, () => {
      botStartedAt = now();
      ctx.logger.info(`Discord bot online as ${client.user?.tag}`);
      client.user?.setActivity("Protecting ShieldNest x TOKNS", { type: 3 });

      // Update bot status in state
      updateBotStatus(ctx, client, config).catch(() => {});

      ctx.logger.info("Discord bot online", { username: client.user?.tag ?? null });
    });

    // ── Onboarding role assignment ──────────────────────────────────────────

    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
      try {
        const cfg = await getConfig(ctx);
        const roleMap = buildOnboardingRoleMap(cfg);
        const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
        if (addedRoles.size === 0) return;
        for (const [, role] of addedRoles) {
          const mappedRoleId = roleMap[role.name.toLowerCase()];
          if (mappedRoleId) {
            const roleToAdd = newMember.guild.roles.cache.get(mappedRoleId);
            if (roleToAdd && !newMember.roles.cache.has(mappedRoleId)) {
              await newMember.roles.add(roleToAdd);
              ctx.logger.info(`Assigned ${roleToAdd.name} to ${newMember.user.tag}`);
            }
          }
        }
      } catch (err) {
        ctx.logger.error("GuildMemberUpdate error", { error: String(err) });
      }
    });

    // ── New member joined ───────────────────────────────────────────────────

    client.on(Events.GuildMemberAdd, async (member) => {
      try {
        const cfg = await getConfig(ctx);
        if (cfg.roleMember) {
          const memberRole = member.guild.roles.cache.get(cfg.roleMember);
          if (memberRole) await member.roles.add(memberRole);
        }
      } catch (err) {
        ctx.logger.error("GuildMemberAdd error", { error: String(err) });
      }
    });

    // ── Button & select menu interactions ────────────────────────────────────

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
      const cfg = await getConfig(ctx);

      if (interaction.isButton() && interaction.customId === "open_ticket") {
        await handleOpenTicketButton(ctx, interaction as any);
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId === "ticket_category") {
        await handleTicketCategorySelect(ctx, interaction, cfg);
        return;
      }

      if (interaction.isButton() && interaction.customId === "close_ticket") {
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        if (!member) return;
        if (!isModerator(member, cfg)) {
          await (interaction as any).reply({ content: "Only a moderator or admin can close this ticket.", flags: 64 });
          return;
        }
        const thread = interaction.channel;
        if (!thread?.isThread()) return;
        await (interaction as any).deferReply();
        const success = await closeTicket(ctx, interaction.guild!, thread as ThreadChannel, interaction.user.id, cfg);
        if (!success) {
          await (interaction as any).editReply({ content: "This does not appear to be a ticket thread." });
        } else {
          await (interaction as any).editReply({ content: "This ticket has been closed." });
        }
      }
    });

    // ── Message handler (auto-mod + commands + ticket tracking) ──────────────

    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot || !message.guild) return;
      const cfg = await getConfig(ctx);
      const member = message.member;
      if (!member) return;

      // Auto-moderation (skip for mods)
      if (!isModerator(member, cfg)) {
        const modded = await runAutoMod(ctx, message, cfg);
        if (modded) return;
      }

      // Cancel auto-close timer if ticket owner sends a message
      if (message.channel.isThread() && hasAutoCloseTimer(message.channel.id)) {
        const ticket = await getTicket(ctx, message.channel.id);
        if (ticket && ticket.userId === message.author.id) {
          clearAutoCloseTimer(message.channel.id);
        }
      }

      // First mod response in ticket
      if (message.channel.isThread()) {
        await handleTicketModResponse(ctx, message, cfg);
      }

      // Commands
      await handleCommand(ctx, message, cfg);
    });

    // ── Thread update (detect ticket reopen) ────────────────────────────────

    client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
      try {
        const cfg = await getConfig(ctx);
        await handleTicketReopen(ctx, oldThread as ThreadChannel, newThread as ThreadChannel, cfg);
      } catch (err) {
        ctx.logger.error("ThreadUpdate error", { error: String(err) });
      }
    });

    // ── Global error handling ───────────────────────────────────────────────

    client.on("error", (err) => ctx.logger.error("Discord client error", { error: err.message }));

    // ── Login ───────────────────────────────────────────────────────────────

    await client.login(config.discordToken);

    // ══════════════════════════════════════════════════════════════════════════
    // TOOLS — Agent-facing operations
    // ══════════════════════════════════════════════════════════════════════════

    // ── get-open-tickets ────────────────────────────────────────────────────

    ctx.tools.register(
      "get-open-tickets",
      {
        displayName: "Discord: Get Open Tickets",
        description: "List all currently open support tickets.",
        parametersSchema: {
          type: "object",
          properties: {
            category: { type: "string" },
            limit: { type: "number", default: 50 },
          },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { category?: string; limit?: number };
        let tickets = await getAllOpenTickets(ctx);
        if (p.category) {
          tickets = tickets.filter((t) => t.category.toLowerCase() === p.category!.toLowerCase());
        }
        const limit = p.limit || 50;
        return {
          data: tickets.slice(0, limit).map((t) => ({
            number: t.number,
            threadId: t.threadId,
            userId: t.userId,
            category: t.category,
            createdAt: t.createdAt,
            attendedBy: t.attendedBy,
          })),
        };
      },
    );

    // ── get-warnings ────────────────────────────────────────────────────────

    ctx.tools.register(
      "get-warnings",
      {
        displayName: "Discord: Get Warnings",
        description: "Get warning history for a Discord user.",
        parametersSchema: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string" } },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { userId: string };
        const warnings = await getWarnings(ctx, p.userId);
        return { data: { userId: p.userId, warnings, count: warnings.length } };
      },
    );

    // ── get-mod-stats ───────────────────────────────────────────────────────

    ctx.tools.register(
      "get-mod-stats",
      {
        displayName: "Discord: Get Moderation Stats",
        description: "Get moderation statistics over a time window.",
        parametersSchema: {
          type: "object",
          properties: { days: { type: "number", default: 7 } },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { days?: number };
        const actions = await getRecentModActions(ctx, p.days || 7, 500);
        const counts: Record<string, number> = {};
        for (const a of actions) {
          counts[a.action] = (counts[a.action] || 0) + 1;
        }
        return { data: { days: p.days || 7, totalActions: actions.length, breakdown: counts } };
      },
    );

    // ── get-bot-status ──────────────────────────────────────────────────────

    ctx.tools.register(
      "get-bot-status",
      {
        displayName: "Discord: Get Bot Status",
        description: "Check Discord bot status and connected guild info.",
        parametersSchema: { type: "object", properties: {} },
      },
      async (): Promise<ToolResult> => {
        const guild = client.guilds.cache.get(config.guildId);
        const status: BotStatus = {
          online: client.isReady(),
          username: client.user?.tag ?? null,
          guildName: guild?.name ?? null,
          memberCount: guild?.memberCount ?? 0,
          channelCount: guild?.channels.cache.size ?? 0,
          startedAt: botStartedAt,
          lastHeartbeat: now(),
        };
        return { data: status };
      },
    );

    // ── send-announcement ───────────────────────────────────────────────────

    ctx.tools.register(
      "send-announcement",
      {
        displayName: "Discord: Send Announcement",
        description: "Send an announcement embed to a Discord channel.",
        parametersSchema: {
          type: "object",
          required: ["channelId", "text"],
          properties: {
            channelId: { type: "string" },
            text: { type: "string" },
          },
        },
      },
      async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
        const p = params as { channelId: string; text: string };
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) return { error: "Guild not found" };
        const channel = guild.channels.cache.get(p.channelId) as TextChannel | undefined;
        if (!channel) return { error: "Channel not found" };
        const { EmbedBuilder } = await import("discord.js");
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xd4a843)
              .setTitle("Announcement")
              .setDescription(p.text)
              .setFooter({ text: `Posted via Dashboard Agent` })
              .setTimestamp(),
          ],
        });
        return { data: { success: true, channelId: p.channelId } };
      },
    );

    // ── close-ticket ────────────────────────────────────────────────────────

    ctx.tools.register(
      "close-ticket",
      {
        displayName: "Discord: Close Ticket",
        description: "Close a support ticket by its thread ID.",
        parametersSchema: {
          type: "object",
          required: ["threadId"],
          properties: { threadId: { type: "string" } },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { threadId: string };
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) return { error: "Guild not found" };
        const thread = await guild.channels.fetch(p.threadId).catch(() => null) as ThreadChannel | null;
        if (!thread) return { error: "Thread not found" };
        const cfg = await getConfig(ctx);
        const success = await closeTicket(ctx, guild, thread, "dashboard-agent", cfg);
        return success ? { data: { success: true } } : { error: "Thread is not a ticket" };
      },
    );

    // ── warn-user ───────────────────────────────────────────────────────────

    ctx.tools.register(
      "warn-user",
      {
        displayName: "Discord: Warn User",
        description: "Issue a warning to a Discord user.",
        parametersSchema: {
          type: "object",
          required: ["userId", "reason"],
          properties: {
            userId: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { userId: string; reason: string };
        const warnings = await addWarning(ctx, p.userId, p.reason, "dashboard-agent");
        const cfg = await getConfig(ctx);
        const guild = client.guilds.cache.get(cfg.guildId);
        if (guild) {
          const member = await guild.members.fetch(p.userId).catch(() => null);
          if (member) {
            await sendModLog(guild, "Warning Issued", { tag: "Dashboard Agent" }, member.user, p.reason, 0xd4a843, cfg);
            if (warnings.length >= cfg.warningsBeforeKick) {
              await member.kick("Reached warning threshold (dashboard)").catch(() => {});
            } else if (warnings.length >= cfg.warningsBeforeMute) {
              await member.timeout(10 * 60 * 1000, "Reached warning threshold (dashboard)").catch(() => {});
            }
          }
        }
        return { data: { userId: p.userId, totalWarnings: warnings.length } };
      },
    );

    // ── get-recent-mod-actions ───────────────────────────────────────────────

    ctx.tools.register(
      "get-recent-mod-actions",
      {
        displayName: "Discord: Recent Mod Actions",
        description: "Get the most recent moderation actions.",
        parametersSchema: {
          type: "object",
          properties: { limit: { type: "number", default: 20 } },
        },
      },
      async (params: unknown): Promise<ToolResult> => {
        const p = params as { limit?: number };
        const actions = await getRecentModActions(ctx, 7, p.limit || 20);
        return { data: actions };
      },
    );

    // ══════════════════════════════════════════════════════════════════════════
    // JOBS — Scheduled operations
    // ══════════════════════════════════════════════════════════════════════════

    // ── ticket-cleanup ──────────────────────────────────────────────────────

    ctx.jobs.register("ticket-cleanup", async (job: PluginJobContext) => {
      ctx.logger.info("Running ticket cleanup job");
      const indexState = await ctx.state.get({ scopeKind: "instance", scopeId: "", stateKey: "ticket:index" });
      if (!indexState) return;
      const threadIds = JSON.parse(indexState as string) as string[];
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      let archived = 0;
      for (const id of threadIds) {
        const ticket = await getTicket(ctx, id);
        if (ticket && ticket.status === "closed" && ticket.closedAt && ticket.closedAt < thirtyDaysAgo) {
          await ctx.state.set(
            { scopeKind: "instance", scopeId: "", stateKey: `ticket:archived:${id}` },
            JSON.stringify(ticket),
          );
          await ctx.state.delete({ scopeKind: "instance", scopeId: "", stateKey: `ticket:${id}` });
          archived++;
        }
      }
      ctx.logger.info(`Ticket cleanup complete: archived ${archived} tickets`);
    });

    // ── daily-stats ─────────────────────────────────────────────────────────

    ctx.jobs.register("daily-stats", async (job: PluginJobContext) => {
      ctx.logger.info("Running daily stats rollup");
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const actions = await getRecentModActions(ctx, 1, 1000);
      const openTickets = await getAllOpenTickets(ctx);

      const stats: DailyStats = {
        date: yesterday,
        ticketsOpened: 0,
        ticketsClosed: 0,
        warnings: 0,
        autoWarnings: 0,
        mutes: 0,
        kicks: 0,
        bans: 0,
        messagesModerated: 0,
      };

      for (const a of actions) {
        switch (a.action) {
          case "warning": stats.warnings++; break;
          case "auto_warning": stats.autoWarnings++; stats.messagesModerated++; break;
          case "mute": stats.mutes++; break;
          case "kick": case "auto_kick": stats.kicks++; break;
          case "ban": stats.bans++; break;
        }
      }

      await ctx.state.set(
        { scopeKind: "instance", scopeId: "", stateKey: `stats:${yesterday}` },
        JSON.stringify(stats),
      );
      ctx.logger.info(`Daily stats saved for ${yesterday}`);
    });

    // ══════════════════════════════════════════════════════════════════════════
    // DATA — Dashboard-facing queries
    // ══════════════════════════════════════════════════════════════════════════

    ctx.data.register("bot-status", async () => {
      const guild = client.guilds.cache.get(config.guildId);
      return {
        online: client.isReady(),
        username: client.user?.tag ?? null,
        guildName: guild?.name ?? null,
        memberCount: guild?.memberCount ?? 0,
        channelCount: guild?.channels.cache.size ?? 0,
        startedAt: botStartedAt,
        lastHeartbeat: now(),
      };
    });

    ctx.data.register("open-tickets", async () => {
      return await getAllOpenTickets(ctx);
    });

    ctx.data.register("recent-mod-actions", async () => {
      return await getRecentModActions(ctx, 7, 20);
    });
  },

  async onHealth() {
    const isReady = discordClient?.isReady() ?? false;
    return {
      status: isReady ? "ok" as const : "error" as const,
      message: isReady ? "Discord bot connected" : "Discord bot not connected",
      details: {
        botUser: discordClient?.user?.tag ?? null,
        startedAt: botStartedAt,
      },
    };
  },

  async onShutdown() {
    if (discordClient) {
      discordClient.destroy();
      discordClient = null;
      currentContext?.logger.info("Discord bot disconnected");
    }
  },
});

// ─── Helper: update bot status in state ─────────────────────────────────────

async function updateBotStatus(ctx: PluginContext, client: Client, config: DiscordConfig): Promise<void> {
  const guild = client.guilds.cache.get(config.guildId);
  await ctx.state.set(
    { scopeKind: "instance", scopeId: "", stateKey: "bot:status" },
    JSON.stringify({
      online: true,
      username: client.user?.tag ?? null,
      guildName: guild?.name ?? null,
      memberCount: guild?.memberCount ?? 0,
      channelCount: guild?.channels.cache.size ?? 0,
      startedAt: botStartedAt,
      lastHeartbeat: now(),
    }),
  );
}

// ─── Start worker ───────────────────────────────────────────────────────────

runWorker(plugin, import.meta.url);
