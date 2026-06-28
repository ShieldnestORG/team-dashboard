import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clock,
  Eye,
  GraduationCap,
  LifeBuoy,
  MessageSquare,
  Search,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  universityAdminApi,
  type UniversityAdminMemberRow,
} from "../api/university-admin";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function statusBadgeVariant(
  status: string | null | undefined,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "cancelled") return "secondary";
  if (status === "past_due") return "destructive";
  return "outline";
}

// ── Stat cards ─────────────────────────────────────────────────────────────

function StatCards({ rows }: { rows: UniversityAdminMemberRow[] }) {
  const total = rows.length;
  const active = rows.filter((r) => r.status === "active").length;
  const pastDue = rows.filter((r) => r.status === "past_due").length;
  const cancelled = rows.filter((r) => r.status === "cancelled").length;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <Users className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-2xl font-bold leading-tight">
              {active}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / {total}
              </span>
            </div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Members (active / total)
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <GraduationCap className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-2xl font-bold leading-tight">{active}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Active members
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <AlertTriangle
            className={`h-5 w-5 ${
              pastDue > 0 ? "text-red-400" : "text-muted-foreground"
            }`}
          />
          <div>
            <div className="text-2xl font-bold leading-tight">{pastDue}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Past due
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <LifeBuoy className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-2xl font-bold leading-tight">{cancelled}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Cancelled
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sortable members table ─────────────────────────────────────────────────

type SortKey = "email" | "displayName" | "plan" | "status" | "joinedAt";

function MembersTable({
  rows,
  onSelect,
  title,
}: {
  rows: UniversityAdminMemberRow[];
  onSelect: (memberId: string) => void;
  title: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("joinedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = av ?? "";
      const bn = bv ?? "";
      const cmp = String(an).localeCompare(String(bn));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "joinedAt" ? "desc" : "asc");
    }
  }

  function SortHeader({ k, label }: { k: SortKey; label: string }) {
    const active = k === sortKey;
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 text-left font-medium transition-colors hover:text-foreground ${
          active ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {label}
        {active &&
          (sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          ))}
      </button>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs">
                <th className="px-2 py-2">
                  <SortHeader k="email" label="Email" />
                </th>
                <th className="px-2 py-2">
                  <SortHeader k="displayName" label="Display name" />
                </th>
                <th className="px-2 py-2">
                  <SortHeader k="status" label="Status" />
                </th>
                <th className="px-2 py-2">
                  <SortHeader k="plan" label="Plan" />
                </th>
                <th className="px-2 py-2">
                  <SortHeader k="joinedAt" label="Joined" />
                </th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-accent/50"
                  onClick={() => onSelect(row.id)}
                >
                  <td className="px-2 py-2 font-mono text-xs">{row.email}</td>
                  <td className="px-2 py-2">
                    {row.displayName ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant={statusBadgeVariant(row.status)}>
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 text-xs">
                    <Badge variant="outline">{row.plan}</Badge>
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {formatDate(row.joinedAt)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-2 py-12 text-center text-sm text-muted-foreground"
                  >
                    No members
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Member detail sheet ────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "past_due", label: "Past due" },
  { key: "cancelled", label: "Cancelled" },
] as const;

function MemberSheet({
  memberId,
  onClose,
}: {
  memberId: string | null;
  onClose: () => void;
}) {
  const open = memberId !== null;
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["university-admin", "member", memberId],
    queryFn: () =>
      memberId ? universityAdminApi.getMember(memberId) : Promise.reject(),
    enabled: open,
  });

  async function refreshAll() {
    // Refetch the detail plus the list/recovery views so the new status shows.
    await Promise.all([
      detailQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ["university-admin", "members"] }),
      queryClient.invalidateQueries({ queryKey: ["university-admin", "recovery"] }),
    ]);
  }

  async function runAction(
    name: string,
    fn: () => Promise<{ message?: string }>,
  ) {
    setPending(name);
    setActionMsg(null);
    setActionErr(null);
    try {
      const result = await fn();
      setActionMsg(result.message ?? `${name} done`);
      await refreshAll();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : `${name} failed`);
    } finally {
      setPending(null);
    }
  }

  const data = detailQuery.data;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl">
        {!memberId ? null : detailQuery.isLoading ? (
          <div className="p-8 text-sm text-muted-foreground">Loading…</div>
        ) : detailQuery.error ? (
          <div className="p-8 text-sm text-red-400">Failed to load member.</div>
        ) : !data ? null : (
          <>
            <SheetHeader className="border-b">
              <SheetTitle>
                {data.member.displayName ?? data.member.email}
              </SheetTitle>
              <SheetDescription>
                <span className="font-mono text-xs">{data.member.email}</span> ·{" "}
                <Badge variant={statusBadgeVariant(data.member.status)}>
                  {data.member.status}
                </Badge>
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-8 pt-2">
              {/* Subscription */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Subscription
                </h3>
                {!data.subscription ? (
                  <p className="text-sm text-muted-foreground">
                    No subscription on file.
                  </p>
                ) : (
                  <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>
                      <Badge
                        variant={statusBadgeVariant(data.subscription.status)}
                      >
                        {data.subscription.status ?? "—"}
                      </Badge>
                    </dd>
                    <dt className="text-muted-foreground">Plan</dt>
                    <dd>
                      <Badge variant="outline">
                        {data.subscription.plan ?? "—"}
                      </Badge>
                    </dd>
                    <dt className="text-muted-foreground">Period end</dt>
                    <dd className="text-xs">
                      {formatDateTime(data.subscription.currentPeriodEnd)}
                    </dd>
                    <dt className="text-muted-foreground">Cancelled at</dt>
                    <dd className="text-xs">
                      {formatDateTime(data.subscription.canceledAt)}
                    </dd>
                    <dt className="text-muted-foreground">Stripe cust</dt>
                    <dd className="font-mono text-xs">
                      {data.subscription.stripeCustomerId ?? "—"}
                    </dd>
                    <dt className="text-muted-foreground">Stripe sub</dt>
                    <dd className="font-mono text-xs">
                      {data.subscription.stripeSubscriptionId ?? "—"}
                    </dd>
                  </dl>
                )}
              </section>

              {/* Recent community posts */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Recent posts ({data.posts.length})
                </h3>
                {data.posts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No community posts.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.posts.map((post) => (
                      <li
                        key={post.id}
                        className="rounded-md border border-border bg-card/50 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {formatRelative(post.createdAt)}
                          </span>
                          <span>
                            {post.commentCount} comments · {post.reactionCount}{" "}
                            resonates
                          </span>
                        </div>
                        <p className="mt-1 break-words text-sm">{post.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Activity / timeline */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Activity
                </h3>
                {data.timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No activity recorded.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {data.timeline.map((entry, i) => (
                      <li
                        key={i}
                        className="flex items-start justify-between gap-3 rounded border border-border/60 px-2 py-1.5 text-xs"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="font-medium">{entry.label}</span>
                        </div>
                        <div className="shrink-0 text-right text-muted-foreground">
                          {formatRelative(entry.at)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Actions */}
              <div className="border-t pt-4">
                {actionMsg && (
                  <p className="mb-2 text-xs text-emerald-400">{actionMsg}</p>
                )}
                {actionErr && (
                  <p className="mb-2 text-xs text-red-400">{actionErr}</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={
                      pending !== null || data.member.status === "cancelled"
                    }
                    onClick={() => {
                      const reason =
                        window.prompt(
                          "Cancellation reason (optional):",
                          "",
                        ) ?? undefined;
                      void runAction("Cancel", () =>
                        universityAdminApi
                          .cancel(data.member.id, reason || undefined)
                          .then(() => ({ message: "Member cancelled" })),
                      );
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={
                      pending !== null || data.member.status === "active"
                    }
                    onClick={() =>
                      void runAction("Reactivate", () =>
                        universityAdminApi
                          .reactivate(data.member.id)
                          .then(() => ({ message: "Member reactivated" })),
                      )
                    }
                  >
                    Reactivate
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending !== null}
                    onClick={() => {
                      const raw = window.prompt(
                        "Refund amount in dollars (optional):",
                        "",
                      );
                      const amount =
                        raw && raw.trim() && Number.isFinite(Number(raw))
                          ? Number(raw)
                          : undefined;
                      void runAction("Refund", () =>
                        universityAdminApi.refund(data.member.id, amount),
                      );
                    }}
                  >
                    Refund
                  </Button>
                  <Button variant="secondary" size="sm" onClick={onClose}>
                    Close
                  </Button>
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Actions write directly to the local demo DB — no Stripe call is
                  made for synthetic members.
                </p>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Recovery pipeline ──────────────────────────────────────────────────────

function RecoverySection({
  onSelect,
}: {
  onSelect: (memberId: string) => void;
}) {
  const recoveryQuery = useQuery({
    queryKey: ["university-admin", "recovery"],
    queryFn: () => universityAdminApi.recovery(),
  });

  const rows = recoveryQuery.data?.members ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <LifeBuoy className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Recovery pipeline</h2>
        <span className="text-xs text-muted-foreground">
          past due + cancelled
        </span>
      </div>
      {recoveryQuery.isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading recovery pipeline…
          </CardContent>
        </Card>
      ) : recoveryQuery.error ? (
        <Card>
          <CardContent className="p-6 text-sm text-red-400">
            Failed to load recovery pipeline.
          </CardContent>
        </Card>
      ) : (
        <MembersTable rows={rows} onSelect={onSelect} title="At-risk members" />
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function UniversityAdmin() {
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const membersQuery = useQuery({
    queryKey: ["university-admin", "members", statusFilter, search],
    queryFn: () =>
      universityAdminApi.listMembers({
        status: statusFilter || null,
        q: search || null,
      }),
  });

  const rows = membersQuery.data?.members ?? [];

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">University</h1>
        <p className="text-sm text-muted-foreground">
          Coherent Ones University members and recovery
        </p>
      </header>

      <StatCards rows={rows} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.key || "all"}
              variant={statusFilter === f.key ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search email or name…"
              className="h-9 w-64 pl-7"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setSearchInput("");
              }}
            >
              Clear
            </Button>
          )}
        </form>
      </div>

      {membersQuery.isLoading ? (
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground">
            Loading members…
          </CardContent>
        </Card>
      ) : membersQuery.error ? (
        <Card>
          <CardContent className="p-8 text-sm text-red-400">
            Failed to load members.
          </CardContent>
        </Card>
      ) : (
        <MembersTable
          rows={rows}
          onSelect={(id) => setOpenMemberId(id)}
          title="Members"
        />
      )}

      <RecoverySection onSelect={(id) => setOpenMemberId(id)} />

      <MemberSheet
        memberId={openMemberId}
        onClose={() => setOpenMemberId(null)}
      />
    </div>
  );
}
