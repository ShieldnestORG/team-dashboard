import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  date,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customerAccounts } from "./customer_portal.js";

// ---------------------------------------------------------------------------
// Coherent Ones University — $50/mo recurring membership.
//
// A University member is its OWN member class, not merely an access flag
// bolted onto an existing customer/affiliate account. We model it as a real
// member entity (`university_members`) while REUSING the existing magic-link
// auth — `customer_accounts` is the shared login identity, joined on the
// lowercased `email` (or `account_id` once the customer-account-linker has
// fired) — and the existing Stripe pipeline.
//
// Two tables:
//   - university_members        — the member entity / profile (the join key
//                                 is the lowercased `email`).
//   - university_subscriptions  — the Stripe billing record. Idempotency key
//                                 is `stripe_subscription_id` (UNIQUE).
//
// The Stripe webhook handler (services/university-stripe-handler.ts) upserts
// both on `checkout.session.completed`; `customer.subscription.updated` /
// `customer.subscription.deleted` mirror status onto both rows. Mirrors the
// single-tier $X/mo Watchtower template — see schema/watchtower.ts.
// ---------------------------------------------------------------------------

export const universityMembers = pgTable(
  "university_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — set once the customer-account-linker resolves the shared
    // customer_accounts login identity. `email` is the durable join key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The join key. Lowercased before insert — unique across members.
    email: text("email").notNull(),
    displayName: text("display_name"),
    // pending | active | past_due | cancelled
    status: text("status").notNull().default("pending"),
    // Stable plan key — 'university_monthly' ($50/mo) or 'university_annual'
    // ($500/yr). Set from the checkout metadata.plan at activation.
    plan: text("plan").notNull().default("university_monthly"),
    // Founding-member price-lock. Stamped true at activation while the member
    // count is below UNIVERSITY_FOUNDING_CAP. Once true, stays true for life —
    // the rate is locked regardless of later cap changes (see migration 0129).
    founding: boolean("founding").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    // Invisible-agent identity (ADMIN-ONLY; see migration 0136). NEVER serialized
    // into the member-facing community feed — buildAuthor() stays the sole author
    // gateway and returns only { displayName, handle, isYou, isMark }.
    isAgent: boolean("is_agent").notNull().default(false),
    agentPersonaKey: text("agent_persona_key"), // 'maya' | 'dario' | ... ; NULL for humans
    agentPausedAt: timestamp("agent_paused_at", { withTimezone: true }), // NULL = running; set = kill-switch engaged
    agentPauseReason: text("agent_pause_reason"), // why an admin paused this agent
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailUq: uniqueIndex("university_members_email_key").on(table.email),
    accountIdx: index("university_members_account_idx").on(table.accountId),
    statusIdx: index("university_members_status_idx").on(table.status),
    foundingIdx: index("university_members_founding_idx").on(table.founding),
    isAgentIdx: index("university_members_is_agent_idx").on(table.isAgent),
  }),
);

export const universitySubscriptions = pgTable(
  "university_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The member this billing record provisions. Nullable so a checkout that
    // races ahead of member creation still records the Stripe row.
    memberId: uuid("member_id").references(() => universityMembers.id),
    // Resolved by the customer-account-linker at checkout time.
    accountId: uuid("account_id"),
    // Captured at checkout. Recipient + member join key fallback.
    email: text("email"),
    // Stable plan key — 'university_monthly' ($50/mo) or 'university_annual'
    // ($500/yr). Set from the checkout metadata.plan at activation.
    plan: text("plan").default("university_monthly"),
    // pending | active | past_due | cancelled
    status: text("status").default("pending"),
    stripeCustomerId: text("stripe_customer_id"),
    // Idempotency key — UNIQUE. A replayed checkout updates this row in place.
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    stripeSubUq: uniqueIndex("university_subscriptions_stripe_sub_uq").on(
      table.stripeSubscriptionId,
    ),
    emailIdx: index("university_subscriptions_email_idx").on(table.email),
    stripeCustIdx: index("university_subscriptions_stripe_cust_idx").on(
      table.stripeCustomerId,
    ),
    statusIdx: index("university_subscriptions_status_idx").on(table.status),
  }),
);

