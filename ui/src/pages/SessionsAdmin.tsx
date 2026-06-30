import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  ExternalLink,
  Radio,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ApiError } from "../api/client";
import {
  sessionsAdminApi,
  type AdminSession,
  type CreateSessionBody,
  type PatchSessionBody,
  type Rsvp,
  type SessionView,
} from "../api/sessions-admin";

// ── Helpers ────────────────────────────────────────────────────────────────

// Admin-local timezone. `toLocaleString` already renders in the admin's tz; we
// surface the short tz name so the absolute time is unambiguous.
const TZ_LABEL = (() => {
  try {
    return (
      new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
})();

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

// Relative time, future-aware ("in 3h" / "2d ago").
function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  const future = ms >= 0;
  const a = Math.abs(ms);
  let val: string;
  if (a < 60_000) val = `${Math.floor(a / 1000)}s`;
  else if (a < 3_600_000) val = `${Math.floor(a / 60_000)}m`;
  else if (a < 86_400_000) val = `${Math.floor(a / 3_600_000)}h`;
  else val = `${Math.floor(a / 86_400_000)}d`;
  return future ? `in ${val}` : `${val} ago`;
}

function durationLabel(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function capacityLabel(going: number, capacity: number | null): string {
  return capacity === null ? `${going} / ∞` : `${going} / ${capacity}`;
}

// Convert a backend 403 into the "admin not enabled / not authorized" signal.
function isAdminGate(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 403) return false;
  const msg =
    (err.body as { error?: string } | null)?.error?.toLowerCase() ?? "";
  return msg.includes("not enabled") || msg.includes("required");
}

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return (err.body as { error?: string } | null)?.error ?? err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

// Status badge: scheduled=secondary, canceled=destructive, live=emerald pulse.
function StatusBadge({
  status,
  isLive,
}: {
  status: string;
  isLive?: boolean;
}) {
  if (status === "canceled") {
    return <Badge variant="destructive">canceled</Badge>;
  }
  if (isLive) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        live
      </span>
    );
  }
  return <Badge variant="secondary">scheduled</Badge>;
}

// ── Datetime <-> local form fields ───────────────────────────────────────────
//
// The backend wants an ISO-8601 UTC string; the form collects a local date +
// time. These convert between the two using the admin's local timezone.

function isoToLocalParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// Build an ISO UTC string from local date+time inputs. Returns null when either
// is missing or the combination is not a valid date.
function localPartsToIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const local = new Date(`${date}T${time}`);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

// ── Stat cards ───────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: typeof Users;
  value: React.ReactNode;
  label: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon
          className={`h-5 w-5 ${
            accent ? "text-emerald-500" : "text-muted-foreground"
          }`}
        />
        <div className="min-w-0">
          <div className="text-2xl font-bold leading-tight">{value}</div>
          <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCards({ upcoming }: { upcoming: SessionView[] }) {
  const scheduled = upcoming.filter((s) => s.status === "scheduled");
  const totalRsvps = scheduled.reduce((sum, s) => sum + s.goingCount, 0);
  const liveNow = scheduled.filter((s) => s.isLive).length;
  // Soonest scheduled, non-live session that hasn't started — "next up".
  const next = scheduled
    .filter((s) => new Date(s.startsAt).getTime() > Date.now())
    .sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    )[0];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={CalendarClock}
        value={scheduled.length}
        label="Upcoming"
      />
      <StatCard icon={Users} value={totalRsvps} label="Total RSVPs (going)" />
      <StatCard
        icon={CalendarPlus}
        value={next ? formatRelative(next.startsAt) : "—"}
        label={next ? `Next · ${next.title}` : "Next session"}
      />
      <StatCard
        icon={Radio}
        value={liveNow}
        label="Live now"
        accent={liveNow > 0}
      />
    </div>
  );
}

// ── Roster (edit sheet) ───────────────────────────────────────────────────────

