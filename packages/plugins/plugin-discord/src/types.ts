// ─── Plugin config ────────────────────────────────────────────────────────────

export type DiscordConfig = {
  discordToken: string;
  guildId: string;
  ticketChannelId: string;
  ticketLogChannelId: string;
  supportChannelId: string;
  announcementsChannelId: string;
  welcomeChannelId: string;
  roleMember: string;
  roleModerator: string;
  roleAdmin: string;
  roleNftCollector: string;
  roleGamer: string;
  roleDeveloper: string;
  roleInvestor: string;
  bannedWords: string[];
  spamThreshold: number;
  spamWindowMs: number;
  ticketAutoCloseMinutes: number;
  warningsBeforeMute: number;
  warningsBeforeKick: number;
};

// ─── Warning data ─────────────────────────────────────────────────────────────

export type Warning = {
  reason: string;
  adminId: string;
  date: string;
};

export type UserWarnings = {
  userId: string;
  warnings: Warning[];
};

// ─── Ticket data ──────────────────────────────────────────────────────────────

export type TicketStatus = "open" | "closed";

export type TicketData = {
  number: number;
  threadId: string;
  userId: string;
  category: string;
  status: TicketStatus;
  createdAt: string;
  closedAt: string | null;
  closedBy: string | null;
  logMessageId: string | null;
  attendedBy: string | null;
};

// ─── Ticket categories ────────────────────────────────────────────────────────

export type TicketCategory = {
  label: string;
  description: string;
  value: string;
};

// ─── Moderation action log ────────────────────────────────────────────────────

export type ModAction =
  | "warning"
  | "auto_warning"
  | "mute"
  | "unmute"
  | "kick"
  | "auto_kick"
  | "ban"
  | "unban"
  | "purge"
  | "warnings_cleared";

export type ModActionLog = {
  action: ModAction;
  targetUserId: string;
  targetUserTag: string;
  adminId: string;
  adminTag: string;
  reason: string;
  timestamp: string;
};

// ─── Spam tracker (in-memory only) ────────────────────────────────────────────

export type SpamEntry = {
  count: number;
  last: number;
};

// ─── Daily stats ──────────────────────────────────────────────────────────────

export type DailyStats = {
  date: string;
  ticketsOpened: number;
  ticketsClosed: number;
  warnings: number;
  autoWarnings: number;
  mutes: number;
  kicks: number;
  bans: number;
  messagesModerated: number;
};

// ─── Bot status ───────────────────────────────────────────────────────────────

export type BotStatus = {
  online: boolean;
  username: string | null;
  guildName: string | null;
  memberCount: number;
  channelCount: number;
  startedAt: string | null;
  lastHeartbeat: string;
};

// ─── Onboarding role map ──────────────────────────────────────────────────────

export type OnboardingRoleMap = Record<string, string>;
