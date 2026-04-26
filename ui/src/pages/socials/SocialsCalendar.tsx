import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { socialsApi } from "../../api/socials";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const PLATFORM_COLOR: Record<string, string> = {
  x: "bg-sky-500/20 text-sky-700",
  reddit: "bg-orange-500/20 text-orange-700",
  linkedin: "bg-blue-700/20 text-blue-800",
  discord: "bg-indigo-500/20 text-indigo-700",
  bluesky: "bg-cyan-500/20 text-cyan-700",
  youtube: "bg-red-500/20 text-red-700",
  blog: "bg-emerald-500/20 text-emerald-700",
  instagram: "bg-pink-500/20 text-pink-700",
  facebook: "bg-blue-500/20 text-blue-700",
  tiktok: "bg-black/20 text-black",
  substack: "bg-orange-600/20 text-orange-800",
  skool: "bg-purple-500/20 text-purple-700",
  devto: "bg-zinc-800/20 text-zinc-800",
  hn: "bg-orange-700/20 text-orange-900",
  github: "bg-zinc-700/20 text-zinc-800",
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function SocialsCalendar() {
  const [brand, setBrand] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");
  const range = useMemo(() => {
    const now = Date.now();
    return {
      from: new Date(now - 7 * 24 * 3600 * 1000).toISOString(),
      to: new Date(now + 14 * 24 * 3600 * 1000).toISOString(),
    };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["socials", "calendar", brand, platform, range.from, range.to],
    queryFn: () => socialsApi.calendar({ ...range, brand: brand || undefined, platform: platform || undefined }),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading calendar…</div>;
  const events = data?.events ?? [];

  const byDay = new Map<string, typeof events>();
  for (const e of events) {
    const k = dayKey(new Date(e.when));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(e);
  }
  const days = [...byDay.keys()].sort();

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <label className="space-y-1">
          <div className="text-xs">Brand</div>
          <select className="rounded border px-2 py-1 text-sm" value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">all</option>
            {["cd", "tokns", "tx", "shieldnest", "directory", "partners", "coherencedaddy"].map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <div className="text-xs">Platform</div>
          <select className="rounded border px-2 py-1 text-sm" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="">all</option>
            {Object.keys(PLATFORM_COLOR).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <div className="text-xs text-muted-foreground ml-auto">
          {events.length} event{events.length === 1 ? "" : "s"} from {range.from.slice(0, 10)} to {range.to.slice(0, 10)}
        </div>
      </div>

      {days.length === 0 && (
        <div className="text-sm text-muted-foreground">No events in this range.</div>
      )}
      {days.map((day) => (
        <Card key={day}>
          <CardHeader>
            <CardTitle className="text-sm">
              {new Date(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {byDay.get(day)!.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-12">
                    {new Date(e.when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs ${PLATFORM_COLOR[e.platform] ?? "bg-gray-200"}`}>
                    {e.platform}
                  </span>
                  <span className="text-xs text-muted-foreground">{e.brand}</span>
                  <span>{e.title}</span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline">{e.status}</Badge>
                  <Badge variant={e.source === "content" ? "default" : "secondary"}>
                    {e.source === "content" ? "real" : "projected"}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
