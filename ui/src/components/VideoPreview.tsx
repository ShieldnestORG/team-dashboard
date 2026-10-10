import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A 16:9 video box with the browser's own controls. Used anywhere a video is
 * reviewed or approved (docs/ux/design-system.md §5.4 "VideoPreview"): a
 * review surface must show the thing being approved in the same card as the
 * controls. It never plays on its own and never grows wider than its box.
 */
export function VideoPreview({ src, title }: { src: string; title: string }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  return (
    <div className="aspect-video w-full rounded-md border border-border bg-muted overflow-hidden">
      {loading && !failed && <Skeleton className="h-full w-full rounded-none" />}
      {failed ? (
        <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
          This video file is no longer on the server.
        </p>
      ) : (
        <video
          controls
          preload="metadata"
          src={src}
          aria-label={title}
          className="h-full w-full"
          onLoadedMetadata={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
        />
      )}
    </div>
  );
}
