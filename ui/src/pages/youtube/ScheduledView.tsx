import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { youtubeApi } from "../../api/youtube";
import { EmptyState } from "../../components/EmptyState";
import { QueueItemCard } from "./QueueItemCard";

export function ScheduledView() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["yt-queue"],
    queryFn: youtubeApi.getQueue,
    refetchInterval: 15_000,
  });

  const queue = (data as { queue: Array<Record<string, unknown>> } | undefined)?.queue || [];
  const scheduled = queue
    .filter((item) => item.status === "scheduled" || item.status === "paused")
    .sort((a, b) => {
      const ta = new Date(a.publishTime as string).getTime();
      const tb = new Date(b.publishTime as string).getTime();
      return ta - tb;
    });
  const refresh = () => qc.invalidateQueries({ queryKey: ["yt-queue"] });

  return isLoading ? (
    <p className="text-sm text-muted-foreground">Loading...</p>
  ) : scheduled.length === 0 ? (
    <EmptyState icon={Clock} message="Nothing is scheduled." />
  ) : (
    <div className="space-y-3">
      {scheduled.map((item) => (
        <QueueItemCard key={item.id as string} item={item} onRefresh={refresh} />
      ))}
    </div>
  );
}
