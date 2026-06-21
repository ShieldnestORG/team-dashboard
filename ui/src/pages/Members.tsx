import { useEffect, useState } from "react";
import { useSearchParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { cockpitApi } from "../api/cockpit";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "../lib/timeAgo";
import { Users } from "lucide-react";

export function Members() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams] = useSearchParams();

  const initialSearch = searchParams.get("q") ?? "";
  const [input, setInput] = useState(initialSearch);
  const [query, setQuery] = useState(initialSearch);

  useEffect(() => {
    setBreadcrumbs([{ label: "Members" }]);
  }, [setBreadcrumbs]);

  // Debounce the search input and reflect it in the URL ?q param.
  useEffect(() => {
    const trimmed = input.trim();
    const timer = window.setTimeout(() => {
      setQuery(trimmed);
      const url = new URL(window.location.href);
      if (trimmed) {
        url.searchParams.set("q", trimmed);
      } else {
        url.searchParams.delete("q");
      }
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.cockpit.members(selectedCompanyId!, query),
    queryFn: () => cockpitApi.getMembers(selectedCompanyId!, query || undefined),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to view members." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const members = data?.members ?? [];
  const counts = data?.counts;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {counts && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground tabular-nums">
                {counts.total.toLocaleString()}
              </span>{" "}
              total
            </span>
            <span>
              <span className="font-semibold text-foreground tabular-nums">
                {counts.paying.toLocaleString()}
              </span>{" "}
              paying
            </span>
            <span>
              <span className="font-semibold text-foreground tabular-nums">
                {counts.free.toLocaleString()}
              </span>{" "}
              free
            </span>
          </div>
        )}
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search members…"
          className="sm:w-[260px]"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {members.length === 0 ? (
        <EmptyState icon={Users} message="No members found." />
      ) : (
        <div className="border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Tier</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr key={m.email} className="hover:bg-accent/50 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs">{m.email}</td>
                  <td className="px-4 py-2.5">{m.displayName ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={m.tier === "member" ? "default" : "secondary"}>
                      {m.tier}
                    </Badge>
                    {m.founding && (
                      <Badge variant="outline" className="ml-1.5">
                        founding
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{m.status ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{m.plan ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                    {m.joinedAt ? timeAgo(m.joinedAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
