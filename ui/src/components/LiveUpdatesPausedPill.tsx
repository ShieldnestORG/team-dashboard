import { useLiveUpdatesStatus } from "../context/LiveUpdatesProvider";

/**
 * Quiet indicator shown only once LiveUpdatesProvider has given up
 * reconnecting the live-events WebSocket (session probe returned 401/403).
 * No toast, no polling — just a small muted pill so a stale tab doesn't
 * look broken without explanation.
 */
export function LiveUpdatesPausedPill() {
  const { stopped } = useLiveUpdatesStatus();
  if (!stopped) return null;

  return (
    <div className="flex justify-center border-b border-border bg-muted/40 px-3 py-1">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        Live updates paused — refresh to reconnect
      </span>
    </div>
  );
}
