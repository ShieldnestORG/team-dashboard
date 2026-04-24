import { createDb } from "@paperclipai/db";
import { runPartnerOnboarding } from "../src/services/partner-onboarding.js";

const SLUGS = [
  "sacred-wild",
  "artisan-metal-works",
  "tokns",
  "mark-joseph-jr-co",
  "house-of-exegesis",
  "exegesis-ventures",
  "get-probed",
];

const db = createDb(process.env.DATABASE_URL!);

for (const slug of SLUGS) {
  console.log(`\n[${slug}] retrying onboarding…`);
  try {
    await runPartnerOnboarding(db, slug);
    console.log(`[${slug}] returned`);
  } catch (err) {
    console.error(`[${slug}] threw:`, (err as Error).message);
  }
}

console.log("\nAll retries dispatched.");
process.exit(0);
