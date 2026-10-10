import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate } from "@/lib/router";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { PageTabBar, type PageTabItem } from "@/components/PageTabBar";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { youtubeApi } from "../../api/youtube";

const VIEWS = [
  { key: "review", label: "Review" },
  { key: "scheduled", label: "Scheduled" },
  { key: "posted", label: "Posted" },
  { key: "files", label: "Files & settings" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

function activeViewFromPath(pathname: string): ViewKey {
  const segments = pathname.split("/").filter(Boolean);
  const idx = segments.findIndex((s) => s.toLowerCase() === "youtube");
  const next = segments[idx + 1]?.toLowerCase();
  return (VIEWS.some((v) => v.key === next) ? next : "review") as ViewKey;
}

export function YouTubeArea() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const location = useLocation();
  const navigate = useNavigate();

  // The Socials hub supplies the page's one heading; this area adds a two-crumb
  // trail instead so the top bar prints a breadcrumb, not a second title.
  useEffect(() => {
    setBreadcrumbs([
      { label: "Socials & Content", href: "/socials" },
      { label: "YouTube" },
    ]);
  }, [setBreadcrumbs]);

  const active = activeViewFromPath(location.pathname);

  const items = useMemo<PageTabItem[]>(
    () => VIEWS.map((v) => ({ value: v.key, label: v.label })),
    [],
  );

  function onChange(value: string) {
    navigate(`/socials/youtube/${value}`);
  }

  const { data: stats } = useQuery({
    queryKey: ["yt-stats"],
    queryFn: youtubeApi.getStats,
    refetchInterval: 30_000,
  });

  const { data: queueData } = useQuery({
    queryKey: ["yt-queue"],
    queryFn: youtubeApi.getQueue,
    refetchInterval: 15_000,
  });

  const prodStats = stats?.productions || {};
  const queue = (queueData as { queue: Array<Record<string, unknown>> } | undefined)?.queue || [];
  const waiting = queue.filter(
    (item) => item.status === "pending_review" || item.status === "scheduled",
  ).length;

  return (
    <div className="space-y-6">
      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Productions</p>
            <p className="text-2xl font-bold">{prodStats.total || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Published</p>
            <p className="text-2xl font-bold">{prodStats.published || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Waiting</p>
            <p className="text-2xl font-bold">{waiting}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Failed</p>
            <p className="text-2xl font-bold">{prodStats.failed || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Second-level pill tab row */}
      <Tabs value={active} onValueChange={onChange} className="w-full">
        <PageTabBar items={items} value={active} onValueChange={onChange} align="start" variant="pill" />
      </Tabs>

      <Outlet />
    </div>
  );
}
