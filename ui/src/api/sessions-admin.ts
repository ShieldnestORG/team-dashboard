import { api } from "./client.js";

// ---------------------------------------------------------------------------
// University live-sessions admin — typed client for the
// /api/portal/university/sessions/* surface. Mirrors the route handlers in
// server/src/routes/portal.ts and the serializers there:
//   - serializeAdminSession (full row, join_url ALWAYS present)  → AdminSession
//   - the member listSessions view (join_url GATED)              → SessionView
//   - listSessionRsvps roster entry                             → Rsvp
//
// All admin routes are gated server-side by requireSessionAdmin
// (UNIVERSITY_SESSION_ADMINS env allow-list). When unset, every admin call
// returns 403 — surfaced as an env-gate banner in the page. Auth is the Better
// Auth cookie sent by the shared `api` client (credentials: "include").
// ---------------------------------------------------------------------------

// Full admin shape from serializeAdminSession (portal.ts). join_url is always
// included for admins since they author it. Timestamps are ISO strings.
export interface AdminSession {
  id: string;
  title: string;
  description: string | null;
  hostName: string;
  hostEmail: string | null;
  startsAt: string;
  durationMinutes: number;
  joinUrl: string;
  capacity: number | null;
  // Manual recording link (v1) — Zoom-cloud / unlisted-YouTube share URL the
  // admin pastes after the call. Always present for admins; null until set.
  recordingUrl: string | null;
  status: string; // scheduled | canceled
  createdAt: string;
  updatedAt: string;
}

// Member-facing list view (university-sessions.ts SessionView). joinUrl is only
// present when the session is live AND the caller RSVP'd `going` — admins read
// it for the lifecycle flags (isLive) + goingCount, NOT the room link.
export interface SessionView {
  id: string;
  title: string;
  description: string | null;
  hostName: string;
  startsAt: string;
  durationMinutes: number;
  status: string; // scheduled | canceled
  capacity: number | null;
  goingCount: number;
  myRsvp: "going" | "canceled" | null;
  isLive: boolean;
  joinUrl?: string;
  // Not gated (unlike joinUrl) — the past-session "Watch recording" link.
  recordingUrl: string | null;
}

// One roster row (university-sessions.ts RsvpRosterEntry). `name` is the
// member's displayName when known (null for email-only / walk-in RSVPs).
export interface Rsvp {
  email: string;
  name: string | null;
  accountId: string | null;
  status: "going" | "canceled";
  createdAt: string;
}

// Body for create (all required except the optionals). Mirrors
// parseSessionCreate: startsAt is an ISO-8601 UTC string; capacity null =
// unlimited; durationMinutes defaults to 60 server-side when omitted.
export interface CreateSessionBody {
  title: string;
  hostName: string;
  joinUrl: string;
  startsAt: string;
  durationMinutes?: number;
  capacity?: number | null;
  description?: string | null;
  hostEmail?: string | null;
  // Optional recording link. Server validates as an http(s) URL; null clears it.
  recordingUrl?: string | null;
}

// Body for patch — every field optional, but at least one must be present or
// the server returns 400 ("No editable fields provided").
export type PatchSessionBody = Partial<CreateSessionBody>;

export const sessionsAdminApi = {
  listUpcoming: () =>
    api.get<{ sessions: SessionView[] }>(
      "/portal/university/sessions?scope=upcoming",
    ),
  listPast: () =>
    api.get<{ sessions: SessionView[] }>(
      "/portal/university/sessions?scope=past",
    ),
  getById: (id: string) =>
    api.get<{ session: AdminSession }>(
      `/portal/university/sessions/${id}`,
    ),
  getRsvps: (id: string) =>
    api.get<{ rsvps: Rsvp[] }>(
      `/portal/university/sessions/${id}/rsvps`,
    ),
  create: (body: CreateSessionBody) =>
    api.post<{ session: AdminSession }>(
      "/portal/university/sessions",
      body,
    ),
  patch: (id: string, body: PatchSessionBody) =>
    api.patch<{ session: AdminSession }>(
      `/portal/university/sessions/${id}`,
      body,
    ),
  cancel: (id: string) =>
    api.post<{ session: AdminSession }>(
      `/portal/university/sessions/${id}/cancel`,
      {},
    ),
  // The .ics download lives behind the member route; admins can open it in a new
  // tab to grab the calendar file (it carries the join link).
  icsUrl: (id: string) => `/api/portal/university/sessions/${id}/ics`,
};
