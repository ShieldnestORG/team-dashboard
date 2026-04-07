import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Shield,
  AlertTriangle,
  Users,
  Hash,
  Clock,
  Search,
  CheckCircle2,
  XCircle,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

type BotStatus = {
  online: boolean;
  username: string | null;
  guildName: string | null;
  memberCount: number;
  channelCount: number;
  startedAt: string | null;
  lastHeartbeat: string;
};

type TicketData = {
  number: number;
  threadId: string;
  userId: string;
  category: string;
  status: string;
  createdAt: string;
  attendedBy: string | null;
};

type ModAction = {
  action: string;
  targetUserId: string;
  targetUserTag: string;
  adminId: string;
  adminTag: string;
  reason: string;
  timestamp: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    warning: "Warning",
    auto_warning: "Auto-Warning",
    mute: "Mute",
    unmute: "Unmute",
    kick: "Kick",
    auto_kick: "Auto-Kick",
    ban: "Ban",
    unban: "Unban",
    purge: "Purge",
    warnings_cleared: "Warnings Cleared",
  };
  return labels[action] || action;
}

function actionColor(action: string): string {
  if (action.includes("ban") || action.includes("kick")) return "text-red-400";
  if (action.includes("mute")) return "text-orange-400";
  if (action.includes("warning")) return "text-yellow-400";
  if (action === "unmute" || action === "warnings_cleared") return "text-emerald-400";
  return "text-muted-foreground";
}

// ── API client ──────────────────────────────────────────────────────────────

async function fetchPluginData<T>(companyId: string, dataKey: string): Promise<T | null> {
  const res = await fetch(
    `/api/companies/${companyId}/plugins/coherencedaddy.discord/data/${dataKey}`,
    { credentials: "include" },
  );
  if (!res.ok) return null;
  const json = await res.json();
  return json.data ?? json;
}

// ── Component ───────────────────────────────────────────────────────────────

export function Discord() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const [search, setSearch] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Discord" }]);
  }, [setBreadcrumbs]);

  const companyId = selectedCompanyId ?? "";

  const { data: botStatus, isLoading: statusLoading } = useQuery<BotStatus | null>({
    queryKey: ["discord", "bot-status", companyId],
    queryFn: () => fetchPluginData<BotStatus>(companyId, "bot-status"),
    refetchInterval: 30_000,
    enabled: !!companyId,
  });

  const { data: openTickets, isLoading: ticketsLoading } = useQuery<TicketData[] | null>({
    queryKey: ["discord", "open-tickets", companyId],
    queryFn: () => fetchPluginData<TicketData[]>(companyId, "open-tickets"),
    refetchInterval: 15_000,
    enabled: !!companyId,
  });

  const { data: modActions, isLoading: modLoading } = useQuery<ModAction[] | null>({
    queryKey: ["discord", "recent-mod-actions", companyId],
    queryFn: () => fetchPluginData<ModAction[]>(companyId, "recent-mod-actions"),
    refetchInterval: 30_000,
    enabled: !!companyId,
  });

  const tickets = openTickets || [];
  const actions = modActions || [];
  const isOnline = botStatus?.online ?? false;

  const filteredTickets = search.trim()
    ? tickets.filter(
        (t) =>
          t.category.toLowerCase().includes(search.toLowerCase()) ||
          t.userId.includes(search) ||
          String(t.number).includes(search),
      )
    : tickets;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Discord Bot</h1>
        <p className="text-sm text-muted-foreground">
          Community moderation, ticketing, and bot status for ShieldNest x TOKNS
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bot Status</CardTitle>
            {isOnline ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <XCircle className="h-4 w-4 text-red-400" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isOnline ? "Online" : "Offline"}</div>
            <p className="text-xs text-muted-foreground">
              {botStatus?.username || "Not connected"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Server Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{botStatus?.memberCount ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {botStatus?.guildName || "No server"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Tickets</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tickets.length}</div>
            <p className="text-xs text-muted-foreground">Active support threads</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Mod Actions (7d)</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{actions.length}</div>
            <p className="text-xs text-muted-foreground">Warnings, mutes, kicks, bans</p>
          </CardContent>
        </Card>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Open Tickets */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Open Tickets</CardTitle>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search tickets..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {ticketsLoading ? (
              <div className="text-sm text-muted-foreground">Loading tickets...</div>
            ) : filteredTickets.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                {search ? "No tickets match your search" : "No open tickets"}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredTickets.map((ticket) => (
                  <div
                    key={ticket.threadId}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">
                          #{String(ticket.number).padStart(4, "0")}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {ticket.category}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {ticket.userId}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {relativeTime(ticket.createdAt)}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {ticket.attendedBy ? (
                        <span className="text-emerald-400">Attended</span>
                      ) : (
                        <span className="text-yellow-400">Awaiting</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Moderation Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Moderation</CardTitle>
          </CardHeader>
          <CardContent>
            {modLoading ? (
              <div className="text-sm text-muted-foreground">Loading actions...</div>
            ) : actions.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No moderation actions in the last 7 days
              </div>
            ) : (
              <div className="space-y-3">
                {actions.slice(0, 20).map((action, i) => (
                  <div
                    key={`${action.timestamp}-${i}`}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${actionColor(action.action)}`}>
                          {actionLabel(action.action)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {action.targetUserTag} — {action.reason}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {relativeTime(action.timestamp)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Server info footer */}
      {botStatus && botStatus.online && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Server</span>
                <p className="font-medium">{botStatus.guildName}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Channels</span>
                <p className="font-medium">{botStatus.channelCount}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Uptime</span>
                <p className="font-medium">
                  {botStatus.startedAt ? relativeTime(botStatus.startedAt).replace(" ago", "") : "N/A"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Bot User</span>
                <p className="font-medium">{botStatus.username}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
