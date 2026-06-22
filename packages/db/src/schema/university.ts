import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  date,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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
    // Stable plan key — currently single-tier 'university_monthly'.
    plan: text("plan").notNull().default("university_monthly"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
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
    // Stable plan key — currently single-tier 'university_monthly'.
    plan: text("plan").default("university_monthly"),
    // pending | active | past_due | cancelled
    status: text("status").default("pending"),
    stripeCustomerId: text("stripe_customer_id"),
    // Idempotency key — UNIQUE. A replayed checkout updates this row in place.
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    // Ad-attribution: campaign stamped from checkout metadata (utm_campaign /
    // utm_source) so RENEWAL events stay attributed to the originating campaign.
    // Written by the ad-attribution webhook hook, NOT the shared checkout
    // handler. Nullable — older rows and organic checkouts have none.
    utmCampaign: text("utm_campaign"),
    utmSource: text("utm_source"),
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
// University ad-attribution — durable per-lead ad/marketing attribution.
//
// One row per lead, keyed on the lowercased `email` (the same durable identity
// the rest of University uses). Click ids (fbclid/fbc/fbp/ttclid/gclid) + UTM
// params + landing/referrer context are captured at checkout (carried in Stripe
// Checkout Session METADATA — never client_reference_id, which the referral
// branch owns) and upserted here ON CONFLICT (email).
//
// First-touch is IMMUTABLE: `first_touch_at` is stamped on the first insert and
// never overwritten; `last_touch_at` is refreshed on every touch, and any
// newly-present click ids / stripe ids are filled in. At checkout completion the
// Stripe customer + subscription are stamped so renewals stay attributed.
//
// The webhook firing CAPI/TikTok events is de-duplicated by a SEPARATE small
// events table keyed UNIQUE on the Stripe `event.id` (see
// university_attribution_events in the 0127 migration) — that is the replay
// guard, not this table.
// ---------------------------------------------------------------------------

export const universityAttribution = pgTable(
  "university_attribution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — set once the customer-account-linker resolves the shared
    // customer_accounts login identity. `email` is the durable join key.
    accountId: uuid("account_id").references(() => customerAccounts.id),
    // The durable join key. Lowercased before insert — one attribution row per
    // lead (UNIQUE).
    email: text("email").notNull(),
    // Click ids.
    fbclid: text("fbclid"),
    fbc: text("fbc"),
    fbp: text("fbp"),
    ttclid: text("ttclid"),
    gclid: text("gclid"),
    // UTM params.
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    // Landing context.
    landingUrl: text("landing_url"),
    referrer: text("referrer"),
    // First-touch is immutable; last-touch refreshes on every touch.
    firstTouchAt: timestamp("first_touch_at", { withTimezone: true }),
    lastTouchAt: timestamp("last_touch_at", { withTimezone: true }),
    // Stamped at checkout completion so renewals stay attributed.
    stripeCustomerId: text("stripe_customer_id"),
    // Links to the billing row; nullable (checkout may race ahead of the sub).
    subscriptionId: uuid("subscription_id").references(
      () => universitySubscriptions.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // One attribution row per lead. An upsert keys on the durable email
    // identity (ON CONFLICT in the service) so it holds before the account link
    // resolves; account_id is carried for query convenience, NOT the key.
    emailUq: uniqueIndex("university_attribution_email_key").on(table.email),
    stripeCustIdx: index("university_attribution_stripe_cust_idx").on(
      table.stripeCustomerId,
    ),
    subscriptionIdx: index("university_attribution_subscription_idx").on(
      table.subscriptionId,
    ),
    accountIdx: index("university_attribution_account_idx").on(table.accountId),
  }),
);

// ---------------------------------------------------------------------------
// University attribution EVENTS — idempotency / replay guard for the webhook
// side-effects (Meta CAPI + TikTok Events firing). Stripe redelivers the same
// `event.id` on retries; an `INSERT ... ON CONFLICT (stripe_event_id) DO
// NOTHING` that affects 0 rows means the event was already processed → the
// webhook returns early so CAPI/TikTok never double-fire.
// ---------------------------------------------------------------------------

export const universityAttributionEvents = pgTable(
  "university_attribution_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The Stripe event id — the natural idempotency / replay key (UNIQUE).
    stripeEventId: text("stripe_event_id").notNull(),
    eventType: text("event_type").notNull(),
    email: text("email"),
    stripeCustomerId: text("stripe_customer_id"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    stripeEventUq: uniqueIndex(
      "university_attribution_events_stripe_event_key",
    ).on(table.stripeEventId),
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
export type UniversityAttribution =
  typeof universityAttribution.$inferSelect;
export type NewUniversityAttribution =
  typeof universityAttribution.$inferInsert;
export type UniversityAttributionEvent =
  typeof universityAttributionEvents.$inferSelect;
export type NewUniversityAttributionEvent =
  typeof universityAttributionEvents.$inferInsert;
