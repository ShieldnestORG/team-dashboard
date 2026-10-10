import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Youtube } from "lucide-react";
import { youtubeApi } from "../../api/youtube";
import { EmptyState } from "../../components/EmptyState";
import { ReviewCard } from "./ReviewCard";

export function ReviewView() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["yt-queue"],
    queryFn: youtubeApi.getQueue,
    refetchInterval: 15_000,
  });

  const queue = (data as { queue: Array<Record<string, unknown>> } | undefined)?.queue || [];
  // Newest first — the queue route already orders by createdAt desc.
  const review = queue.filter((item) => item.status === "pending_review");
  const refresh = () => qc.invalidateQueries({ queryKey: ["yt-queue"] });

  return isLoading ? (
    <p className="text-sm text-muted-foreground">Loading...</p>
  ) : review.length === 0 ? (
    <EmptyState icon={Youtube} message="Nothing to review. The next video is made tonight." />
  ) : (
    <div className="space-y-3">
      {review.map((item) => (
        <ReviewCard key={item.id as string} item={item} onRefresh={refresh} />
      ))}
    </div>
  );
}
