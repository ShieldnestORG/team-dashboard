import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { socialsApi } from "../../api/socials";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, relativeTime } from "../../lib/utils";

function fmt(d: string | null): string {
  if (!d) return "—";
  return relativeTime(d);
}

/** Threshold-color a last-run timestamp: green recent, amber, red >2h, gray if never. */
function lastRunTone(date: string | null): string {
  if (!date) return "text-muted-foreground";
  const ageMs = Date.now() - new Date(date).getTime();
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const TEN_MIN = 10 * 60 * 1000;
  if (ageMs > TWO_HOURS) return "text-red-600 dark:text-red-400";
  if (ageMs > TEN_MIN) return "text-amber-600 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

export function SocialsAutomation() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["socials", "automations"],
    queryFn: () => socialsApi.listAutomations(),
  });
  const syncMut = useMutation({
    mutationFn: () => socialsApi.syncAutomations(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["socials", "automations"] }),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading automations…</div>;
  const automations = data?.automations ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">
          {automations.length} automation{automations.length === 1 ? "" : "s"} mirrored from <code>content-crons.ts</code>
        </div>
        <Button size="sm" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
          {syncMut.isPending ? "Syncing…" : "Sync from JOB_DEFS"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Cron-driven automations</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Source</th>
                <th>Cron</th>
                <th>Personality</th>
                <th>Type</th>
                <th>Last run</th>
                <th>Next run</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {automations.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="py-1 font-mono text-xs">
                    <div>{a.sourceRef}</div>
                    {a.notes && (
                      <div
                        className="mt-0.5 inline-block max-w-[220px] truncate rounded bg-amber-100 px-1.5 py-0.5 font-sans text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        title={a.notes}
                      >
                        {a.notes}
                      </div>
                    )}
                  </td>
                  <td className="font-mono text-xs">{a.cronExpr}</td>
                  <td>{a.personalityId}</td>
                  <td>{a.contentType}</td>
                  <td className={cn("text-xs", a.enabled ? lastRunTone(a.lastRunAt) : "text-muted-foreground")}>
                    {fmt(a.lastRunAt)}
                  </td>
                  <td className="text-xs">{fmt(a.nextRunAt)}</td>
                  <td>
                    <Badge variant={a.enabled ? "default" : "outline"}>
                      {a.enabled ? "on" : "off"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {automations.length === 0 && (
            <div className="text-sm text-muted-foreground py-4">
              No automations recorded yet. Click <strong>Sync from JOB_DEFS</strong>.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