// ---------------------------------------------------------------------------
// University rep-log / progress — the "Practice" half of the learning loop.
//
// A "rep" is one completed practice on a lesson for a given day. Reps are
// idempotent PER (member, lesson, day): re-submitting the same lesson on the
// same day updates the existing row in place rather than logging a duplicate,
// so streak math (counting distinct rep-days) stays honest no matter how many
// times the client POSTs. The day bucket is an explicit `rep_day` DATE column
// (UTC) rather than deriving from created_at — making the day boundary
// deterministic and the unique constraint trivial to express.
//
// The member is identified the same way the rest of University is — by the
// shared customer_accounts login (account_id once the linker has fired) joined
// on the lowercased `email` as the durable fallback. Both are stored on the
// rep so the streak query works before AND after the account link resolves.
// ---------------------------------------------------------------------------

export const universityProgress = pgTable(
  "university_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — set once the customer-account-linker resolves the shared
    // customer_accounts login identity. `email` is the durable join key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The durable join key. Lowercased before insert.
    email: text("email").notNull(),
    lessonSlug: text("lesson_slug").notNull(),
    // A rep always implies the drill was done; column is explicit for future
    // partial-completion states. Defaults true.
    drillDone: boolean("drill_done").notNull().default(true),
    reflection: text("reflection"),
    quizScore: integer("quiz_score"),
    // The day bucket (UTC) this rep counts for. Idempotency + streak math key.
    repDay: date("rep_day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // One rep per member+lesson+day. Re-submitting the same lesson on the same
    // day upserts this row. We key on email (the durable identity) so the
    // constraint holds before the account link resolves; account_id is carried
    // for query convenience but is NOT part of the uniqueness key.
    repUq: uniqueIndex("university_progress_rep_uq").on(
      table.email,
      table.lessonSlug,
      table.repDay,
    ),
    emailIdx: index("university_progress_email_idx").on(table.email),
    accountIdx: index("university_progress_account_idx").on(table.accountId),
    lessonIdx: index("university_progress_lesson_idx").on(table.lessonSlug),
  }),
);

// ---------------------------------------------------------------------------
// University member NOTES — persisted in-lesson "write this down" prompts.
//
// A note is one piece of saved text for a member, a lesson, and a note slot
// (`note_key`). Notes are idempotent PER (member, lesson, note_key):
// re-saving the same slot updates the existing row in place rather than
// appending a duplicate, so an in-lesson note field maps 1:1 to a row.
//
// The member is identified the same way the rest of University is — by the
// shared customer_accounts login (account_id once the linker has fired) joined
// on the lowercased `email` as the durable fallback. Both are stored on the
// note so the lookup works before AND after the account link resolves.
//
// FUTURE: these member notes are the input corpus for a planned "smart pattern
// recognition" feature ported from the Optimize Me / architect app — it will
// analyze members' notes to surface what to work on + best suggestions. Not
// built yet.
// ---------------------------------------------------------------------------

export const universityNotes = pgTable(
  "university_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — set once the customer-account-linker resolves the shared
    // customer_accounts login identity. `email` is the durable join key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The durable join key. Lowercased before insert.
    email: text("email").notNull(),
    lessonSlug: text("lesson_slug").notNull(),
    // The in-lesson note slot — stable per "write this down" field.
    noteKey: text("note_key").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // One note per member+lesson+note_key. Re-saving the same slot upserts this
    // row (ON CONFLICT in the service). We key on email (the durable identity)
    // so the constraint holds before the account link resolves; account_id is
    // carried for query convenience but is NOT part of the uniqueness key.
    noteUq: uniqueIndex("university_notes_note_uq").on(
      table.email,
      table.lessonSlug,
      table.noteKey,
    ),
    emailIdx: index("university_notes_email_idx").on(table.email),
    accountIdx: index("university_notes_account_idx").on(table.accountId),
    lessonIdx: index("university_notes_lesson_idx").on(table.lessonSlug),
  }),
);

