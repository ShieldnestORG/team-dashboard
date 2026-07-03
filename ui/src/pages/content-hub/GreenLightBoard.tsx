import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ZernioGreenlightRow } from "@/api/socials";
import {
  describeGreenlightRow,
  formatStat,
  formatWhen,
  latestSyncedAt,
  toneDotClassName,
} from "./kit-status";

/** Cooldown after a manual refresh — Zernio rate limits are shared. */
const REFRESH_COOLDOWN_MS = 15_000;

interface GreenLightBoardProps {
  rows: ZernioGreenlightRow[];
  isLoading: boolean;
  error: string | null;
  /** Live Zernio fetch + mirror refresh, then re-query. Explicit action only. */
  onRefresh: () => Promise<unknown>;
  refreshing: boolean;
}

/**
 * Which keywords are safe to post right now. Reads the DB mirror (fast, no
 * Zernio call); the ONE button is the only thing that talks to Zernio live.
 * Strictly read-only — no create/pause/delete anywhere (DM #2 belongs to
 * Mark's cron, not this dashboard).
 */
export function GreenLightBoard({ rows, isLoading, error, onRefresh, refreshing }: GreenLightBoardProps) {
  const [coolingDown, setCoolingDown] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  async function refresh() {
    setCoolingDown(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCoolingDown(false), REFRESH_COOLDOWN_MS);
    await onRefresh().catch(() => {
      // The stale mirror data stays on screen; the freshness label is honest.
    });
  }

  const syncedAt = latestSyncedAt(rows);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Which keywords are live</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={refreshing || coolingDown}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : coolingDown ? "Just refreshed" : "Refresh from Zernio now"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {syncedAt
            ? `Zernio data as of ${formatWhen(syncedAt)} (updates hourly).`
            : "No Zernio data synced yet."}
        </p>
        <p className="text-sm text-muted-foreground">
          Account-level numbers — includes everything sent on this account, not just this dashboard.
        </p>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No keyword funnels found yet. Try "Refresh from Zernio now".
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li
                key={`${row.zernioAccountId}-${row.keyword}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
              >
                <span className="flex min-w-40 items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${toneDotClassName(row.tone)}`} />
                  <span className="font-medium">{row.keyword}</span>
                  <span className="text-xs text-muted-foreground">{row.accountLabel}</span>
                </span>
                <span className="text-sm text-muted-foreground">{describeGreenlightRow(row)}</span>
                {row.addonMissing ? (
                  <span className="text-xs text-muted-foreground">
                    analytics add-on not active on this account
                  </span>
                ) : (
                  <span className="ml-auto flex gap-4 text-xs text-muted-foreground">
                    <span>triggered: {formatStat(row.stats.triggered)}</span>
                    <span>DMs sent: {formatStat(row.stats.dmsSent)}</span>
                    <span>link clicks: {formatStat(row.stats.linkClicks)}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