function Roster({ sessionId }: { sessionId: string }) {
  const rsvpsQuery = useQuery({
    queryKey: ["sessions-admin", "rsvps", sessionId],
    queryFn: () => sessionsAdminApi.getRsvps(sessionId),
  });

  const going: Rsvp[] = (rsvpsQuery.data?.rsvps ?? []).filter(
    (r) => r.status === "going",
  );

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
        Going ({going.length})
      </h3>
      {rsvpsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading roster…</p>
      ) : rsvpsQuery.error ? (
        <p className="text-sm text-red-500">Failed to load roster.</p>
      ) : going.length === 0 ? (
        <p className="text-sm text-muted-foreground">No RSVPs yet.</p>
      ) : (
        <ul className="space-y-1">
          {going.map((r) => (
            <li
              key={r.email}
              className="flex items-center justify-between gap-3 rounded border border-border/60 px-2 py-1.5 text-sm"
            >
              <span className="truncate">
                {r.name ?? (
                  <span className="text-muted-foreground">no name</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {r.email}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Create / Edit sheet ────────────────────────────────────────────────────────

interface FormState {
  title: string;
  hostName: string;
  joinUrl: string;
  date: string;
  time: string;
  durationMinutes: string;
  capacity: string;
  description: string;
  hostEmail: string;
  recordingUrl: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  hostName: "",
  joinUrl: "",
  date: "",
  time: "",
  durationMinutes: "60",
  capacity: "",
  description: "",
  hostEmail: "",
  recordingUrl: "",
};

function fromAdminSession(s: AdminSession): FormState {
  const { date, time } = isoToLocalParts(s.startsAt);
  return {
    title: s.title,
    hostName: s.hostName,
    joinUrl: s.joinUrl,
    date,
    time,
    durationMinutes: String(s.durationMinutes),
    capacity: s.capacity === null ? "" : String(s.capacity),
    description: s.description ?? "",
    hostEmail: s.hostEmail ?? "",
    recordingUrl: s.recordingUrl ?? "",
  };
}

// Client validation mirroring parseSessionCreate (portal.ts). Returns the first
// error message, or null when valid. `requireFuture` is true on create.
function validateForm(form: FormState, requireFuture: boolean): string | null {
  const title = form.title.trim();
  if (!title || title.length > 200) return "Title is required (1–200 chars)";
  const hostName = form.hostName.trim();
  if (!hostName || hostName.length > 200)
    return "Host name is required (1–200 chars)";
  const joinUrl = form.joinUrl.trim();
  if (!joinUrl || !/^https:\/\//i.test(joinUrl))
    return "Join URL is required and must be an https URL";
  const iso = localPartsToIso(form.date, form.time);
  if (!iso) return "Starts at must be a valid date and time";
  if (requireFuture && new Date(iso).getTime() <= Date.now())
    return "Starts at must be in the future";
  const dur = Number(form.durationMinutes);
  if (
    !Number.isInteger(dur) ||
    dur < 1 ||
    dur > 480
  )
    return "Duration must be a whole number of minutes (1–480)";
  if (form.capacity.trim() !== "") {
    const cap = Number(form.capacity);
    if (!Number.isInteger(cap) || cap < 1)
      return "Capacity must be a whole number ≥ 1 (or blank for unlimited)";
  }
  if (form.description.length > 4000)
    return "Description must be 4000 characters or fewer";
  const recordingUrl = form.recordingUrl.trim();
  if (recordingUrl !== "" && !/^https?:\/\//i.test(recordingUrl))
    return "Recording URL must be an http(s) link (or blank)";
  return null;
}

function SessionSheet({
  mode,
  session,
  open,
  onClose,
}: {
  mode: "create" | "edit";
  session: AdminSession | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Seed the form whenever the sheet opens (create → empty, edit → row).
  useEffect(() => {
    if (!open) return;
    setForm(mode === "edit" && session ? fromAdminSession(session) : EMPTY_FORM);
    setClientError(null);
    setServerError(null);
  }, [open, mode, session]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["sessions-admin"] });
  }

  const createMutation = useMutation({
    mutationFn: (body: CreateSessionBody) => sessionsAdminApi.create(body),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => setServerError(errMessage(err, "Failed to create session")),
  });

  const patchMutation = useMutation({
    mutationFn: (body: PatchSessionBody) =>
      sessionsAdminApi.patch(session!.id, body),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => setServerError(errMessage(err, "Failed to update session")),
  });

  const cancelMutation = useMutation({
    mutationFn: () => sessionsAdminApi.cancel(session!.id),
    onSuccess: () => {
      invalidate();
      setConfirmCancelOpen(false);
      onClose();
    },
    onError: (err) => {
      setServerError(errMessage(err, "Failed to cancel session"));
      setConfirmCancelOpen(false);
    },
  });

  const pending =
    createMutation.isPending ||
    patchMutation.isPending ||
    cancelMutation.isPending;

  function buildBody(): CreateSessionBody {
    const iso = localPartsToIso(form.date, form.time)!;
    return {
      title: form.title.trim(),
      hostName: form.hostName.trim(),
      joinUrl: form.joinUrl.trim(),
      startsAt: iso,
      durationMinutes: Number(form.durationMinutes),
      capacity: form.capacity.trim() === "" ? null : Number(form.capacity),
      description: form.description.trim() === "" ? null : form.description,
      hostEmail: form.hostEmail.trim() === "" ? null : form.hostEmail.trim(),
      // Blank clears it (null); otherwise the trimmed link. On patch this means
      // an emptied field explicitly removes a previously-set recording.
      recordingUrl:
        form.recordingUrl.trim() === "" ? null : form.recordingUrl.trim(),
    };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const error = validateForm(form, mode === "create");
    if (error) {
      setClientError(error);
      return;
    }
    setClientError(null);
    if (mode === "create") {
      createMutation.mutate(buildBody());
    } else {
      patchMutation.mutate(buildBody());
    }
  }

  const isCanceled = session?.status === "canceled";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {mode === "create" ? "New session" : "Edit session"}
          </SheetTitle>
          <SheetDescription>
            {mode === "create"
              ? "Schedule a live session. The join URL is never shown to members until the room is live."
              : "Update this session. Members see the change immediately."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="space-y-4 px-4 pb-8">
          <div className="space-y-1.5">
            <Label htmlFor="sess-title">Title</Label>
            <Input
              id="sess-title"
              value={form.title}
              maxLength={200}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Coherent Loop — weekly practice"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sess-host">Host name</Label>
            <Input
              id="sess-host"
              value={form.hostName}
              maxLength={200}
              onChange={(e) => set("hostName", e.target.value)}
              placeholder="Jane Coherent"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sess-join">Join URL</Label>
            <Input
              id="sess-join"
              type="url"
              value={form.joinUrl}
              onChange={(e) => set("joinUrl", e.target.value)}
              placeholder="https://meet.example.com/room"
            />
            <p className="text-[11px] text-muted-foreground">
              Must start with https://. Gated — members only see it once the room
              is live.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sess-date">
                Starts — date{TZ_LABEL ? ` (${TZ_LABEL})` : ""}
              </Label>
              <Input
                id="sess-date"
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sess-time">Starts — time</Label>
              <Input
                id="sess-time"
                type="time"
                value={form.time}
                onChange={(e) => set("time", e.target.value)}
              />
            </div>
          </div>
          {mode === "edit" && (
            <p className="-mt-2 flex items-start gap-1.5 text-[11px] text-amber-500">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              Changing the start time is not re-validated as a future date by the
              backend — double-check it.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sess-dur">Duration (minutes)</Label>
              <Input
                id="sess-dur"
                type="number"
                min={1}
                max={480}
                value={form.durationMinutes}
                onChange={(e) => set("durationMinutes", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sess-cap">Capacity</Label>
              <Input
                id="sess-cap"
                type="number"
                min={1}
                value={form.capacity}
                onChange={(e) => set("capacity", e.target.value)}
                placeholder="blank = unlimited"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sess-desc">Description</Label>
            <Textarea
              id="sess-desc"
              value={form.description}
              maxLength={4000}
              rows={3}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What members should expect…"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sess-recording">
              Recording URL{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="sess-recording"
              type="url"
              value={form.recordingUrl}
              onChange={(e) => set("recordingUrl", e.target.value)}
              placeholder="https://zoom.us/rec/share/… or unlisted YouTube link"
            />
            <p className="text-[11px] text-muted-foreground">
              Paste a Zoom-cloud or unlisted-YouTube link — shown to members on
              past sessions. Leave blank to clear.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sess-hostemail">
              Host email{" "}
              <span className="font-normal text-muted-foreground">
                (optional · internal only)
              </span>
            </Label>
            <Input
              id="sess-hostemail"
              type="email"
              value={form.hostEmail}
              onChange={(e) => set("hostEmail", e.target.value)}
              placeholder="host@coherencedaddy.com"
            />
          </div>

          {(clientError || serverError) && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {clientError ?? serverError}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 border-t pt-4">
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={pending}>
                {mode === "create" ? "Create session" : "Save changes"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={onClose}
              >
                Cancel
              </Button>
            </div>
            {mode === "edit" && session && !isCanceled && (
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => setConfirmCancelOpen(true)}
              >
                Cancel session
              </Button>
            )}
          </div>

          {mode === "edit" && session && (
            <div className="space-y-4 border-t pt-4">
              <Roster sessionId={session.id} />
              <a
                href={sessionsAdminApi.icsUrl(session.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                Download .ics
              </a>
            </div>
          )}
        </form>
      </SheetContent>

      {/* Cancel confirmation */}
      <AlertDialog
        open={confirmCancelOpen}
        onOpenChange={setConfirmCancelOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this session?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancels the session and emails everyone who RSVP'd. RSVPs are kept.
              Can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={cancelMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                cancelMutation.mutate();
              }}
            >
              Cancel session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

// ── Tables ─────────────────────────────────────────────────────────────────────

function UpcomingTable({
  rows,
  onSelect,
}: {
  rows: SessionView[];
  onSelect: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Upcoming</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-2 py-2 font-medium">Title</th>
                <th className="px-2 py-2 font-medium">Host</th>
                <th className="px-2 py-2 font-medium">
                  Starts{TZ_LABEL ? ` (${TZ_LABEL})` : ""}
                </th>
                <th className="px-2 py-2 font-medium">Duration</th>
                <th className="px-2 py-2 font-medium">Capacity</th>
                <th className="px-2 py-2 text-right font-medium">Going</th>
                <th className="px-2 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={`cursor-pointer border-b last:border-b-0 hover:bg-accent/50 ${
                    row.status === "canceled" ? "opacity-60" : ""
                  }`}
                  onClick={() => onSelect(row.id)}
                >
                  <td className="px-2 py-2">
                    <div className="truncate font-medium">{row.title}</div>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {row.hostName}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {formatDateTime(row.startsAt)}
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {durationLabel(row.durationMinutes)}
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {capacityLabel(row.goingCount, row.capacity)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-xs">
                    {row.goingCount}
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge status={row.status} isLive={row.isLive} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-2 py-12 text-center text-sm text-muted-foreground"
                  >
                    No upcoming sessions. Create one to get started.
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

function PastTable({ rows }: { rows: SessionView[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Past</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-2 py-2 font-medium">Title</th>
                <th className="px-2 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Host</th>
                <th className="px-2 py-2 text-right font-medium">Going</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b last:border-b-0 text-muted-foreground"
                >
                  <td className="px-2 py-2">
                    <span className="truncate">{row.title}</span>
                  </td>
                  <td className="px-2 py-2 text-xs">{formatDate(row.startsAt)}</td>
                  <td className="px-2 py-2 text-xs">{row.hostName}</td>
                  <td className="px-2 py-2 text-right font-mono text-xs">
                    {row.goingCount}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-2 py-8 text-center text-sm text-muted-foreground"
                  >
                    No past sessions yet.
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

// ── Env-gate banner ──────────────────────────────────────────────────────────

function EnvGateBanner() {
  return (
    <Card className="border-amber-500/40 bg-amber-500/10">
      <CardContent className="flex items-start gap-3 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-amber-600 dark:text-amber-400">
            Session administration is not enabled
          </p>
          <p className="text-muted-foreground">
            Set the{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              UNIVERSITY_SESSION_ADMINS
            </code>{" "}
            environment variable (comma-separated admin emails, including yours)
            on the team-dashboard backend and redeploy, then reload this page.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function SessionsAdmin() {
  const [sheet, setSheet] = useState<
    { mode: "create" } | { mode: "edit"; id: string } | null
  >(null);

  const upcomingQuery = useQuery({
    queryKey: ["sessions-admin", "upcoming"],
    queryFn: () => sessionsAdminApi.listUpcoming(),
    retry: false,
  });
  const pastQuery = useQuery({
    queryKey: ["sessions-admin", "past"],
    queryFn: () => sessionsAdminApi.listPast(),
    retry: false,
  });

  // Full AdminSession for the edit sheet (the list view gates join_url).
  const editId = sheet?.mode === "edit" ? sheet.id : null;
  const detailQuery = useQuery({
    queryKey: ["sessions-admin", "detail", editId],
    queryFn: () => sessionsAdminApi.getById(editId!),
    enabled: editId !== null,
  });

  const gated =
    isAdminGate(upcomingQuery.error) || isAdminGate(pastQuery.error);

  const upcoming = upcomingQuery.data?.sessions ?? [];
  const past = pastQuery.data?.sessions ?? [];

  return (
    <TooltipProvider>
      <div className="space-y-6 p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
            <p className="text-sm text-muted-foreground">
              Schedule and manage University live sessions
            </p>
          </div>
          {!gated && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={() => setSheet({ mode: "create" })}>
                  <CalendarPlus className="h-4 w-4" />
                  New session
                </Button>
              </TooltipTrigger>
              <TooltipContent>Schedule a live session</TooltipContent>
            </Tooltip>
          )}
        </header>

        {gated ? (
          <EnvGateBanner />
        ) : (
          <>
            <StatCards upcoming={upcoming} />

            {upcomingQuery.isLoading ? (
              <Card>
                <CardContent className="p-8 text-sm text-muted-foreground">
                  Loading sessions…
                </CardContent>
              </Card>
            ) : upcomingQuery.error ? (
              <Card>
                <CardContent className="p-8 text-sm text-red-500">
                  {errMessage(upcomingQuery.error, "Failed to load sessions.")}
                </CardContent>
              </Card>
            ) : (
              <UpcomingTable
                rows={upcoming}
                onSelect={(id) => setSheet({ mode: "edit", id })}
              />
            )}

            {pastQuery.isLoading ? null : pastQuery.error ? (
              <Card>
                <CardContent className="p-8 text-sm text-red-500">
                  {errMessage(pastQuery.error, "Failed to load past sessions.")}
                </CardContent>
              </Card>
            ) : (
              <PastTable rows={past} />
            )}
          </>
        )}

        <SessionSheet
          mode={sheet?.mode ?? "create"}
          session={sheet?.mode === "edit" ? detailQuery.data?.session ?? null : null}
          open={sheet !== null}
          onClose={() => setSheet(null)}
        />
      </div>
    </TooltipProvider>
  );
}