// ---------------------------------------------------------------------------
// University CANCEL feedback — the reason a member gives when they cancel.
//
// Purely a feedback log. The actual cancel is a Stripe action (the portal
// save-flow sets cancel_at_period_end=true); this table captures the optional
// free-text "why are you leaving?" so churn reasons survive for later review.
// Not part of entitlement/billing logic — never gates access.
//
// The member is identified the same way the rest of University is — by the
// shared customer_accounts login (account_id once the linker has fired) joined
// on the lowercased `email` as the durable fallback. Both are stored so the
// row is attributable before AND after the account link resolves. Append-only:
// every cancel attempt is its own row (no uniqueness key) so repeated
// cancel→reactivate→cancel cycles all leave a trace.
// ---------------------------------------------------------------------------

export const universityCancelFeedback = pgTable(
  "university_cancel_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — set once the customer-account-linker resolves the shared
    // customer_accounts login identity. `email` is the durable join key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The durable join key. Lowercased before insert.
    email: text("email").notNull(),
    // Optional free-text reason. Nullable — a member can cancel silently.
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailIdx: index("university_cancel_feedback_email_idx").on(table.email),
    accountIdx: index("university_cancel_feedback_account_idx").on(
      table.accountId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// University LIVE SESSIONS — the "Practice together" leg of the Coherent Loop.
//
// A Session is an admin-created, time-boxed live group practice (a scheduled
// sit). It is a GLOBAL/admin object, not owned by any one member — the member
// relationship lives entirely in the RSVP table. `starts_at` is the single
// source of truth for lifecycle (upcoming → live → ended), computed from the
// clock in the service, never stored (no state-drift).
//
// The video call runs on an EXTERNAL room — `join_url` is just an https string
// (Zoom/Meet/Whereby); the schema/code is provider-agnostic. The service NEVER
// returns join_url unless the session is live AND the caller RSVP'd `going`, so
// a recurring room link can't leak.
//
// recurrence_rule / recurrence_group are present-but-NULL at MVP (one-off rows
// only) so the v2 recurrence generator needs no second migration — they are
// inert until v2 materializes concrete rows sharing a recurrence_group.
// ---------------------------------------------------------------------------

export const universitySessions = pgTable(
  "university_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    // Display host (e.g. "Mark"). The host need not be the creator.
    hostName: text("host_name").notNull(),
    // Optional internal contact — not shown to members.
    hostEmail: text("host_email"),
    // The instant the session starts (UTC). timestamptz — never a wall-clock
    // string. Single source of truth for the upcoming/past split, the live
    // window, and the reminder windows.
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    // External video room (Zoom/Meet/Whereby). Provider-agnostic https URL.
    joinUrl: text("join_url").notNull(),
    // Nullable = unlimited. Capacity is enforced in the service at RSVP time.
    capacity: integer("capacity"),
    // Manual recording link (v1). Admin pastes a Zoom Cloud / unlisted-YouTube
    // share URL after the call; members see "Watch recording" on past sessions.
    // NOT sensitive like join_url — exposed in the member view unconditionally.
    recordingUrl: text("recording_url"),
    // scheduled | canceled
    status: text("status").notNull().default("scheduled"),
    // v2 recurrence (NULL at MVP; one-off rows only). iCal RRULE string.
    recurrenceRule: text("recurrence_rule"),
    // v2 — shared id across a generated series.
    recurrenceGroup: uuid("recurrence_group"),
    // The admin account that created the session (audit). Nullable.
    createdByAccount: uuid("created_by_account").references(
      () => customerAccounts.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    startsAtIdx: index("university_sessions_starts_at_idx").on(table.startsAt),
    statusIdx: index("university_sessions_status_idx").on(table.status),
    recurrenceGroupIdx: index("university_sessions_recurrence_group_idx").on(
      table.recurrenceGroup,
    ),
  }),
);

export const universitySessionRsvps = pgTable(
  "university_session_rsvps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => universitySessions.id),
    // Nullable — set once the customer-account-linker resolves the shared
    // customer_accounts login identity. `email` is the durable join key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The durable join key. Lowercased before insert.
    email: text("email").notNull(),
    // going | canceled. Cancel is soft (status flip), never a delete — matches
    // the codebase's append/soft-state style.
    status: text("status").notNull().default("going"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // One RSVP per member+session. Re-RSVPing flips status back to `going` in
    // place (ON CONFLICT in the service). We key on email (the durable
    // identity) so the constraint holds before the account link resolves;
    // account_id is carried for query convenience but is NOT part of the key.
    rsvpUq: uniqueIndex("university_session_rsvps_session_email_uq").on(
      table.sessionId,
      table.email,
    ),
    sessionStatusIdx: index("university_session_rsvps_session_status_idx").on(
      table.sessionId,
      table.status,
    ),
    // Promote-on-cancel needs the OLDEST waitlist row for a session: filter by
    // (session_id, status='waitlist') then order by created_at. Migration 0139.
    sessionStatusCreatedIdx: index(
      "university_session_rsvps_session_status_created_idx",
    ).on(table.sessionId, table.status, table.createdAt),
    emailIdx: index("university_session_rsvps_email_idx").on(table.email),
    accountIdx: index("university_session_rsvps_account_idx").on(
      table.accountId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// University REFERRAL program (credit-only) + the SHARED member credit ledger.
//
// See designs/DESIGN-referral-program.md. Three tables, all following the same
// convention as the rest of University — the durable join key is the lowercased
// `email`; `account_id` fills in once the customer-account-linker resolves the
// shared magic-link login identity. Attribution happens at checkout, where the
// email is known but the account may not be, so email must carry the identity.
//
//   universityReferralCodes  — one code per member (UNIQUE code + UNIQUE email).
//   universityReferrals      — the attribution record, one per referred member.
//                              UNIQUE(referred_email) is the first-touch lock.
//   universityCreditLedger   — the ONE shared, append-only, signed ledger. BOTH
//                              referral AND (future) repost-for-credit write
//                              here, so a single balance + single floor check
//                              makes it impossible to double-discount past the
//                              floor. Balance = SUM(amount_cents) WHERE email=?.
//                              Never UPDATE/DELETE a row; corrections are new
//                              signed rows. Idempotency key is
//                              (source, source_ref_id, stripe_invoice_id, kind).
//
// Money is integer cents. Mirrors migration 0128_university_referrals.sql.
// ---------------------------------------------------------------------------

export const universityReferralCodes = pgTable(
  "university_referral_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — set once the customer-account-linker resolves the login
    // identity. `email` is the durable owner key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The durable owner key. Lowercased before insert. Unique across members.
    email: text("email").notNull(),
    // Short, URL-safe attribution token (Crockford base32). Globally unique.
    code: text("code").notNull(),
    // active | disabled
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    codeUq: uniqueIndex("university_referral_codes_code_key").on(table.code),
    emailUq: uniqueIndex("university_referral_codes_email_key").on(table.email),
    accountIdx: index("university_referral_codes_account_idx").on(
      table.accountId,
    ),
  }),
);

export const universityReferrals = pgTable(
  "university_referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The code used at checkout.
    referrerCode: text("referrer_code").notNull(),
    // Denormalized owner email (lowercased) — the durable referrer identity.
    referrerEmail: text("referrer_email").notNull(),
    // Filled when known.
    referrerAccountId: uuid("referrer_account_id"),
    // The new member's email (lowercased).
    referredEmail: text("referred_email").notNull(),
    // Filled by the webhook once the member/subscription rows exist.
    referredMemberId: uuid("referred_member_id").references(
      () => universityMembers.id,
    ),
    referredSubscriptionId: uuid("referred_subscription_id").references(
      () => universitySubscriptions.id,
    ),
    // The referred member's Stripe sub — the join key for invoice.paid.
    stripeSubscriptionId: text("stripe_subscription_id"),
    // pending | active | churned | reversed | self_referral_blocked
    status: text("status").notNull().default("pending"),
    // First-touch lock time.
    attributedAt: timestamp("attributed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // First successful paid invoice.
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    // When the reward stream stopped.
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // The attribution lock: a member can only ever be referred ONCE.
    referredEmailUq: uniqueIndex(
      "university_referrals_referred_email_key",
    ).on(table.referredEmail),
    referrerStatusIdx: index("university_referrals_referrer_status_idx").on(
      table.referrerEmail,
      table.status,
    ),
    stripeSubIdx: index("university_referrals_stripe_sub_idx").on(
      table.stripeSubscriptionId,
    ),
    referredMemberIdx: index("university_referrals_referred_member_idx").on(
      table.referredMemberId,
    ),
  }),
);

export const universityCreditLedger = pgTable(
  "university_credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — set once the login identity resolves. `email` is the key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The durable key. Lowercased before insert.
    email: text("email").notNull(),
    // Signed: +earned, -applied. Integer cents.
    amountCents: integer("amount_cents").notNull(),
    // referral_earned | referral_reversed | repost_earned | credit_applied | admin_adjust
    kind: text("kind").notNull(),
    // referral | repost | admin
    source: text("source").notNull(),
    // FK-by-convention to the source row (university_referrals.id for referral).
    sourceRefId: uuid("source_ref_id"),
    // Set on credit_applied / *_earned / reversed rows.
    stripeInvoiceId: text("stripe_invoice_id"),
    // Human note (refund, dispute, etc.).
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Idempotency: never double-credit one source-row for one invoice + kind.
    idemUq: uniqueIndex("university_credit_ledger_idem_uq").on(
      table.source,
      table.sourceRefId,
      table.stripeInvoiceId,
      table.kind,
    ),
    emailIdx: index("university_credit_ledger_email_idx").on(table.email),
    accountIdx: index("university_credit_ledger_account_idx").on(
      table.accountId,
    ),
    invoiceIdx: index("university_credit_ledger_invoice_idx").on(
      table.stripeInvoiceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// University VOICE BUDGET — Rex realtime-voice monthly seconds cap.
//
// Meters Rex realtime voice usage against a per-member monthly seconds budget
// (Phase 1: free 3600 s/mo, calendar-month reset). Deliberately mirrors the
// intel usage meter (schema/intel_billing.ts intel_usage_meter): a per-period
// counter keyed UNIQUE(member_id, period_start) where period_start is the
// first-of-month DATE (UTC 'YYYY-MM-01'), incremented via an atomic ON CONFLICT
// UPSERT in the service (services/voice-budget.ts).
//
// Reserve-then-reconcile (anti-freeride): each session mints a reservation that
// DEBITS the meter up front (seconds_used += granted); on session close the
// unused portion is CREDITED back (seconds_used -= refund, never < 0) and the
// reservation is marked settled. A client that lies or never reports still eats
// the full grant. The `status` CHECK keeps the two-state lifecycle honest.
//
// The member is identified via the shared customer_accounts login the same way
// the rest of University is — see services/voice-budget.ts resolveVoiceMemberId
// (LOWER(email)=… OR account_id=…, newest active row).
// ---------------------------------------------------------------------------

export const universityVoiceMeter = pgTable(
  "university_voice_meter",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").notNull(),
    // First-of-month (UTC) bucket. 'YYYY-MM-01'. Mirrors intel_usage_meter.
    periodStart: date("period_start").notNull(),
    // Whole-session wall-clock seconds debited this period. bigint for headroom.
    secondsUsed: bigint("seconds_used", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // One meter row per member+period. The atomic UPSERT conflict target.
    memberPeriodUq: uniqueIndex("university_voice_meter_member_period_uq").on(
      table.memberId,
      table.periodStart,
    ),
  }),
);

export const universityVoiceReservations = pgTable(
  "university_voice_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").notNull(),
    // The period this reservation debited — refunds credit back to THIS period
    // even if settle happens after a month rollover.
    periodStart: date("period_start").notNull(),
    // Seconds granted (debited) at reserve time. Immutable once set.
    grantedSeconds: integer("granted_seconds").notNull(),
    // Clamped actual seconds reported at settle. NULL while open.
    actualSeconds: integer("actual_seconds"),
    // open | settled. Guards idempotent settle (only an `open` row refunds).
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => ({
    memberPeriodIdx: index(
      "university_voice_reservations_member_period_idx",
    ).on(table.memberId, table.periodStart),
    statusCk: check(
      "university_voice_reservations_status_ck",
      sql`${table.status} IN ('open', 'settled')`,
    ),
  }),
);

export const universityEmailLog = pgTable(
  "university_email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Lowercased recipient — the durable join key, matching the rest of University.
    email: text("email").notNull(),
    // The CreditscoreEmailKind that was sent (e.g. 'university_streak_nudge').
    kind: text("kind").notNull(),
    // ESP (Brevo) messageId returned by the storefront send route at send time.
    // Joins engagement events (university_email_events.message_id) back to the
    // exact send. Nullable: the storefront may respond without an id.
    messageId: text("message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Frequency-cap / dedup lookups: "was (email, kind) sent since <cutoff>?".
    // sent_at DESC so the most-recent send is the leading row per (email, kind).
    emailKindSentIdx: index("university_email_log_email_kind_sent_idx").on(
      table.email,
      table.kind,
      table.sentAt.desc(),
    ),
  }),
);

