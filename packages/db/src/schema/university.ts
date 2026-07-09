import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  date,
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
    // Plan key. 'university_monthly' (founding, $50) | 'university_monthly_standard'
    // ($79). Reflects the member's CURRENT tier.
    plan: text("plan").notNull().default("university_monthly"),
    // Was this member ever granted the founding ($50) rate? Set true at the
    // webhook when they check out on the founding price. MONOTONIC — never unset,
    // so a cancelled founder still "spends" a seat and the public price never
    // flip-flops back to $50. COUNT(*) WHERE is_founding drives the $50→$79 switch.
    isFounding: boolean("is_founding").notNull().default(false),
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
    // Backs the checkout count query. The migration declares this partial
    // (WHERE is_founding); the query model just needs the column indexed.
    foundingIdx: index("university_members_founding_idx").on(table.isFounding),
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
    // Plan key. 'university_monthly' (founding, $50) | 'university_monthly_standard' ($79).
    plan: text("plan").default("university_monthly"),
    // pending | active | past_due | cancelled
    status: text("status").default("pending"),
    // What this subscription actually bills, captured at the webhook. The
    // Stripe Price object is the true source, but recording it here makes the
    // row self-describing (audit + referral-credit headroom + current-rate
    // display) and is how we know a member is a founder (founding price == $50).
    stripePriceId: text("stripe_price_id"),
    unitAmountCents: integer("unit_amount_cents"),
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
// Money is integer cents. Mirrors migration 0125_university_referrals.sql.
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
