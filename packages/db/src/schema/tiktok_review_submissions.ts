import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";

// Queue of submitted TikTok @-handles awaiting review by Rizz.
//
// Lifecycle (formStatus):
//   mentioned             → discovered via @-mention in a comment; no form yet (form_id is null)
//   pending_verification → submitter has filled out the consent form, awaiting email-confirmation reply
//   verified              → submitter replied YES to verification email
//   countersigned         → owner has countersigned and assigned a Form ID
//   rejected              → owner rejected the submission (reason in notesInternal)
//   withdrawn             → submitter withdrew before publication
//
// Lifecycle (pipelineStatus, only progresses while formStatus == 'countersigned'):
//   queued      → ready for the audit-pipeline to pick up
//   scraping    → tiktok_audits row being built
//   drafting    → 3-tier brain router producing the script
//   gated       → draft awaiting human approval via approvals service
//   approved    → owner approved, ready to render
//   rendering   → TTS + Hedra + video-assembler in progress
//   published   → final video posted to TikTok (and optionally cross-posted)
//   takedown_requested  → submitter has requested removal post-publish
//   takedown_completed  → video taken down, retention log updated

export const tiktokReviewSubmissions = pgTable(
  "tiktok_review_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    brand: text("brand").notNull().default("rizz"),

    // Submitter identity
    submitterEmail: text("submitter_email").notNull(),
    submitterHandle: text("submitter_handle").notNull(),
    additionalHandles: jsonb("additional_handles").$type<string[]>(),
    countryOfResidence: text("country_of_residence"),
    dateOfBirth: text("date_of_birth"),

    // Consent form gate. Null when row was created from a raw @-mention
    // (formStatus = 'mentioned'); set once the submitter fills out the form.
    formId: text("form_id"),
    // 'mentioned' | 'pending_verification' | 'verified' | 'countersigned' | 'rejected' | 'withdrawn'
    formStatus: text("form_status").notNull().default("pending_verification"),
    consentVerifiedAt: timestamp("consent_verified_at", { withTimezone: true }),
    countersignedAt: timestamp("countersigned_at", { withTimezone: true }),

    // Pipeline state
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    // 'queued' | 'scraping' | 'drafting' | 'gated' | 'approved' | 'rendering' | 'published'
    //   | 'takedown_requested' | 'takedown_completed'
    pipelineStatus: text("pipeline_status").notNull().default("queued"),

    // Takedown tracking
    takedownRequestedAt: timestamp("takedown_requested_at", { withTimezone: true }),

    // Published-URL tracking
    publishedTiktokUrl: text("published_tiktok_url"),
    publishedIgUrl: text("published_ig_url"),
    publishedYoutubeUrl: text("published_youtube_url"),

    // Internal owner-only notes (not exposed to submitter)
    notesInternal: text("notes_internal"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyQueuedIdx: index("tiktok_review_submissions_company_queued_idx").on(
      table.companyId,
      table.queuedAt,
    ),
    companyFormStatusIdx: index("tiktok_review_submissions_company_form_status_idx").on(
      table.companyId,
      table.formStatus,
    ),
    companyPipelineStatusIdx: index("tiktok_review_submissions_company_pipeline_status_idx").on(
      table.companyId,
      table.pipelineStatus,
    ),
    formIdIdx: index("tiktok_review_submissions_form_id_idx").on(table.formId),
    companyHandleUniq: uniqueIndex("tiktok_review_submissions_company_handle_uniq").on(
      table.companyId,
      sql`lower(${table.submitterHandle})`,
    ),
  }),
);

export type TiktokReviewSubmission = typeof tiktokReviewSubmissions.$inferSelect;
export type NewTiktokReviewSubmission = typeof tiktokReviewSubmissions.$inferInsert;