export const universityEmailEvents = pgTable(
  "university_email_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // ESP messageId — joins to university_email_log.message_id. Nullable: some
    // events arrive without one (or the send predates message-id capture).
    messageId: text("message_id"),
    // Lowercased recipient — the durable join key, matching the rest of University.
    email: text("email").notNull(),
    // Campaign kind from the first Brevo tag starting with 'university_', else NULL.
    kind: text("kind"),
    // delivered | opened | clicked | bounced | spam | unsubscribed | blocked | other.
    event: text("event").notNull(),
    // Clicked link (clicked events only).
    url: text("url"),
    // ESP event time (Brevo's `at`).
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Exact-repeat dedupe for webhook retries (ON CONFLICT DO NOTHING target).
    // Leading message_id column doubles as the per-message lookup index.
    dedupeUq: uniqueIndex("university_email_events_dedupe_uq").on(
      table.messageId,
      table.event,
      table.occurredAt,
    ),
    // Stats rollup: "per kind, distinct emails per event".
    kindEventIdx: index("university_email_events_kind_event_idx").on(
      table.kind,
      table.event,
    ),
  }),
);

export type UniversityMember = typeof universityMembers.$inferSelect;
export type NewUniversityMember = typeof universityMembers.$inferInsert;
export type UniversitySubscription =
  typeof universitySubscriptions.$inferSelect;
