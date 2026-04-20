import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { affiliates, partnerCompanies, referralAttribution } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { sendTransactional } from "./email-templates.js";

export function startAffiliateCrons(db: Db): void {
  registerCronJob({
    jobName: "affiliate:pending-digest",
    schedule: "0 10 * * 1", // Monday 10 AM
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      const pending = await db
        .select({
          id: affiliates.id,
          name: affiliates.name,
          email: affiliates.email,
        })
        .from(affiliates)
        .where(eq(affiliates.status, "pending"));

      if (pending.length === 0) return { sent: 0 };

      const supportEmail =
        process.env.AFFILIATE_SUPPORT_EMAIL ?? process.env.SMTP_USER ?? "affiliates@coherencedaddy.com";

      for (const affiliate of pending) {
        await sendTransactional("affiliate-pending-digest", affiliate.email, {
          recipientName: affiliate.name,
          recipientEmail: affiliate.email,
          affiliateName: affiliate.name,
          supportEmail,
        }).catch(() => {});
      }

      return { sent: pending.length };
    },
  });

  registerCronJob({
    jobName: "affiliate:lock-expiry",
    schedule: "0 3 * * *", // Daily 3 AM UTC
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      // Release expired attribution locks whose associated lead has NOT converted.
      // Conversion signal: partner_companies.is_paying = true → lock stays (referrer of record).
      // Single-statement UPDATE with an EXISTS subquery that requires is_paying = false.
      const now = new Date();
      const released = await db
        .update(referralAttribution)
        .set({ lockReleasedAt: now, updatedAt: now })
        .where(
          and(
            isNull(referralAttribution.lockReleasedAt),
            lt(referralAttribution.lockExpiresAt, sql`NOW()`),
            sql`EXISTS (
              SELECT 1 FROM ${partnerCompanies}
              WHERE ${partnerCompanies.id} = ${referralAttribution.leadId}
                AND ${partnerCompanies.isPaying} = false
            )`,
          ),
        )
        .returning({ id: referralAttribution.id });

      return { released: released.length };
    },
  });
}
