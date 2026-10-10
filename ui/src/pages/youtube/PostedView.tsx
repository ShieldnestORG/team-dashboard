import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { youtubeApi } from "../../api/youtube";
import { EmptyState } from "../../components/EmptyState";
import { QueueItemCard } from "./QueueItemCard";

export function PostedView() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["yt-queue"],
    queryFn: youtubeApi.getQueue,
    refetchInterval: 15_000,
  });

  const queue = (data as { queue: Array<Record<string, unknown>> } | undefined)?.queue || [];
  const posted = queue
    .filter((item) => item.status === "published")
    .sort((a, b) => {
      const ta = new Date((a.publishedAt ?? a.publishTime) as string).getTime();
      const tb = new Date((b.publishedAt ?? b.publishTime) as string).getTime();
      return tb - ta;
    });
  const refresh = () => qc.invalidateQueries({ queryKey: ["yt-queue"] });

  return isLoading ? (
    <p className="text-sm text-muted-foreground">Loading...</p>
  ) : posted.length === 0 ? (
    <EmptyState icon={CheckCircle2} message="Nothing has been posted yet." />
  ) : (
    <div className="space-y-3">
      {posted.map((item) => (
        <QueueItemCard key={item.id as string} item={item} onRefresh={refresh} />
      ))}
    </div>
  );
}
