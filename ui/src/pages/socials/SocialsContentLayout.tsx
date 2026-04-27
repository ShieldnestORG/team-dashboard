import { useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "@/lib/router";
import {
  Bird,
  ImageIcon,
  LineChart,
  Megaphone,
  MessageSquare,
  Newspaper,
  Radar,
  Reply,
  Share2,
  Youtube,
} from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { PageTabBar, type PageTabItem } from "@/components/PageTabBar";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";

type TabKey =
  | "overview"
  | "content"
  | "analytics"
  | "twitter"
  | "discord"
  | "youtube"
  | "pushes"
  | "house-ads"
  | "auto-reply"
  | "launch-monitor";

interface TabDef {
  key: TabKey;
  /** URL segment after `/socials/` ("" for overview). */
  segment: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabDef[] = [
  { key: "overview", segment: "", label: "Overview", icon: Share2 },
  { key: "content", segment: "content", label: "Content", icon: Newspaper },
  { key: "analytics", segment: "analytics", label: "Analytics", icon: LineChart },
  { key: "twitter", segment: "twitter", label: "Twitter/X", icon: Bird },
  { key: "discord", segment: "discord", label: "Discord", icon: MessageSquare },
  { key: "youtube", segment: "youtube", label: "YouTube", icon: Youtube },
  { key: "pushes", segment: "pushes", label: "Marketing Pushes", icon: Megaphone },
  { key: "house-ads", segment: "house-ads", label: "House Ads", icon: ImageIcon },
  { key: "auto-reply", segment: "auto-reply", label: "Auto-Reply", icon: Reply },
  { key: "launch-monitor", segment: "launch-monitor", label: "Launch Monitor", icon: Radar },
];

function activeTabFromPath(pathname: string): TabKey {
  // Strip optional /:companyPrefix and find segment after `socials`.
  const segments = pathname.split("/").filter(Boolean);
  const idx = segments.findIndex((s) => s.toLowerCase() === "socials");
  if (idx === -1) return "overview";
  const next = segments[idx + 1]?.toLowerCase();
  if (!next) return "overview";
  const match = TABS.find((t) => t.segment === next);
  return match ? match.key : "overview";
}

export function SocialsContentLayout() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const location = useLocation();
  const navigate = useNavigate();

  const active = activeTabFromPath(location.pathname);

  useEffect(() => {
    setBreadcrumbs([{ label: "Socials & Content" }]);
  }, [setBreadcrumbs]);

  const items = useMemo<PageTabItem[]>(
    () =>
      TABS.map((t) => {
        const Icon = t.icon;
        return {
          value: t.key,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </span>
          ),
        };
      }),
    [],
  );

  function onChange(value: string) {
    const def = TABS.find((t) => t.key === value);
    if (!def) return;
    const target = def.segment ? `/socials/${def.segment}` : "/socials";
    navigate(target);
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Socials & Content</h1>
        <p className="text-sm text-muted-foreground">
          Unified hub for social accounts, content review, analytics, and per-platform admin tools.
        </p>
      </div>
      <Tabs value={active} onValueChange={onChange} className="w-full">
        <PageTabBar items={items} value={active} onValueChange={onChange} align="start" />
      </Tabs>
      <div className="pt-2">
        <Outlet />
      </div>
    </div>
  );
}