export type NewUniversitySubscription =
  typeof universitySubscriptions.$inferInsert;
export type UniversityProgress = typeof universityProgress.$inferSelect;
export type NewUniversityProgress = typeof universityProgress.$inferInsert;
export type UniversityNote = typeof universityNotes.$inferSelect;
export type NewUniversityNote = typeof universityNotes.$inferInsert;
export type UniversityCancelFeedback =
  typeof universityCancelFeedback.$inferSelect;
export type NewUniversityCancelFeedback =
  typeof universityCancelFeedback.$inferInsert;
export type UniversitySession = typeof universitySessions.$inferSelect;
export type NewUniversitySession = typeof universitySessions.$inferInsert;
export type UniversitySessionRsvp = typeof universitySessionRsvps.$inferSelect;
export type NewUniversitySessionRsvp =
  typeof universitySessionRsvps.$inferInsert;
export type UniversityReferralCode =
  typeof universityReferralCodes.$inferSelect;
export type NewUniversityReferralCode =
  typeof universityReferralCodes.$inferInsert;
export type UniversityReferral = typeof universityReferrals.$inferSelect;
export type NewUniversityReferral = typeof universityReferrals.$inferInsert;
export type UniversityCreditLedgerRow =
  typeof universityCreditLedger.$inferSelect;
export type NewUniversityCreditLedgerRow =
  typeof universityCreditLedger.$inferInsert;
export type UniversityVoiceMeter = typeof universityVoiceMeter.$inferSelect;
export type NewUniversityVoiceMeter = typeof universityVoiceMeter.$inferInsert;
export type UniversityVoiceReservation =
  typeof universityVoiceReservations.$inferSelect;
export type NewUniversityVoiceReservation =
  typeof universityVoiceReservations.$inferInsert;
export type UniversityEmailLog = typeof universityEmailLog.$inferSelect;
export type NewUniversityEmailLog = typeof universityEmailLog.$inferInsert;
export type UniversityEmailEvent = typeof universityEmailEvents.$inferSelect;
export type NewUniversityEmailEvent = typeof universityEmailEvents.$inferInsert;
