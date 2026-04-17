import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { affiliates } from "@paperclipai/db";
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
}
