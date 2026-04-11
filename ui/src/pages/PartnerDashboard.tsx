import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MousePointerClick, FileText, TrendingUp, Calendar, ExternalLink } from "lucide-react";

interface ClicksByDay {
  date: string;
  clicks: number;
}

interface TrafficSource {
  source: string;
  count: number;
}

interface PartnerData {
  name: string;
  industry: string;
  totalClicks: number;
  contentMentions: number;
  clicksByDay: ClicksByDay[];
  trafficSources: TrafficSource[];
}

type ErrorKind = "no-token" | "forbidden" | "generic";

export function PartnerDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [data, setData] = useState<PartnerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorKind | null>(null);

  useEffect(() => {
    if (!token) {
      setError("no-token");
      setLoading(false);
      return;
    }

    fetch(`/api/partners/${slug}/dashboard?token=${token}`)
      .then((res) => {
        if (res.status === 403) {
          setError("forbidden");
          return null;
        }
        if (!res.ok) {
          setError("generic");
          return null;
        }
        return res.json();
      })
      .then((json) => {
        if (json) setData(json);
      })
      .catch(() => {
        setError("generic");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [slug, token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-gray-500 text-lg">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center mx-auto mb-4">
            <ExternalLink className="w-6 h-6 text-violet-600" />
          </div>
          {error === "no-token" && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Required</h2>
              <p className="text-gray-600">
                This dashboard requires a valid access link. Please use the link provided to you by
                Coherence Daddy.
              </p>
            </>
          )}
          {error === "forbidden" && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Link Expired</h2>
              <p className="text-gray-600">
                Invalid or expired dashboard link. Please contact us for a new one.
              </p>
            </>
          )}
          {error === "generic" && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Something Went Wrong</h2>
              <p className="text-gray-600">
                Something went wrong. Please try again later.
              </p>
            </>
          )}
          <a
            href="https://coherencedaddy.com"
            className="inline-block mt-6 text-sm text-violet-600 hover:text-violet-700 underline"
          >
            Visit coherencedaddy.com
          </a>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const maxClicks = Math.max(...data.clicksByDay.map((d) => d.clicks), 1);
  const totalSourceCount = data.trafficSources.reduce((sum, s) => sum + s.count, 0) || 1;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <a
              href="https://coherencedaddy.com"
              className="text-xs text-gray-400 hover:text-violet-600 flex items-center gap-1 transition-colors"
            >
              Powered by Coherence Daddy
              <ExternalLink className="w-3 h-3" />
            </a>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">{data.name}</h1>
          </div>
          <Badge
            className="bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100"
          >
            {data.industry}
          </Badge>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border border-gray-200 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Total Clicks Driven
              </CardTitle>
              <MousePointerClick className="w-5 h-5 text-violet-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">
                {data.totalClicks.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card className="border border-gray-200 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Content Mentions
              </CardTitle>
              <FileText className="w-5 h-5 text-violet-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">
                {data.contentMentions.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card className="border border-gray-200 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">
                Trend
              </CardTitle>
              <TrendingUp className="w-5 h-5 text-violet-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900">
                {data.totalClicks > 0 ? "Growing" : "New"}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {data.totalClicks > 0 ? "Traffic is active" : "Awaiting first clicks"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Clicks by Day Chart */}
        <Card className="border border-gray-200 shadow-sm bg-white">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-violet-500" />
              Clicks by Day
            </CardTitle>
            <p className="text-xs text-gray-400">Last 30 days</p>
          </CardHeader>
          <CardContent>
            {data.clicksByDay.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No click data yet.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-end gap-[2px] h-40">
                  {data.clicksByDay.map((day) => {
                    const heightPct = (day.clicks / maxClicks) * 100;
                    return (
                      <div
                        key={day.date}
                        className="flex-1 flex flex-col justify-end group relative"
                      >
                        <div
                          className="bg-violet-500 hover:bg-violet-600 rounded-t transition-colors min-h-[2px] cursor-default"
                          style={{ height: `${Math.max(heightPct, 1.5)}%` }}
                        />
                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                          {formatDate(day.date)}: {day.clicks} click{day.clicks !== 1 ? "s" : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-xs text-gray-400 pt-1">
                  <span>{formatDate(data.clicksByDay[0].date)}</span>
                  {data.clicksByDay.length > 2 && (
                    <span>
                      {formatDate(data.clicksByDay[Math.floor(data.clicksByDay.length / 2)].date)}
                    </span>
                  )}
                  <span>{formatDate(data.clicksByDay[data.clicksByDay.length - 1].date)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Traffic Sources */}
        <Card className="border border-gray-200 shadow-sm bg-white">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-gray-900">
              Traffic Sources
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.trafficSources.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No source data yet.</p>
            ) : (
              <div className="space-y-3">
                {data.trafficSources.map((source) => {
                  const pct = Math.round((source.count / totalSourceCount) * 100);
                  return (
                    <div key={source.source} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 font-medium">{source.source}</span>
                        <span className="text-gray-400">
                          {source.count.toLocaleString()} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-500 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6 py-6 text-center">
          <p className="text-sm text-gray-500">
            Want to see more?{" "}
            <a
              href="https://coherencedaddy.com"
              className="text-violet-600 hover:text-violet-700 underline"
            >
              Contact us at coherencedaddy.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
