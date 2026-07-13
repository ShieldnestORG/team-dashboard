/**
 * seed-synthetic-university.ts
 * ---------------------------------------------------------------------------
 * LOCAL DEMO ONLY. Seeds 15 clearly-synthetic Coherent Ones University members
 * + community activity into the LOCAL throwaway Postgres so the real portal UI
 * renders populated.
 *
 * HARD GUARD: refuses to run unless DATABASE_URL points at 127.0.0.1 / localhost.
 * NEVER point this at Neon / production.
 *
 * Run:  cd /Users/exe/Downloads/Claude/_wt/uni-local-demo
 *       node --env-file=.env node_modules/.bin/tsx scripts/seed-synthetic-university.ts
 *   or  pnpm tsx scripts/seed-synthetic-university.ts   (with DATABASE_URL exported)
 *
 * Idempotent: deletes all %@synthetic.local rows first, then re-inserts.
 *
 * Exact literals taken from the real code (not guessed):
 *   - member/sub status set: 'pending'|'active'|'past_due'|'cancelled'
 *     (CHECK constraint on university_members.status / university_subscriptions.status)
 *   - plan literal: 'university_monthly'
 *     (server/src/services/university-stripe-handler.ts)
 *   - community visible status: 'visible'
 *     (server/src/services/customer-portal.ts getCommunityFeed)
 *   - entitlement gate (isUniversityAccount) ignores status; /me surfaces
 *     active|past_due (getAccountWithEntitlements).
 */

// Resolve the `postgres` (postgres.js) driver — the same driver the live
// backend uses. This script lives in repo-root scripts/, but `postgres` is a
// (transitive) workspace dependency hoisted under .pnpm. We resolve it via
// createRequire against the @paperclipai/db package (which depends on it
// directly) rather than a bare import — Node ESM resolves bare imports
// relative to THIS file's dir and can't find it there.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromDb = createRequire(
  join(__dirname, "..", "packages", "db", "package.json"),
);
const postgres = requireFromDb("postgres") as typeof import("postgres").default;

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("FATAL: DATABASE_URL is not set.");
  process.exit(1);
}

// ---- HARD LOCAL GUARD ------------------------------------------------------
// Parse the host out of the connection string and refuse anything that is not
// a loopback address. This is the safety interlock for the whole script.
function hostOf(connStr: string): string {
  try {
    // postgres URLs: postgresql://user:pass@HOST:port/db
    const u = new URL(connStr);
    return u.hostname.toLowerCase();
  } catch {
    // Fallback: regex the @host: segment.
    const m = connStr.match(/@([^/:]+)[:/]/);
    return (m?.[1] ?? "").toLowerCase();
  }
}
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const host = hostOf(url);
if (!ALLOWED_HOSTS.has(host)) {
  console.error(
    `FATAL: refusing to run against non-local host '${host}'. ` +
      `This seed is LOCAL-ONLY. Allowed: ${[...ALLOWED_HOSTS].join(", ")}.`,
  );
  process.exit(1);
}
// Belt-and-suspenders: also reject any obvious managed-PG hostname even if it
// somehow slipped past the loopback check.
if (/neon|amazonaws|supabase|render|railway|\.tech|\.cloud/i.test(url)) {
  console.error("FATAL: connection string looks like a managed/prod host. Aborting.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

// ---- Synthetic cohort ------------------------------------------------------
// 15 members. status mix: 11 active, 2 past_due, 2 cancelled.
// joined_at spread over ~6 months (anchored to "now" at run time).
type Status = "active" | "past_due" | "cancelled";
interface Member {
  email: string;
  name: string;
  status: Status;
  joinedDaysAgo: number;
}

const MEMBERS: Member[] = [
  { email: "maya@synthetic.local", name: "Maya Okafor", status: "active", joinedDaysAgo: 182 },
  { email: "devin@synthetic.local", name: "Devin Reyes", status: "active", joinedDaysAgo: 168 },
  { email: "priya@synthetic.local", name: "Priya Nair", status: "active", joinedDaysAgo: 151 },
  { email: "jonah@synthetic.local", name: "Jonah Albright", status: "active", joinedDaysAgo: 140 },
  { email: "sofia@synthetic.local", name: "Sofia Mendes", status: "active", joinedDaysAgo: 122 },
  { email: "amara@synthetic.local", name: "Amara Cole", status: "active", joinedDaysAgo: 109 },
  { email: "leo@synthetic.local", name: "Leo Bianchi", status: "active", joinedDaysAgo: 95 },
  { email: "hana@synthetic.local", name: "Hana Sato", status: "active", joinedDaysAgo: 81 },
  { email: "marcus@synthetic.local", name: "Marcus Webb", status: "active", joinedDaysAgo: 64 },
  { email: "elena@synthetic.local", name: "Elena Vasquez", status: "active", joinedDaysAgo: 47 },
  { email: "tariq@synthetic.local", name: "Tariq Hassan", status: "active", joinedDaysAgo: 23 },
  // past_due — still inside the walls (community gate ignores status)
  { email: "nadia@synthetic.local", name: "Nadia Brooks", status: "past_due", joinedDaysAgo: 133 },
  { email: "owen@synthetic.local", name: "Owen Park", status: "past_due", joinedDaysAgo: 58 },
  // cancelled — entity persists; /me hides them but they still authored history
  { email: "rosa@synthetic.local", name: "Rosa Delgado", status: "cancelled", joinedDaysAgo: 160 },
  { email: "kai@synthetic.local", name: "Kai Thompson", status: "cancelled", joinedDaysAgo: 74 },
];

// Community posts — on-voice for a presence / coherence daily-practice
// community. Natural, varied, not cringe. (author email, body)
const POSTS: Array<{ email: string; body: string; daysAgo: number }> = [
  { email: "maya@synthetic.local", body: "Day 30 of the morning practice. The thing that finally clicked: I don't have to feel coherent to start. I just sit, and coherence shows up about four minutes in. Stop waiting to feel ready.", daysAgo: 9 },
  { email: "devin@synthetic.local", body: "Caught myself spiraling before a hard conversation today. Did the two-breath reset from week 2 in the parking lot. Walked in regulated instead of reactive. Small tool, big difference.", daysAgo: 8 },
  { email: "priya@synthetic.local", body: "Question for the room: how do you all hold the practice on travel days? My whole rhythm fell apart in airports this week and I'm trying not to make it mean anything.", daysAgo: 8 },
  { email: "amara@synthetic.local", body: "Replying to the travel question — I shrink it. 90 seconds of breath at the gate counts. The streak isn't about duration, it's about not abandoning yourself on the hard days.", daysAgo: 7 },
  { email: "leo@synthetic.local", body: "Three weeks in and the biggest shift isn't calm, it's noticing. I catch the contraction now instead of living inside it for an hour. That gap between stimulus and reaction is real and it's getting wider.", daysAgo: 7 },
  { email: "hana@synthetic.local", body: "Logged my rep before coffee for the first time ever. Usually I let the day grab me first. Putting myself before the inbox felt almost rebellious.", daysAgo: 6 },
  { email: "jonah@synthetic.local", body: "Honest check-in: missed three days and almost quit out of shame. Came back anyway. The lesson on self-compassion as a skill, not a mood, is the only reason I'm still here.", daysAgo: 6 },
  { email: "sofia@synthetic.local", body: "The body-scan before bed has done more for my sleep than any app I've tried. I'm not 'trying to relax' anymore, I'm just listening to where I'm holding. It lets go on its own.", daysAgo: 5 },
  { email: "marcus@synthetic.local", body: "Used the grounding sequence mid-argument with my brother. Didn't fix the argument, but I stayed me through it. That used to be impossible. Progress isn't always peace — sometimes it's presence under pressure.", daysAgo: 5 },
  { email: "nadia@synthetic.local", body: "Week 6 reflection: I came here to fix my anxiety. What's actually happening is I'm learning to be with it without being run by it. Different project entirely, better one.", daysAgo: 4 },
  { email: "elena@synthetic.local", body: "Started keeping the coherence journal next to my bed. Reading last month's entries back, I genuinely don't recognize how reactive I was. You don't notice the drift until you see the record.", daysAgo: 4 },
  { email: "tariq@synthetic.local", body: "New here — day 4. Already noticing how often I hold my breath at my desk. Just becoming aware of it has changed something. Grateful this community exists.", daysAgo: 3 },
  { email: "owen@synthetic.local", body: "The reframe from this week's lesson — 'I'm not behind, I'm exactly where the practice meets me' — I wrote it on a sticky note. Needed to hear it more than I wanted to admit.", daysAgo: 3 },
  { email: "priya@synthetic.local", body: "Update from the travel-chaos poster: did 90 seconds at every gate like Amara said. Got home and my baseline was still intact. The practice travels if you let it be small. Thank you all.", daysAgo: 2 },
  { email: "maya@synthetic.local", body: "Something nobody tells you: the people in your life feel the regulation before they understand it. My partner asked what changed. I didn't have words, just a longer fuse and a quieter chest.", daysAgo: 2 },
  { email: "leo@synthetic.local", body: "Resonating with everyone posting about noticing vs fixing. That's the whole thing, isn't it. We're not building a calmer self, we're building a more honest relationship with the self that's already here.", daysAgo: 1 },
  { email: "hana@synthetic.local", body: "Hit a 21-day streak today. Not flexing — flagging it because three months ago I couldn't keep any commitment to myself for more than a weekend. The reps rebuild trust with yourself first.", daysAgo: 1 },
  { email: "devin@synthetic.local", body: "Quiet win: a meeting blew up today and I felt the old heat rise — and then it just... passed through. Didn't grab it, didn't feed it. Watched it go. That's months of reps showing up exactly when I needed them.", daysAgo: 0 },
];

async function main() {
  console.log(`Connected to local DB host '${host}'. Seeding...`);

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  // ---- Idempotent cleanup (children first) --------------------------------
  await sql.begin(async (tx) => {
    // Community children that reference posts/comments by author email.
    await tx`DELETE FROM university_community_reactions WHERE reactor_email LIKE '%@synthetic.local'`;
    await tx`DELETE FROM university_community_reports   WHERE reporter_email LIKE '%@synthetic.local'`;
    await tx`DELETE FROM university_community_comments  WHERE author_email   LIKE '%@synthetic.local'`;
    await tx`DELETE FROM university_community_posts     WHERE author_email   LIKE '%@synthetic.local'`;
    await tx`DELETE FROM university_subscriptions       WHERE email          LIKE '%@synthetic.local'`;
    await tx`DELETE FROM university_members             WHERE email          LIKE '%@synthetic.local'`;
    await tx`DELETE FROM customer_magic_links           WHERE email::text     LIKE '%@synthetic.local'`;
    await tx`DELETE FROM customer_accounts              WHERE email::text     LIKE '%@synthetic.local'`;
  });
  console.log("Cleared prior %@synthetic.local rows.");

  // ---- Insert ------------------------------------------------------------
  await sql.begin(async (tx) => {
    for (const m of MEMBERS) {
      const joinedAt = daysAgo(m.joinedDaysAgo);

      // 1) customer_accounts (the portal identity row)
      const [acct] = await tx`
        INSERT INTO customer_accounts (email, created_at, last_login_at)
        VALUES (${m.email}, ${joinedAt}, ${m.status === "cancelled" ? daysAgo(m.joinedDaysAgo - 5) : daysAgo(Math.max(0, m.joinedDaysAgo - 30))})
        RETURNING id
      `;
      const accountId = acct.id as string;

      // 2) university_members (the member entity)
      const [mem] = await tx`
        INSERT INTO university_members
          (account_id, email, display_name, status, plan, joined_at, created_at, updated_at)
        VALUES
          (${accountId}, ${m.email}, ${m.name}, ${m.status}, 'university_monthly',
           ${joinedAt}, ${joinedAt}, ${now})
        RETURNING id
      `;
      const memberId = mem.id as string;

      // 3) university_subscriptions — one per member, status mirrors the member.
      //    Stripe ids are obviously-fake. Period window is a sensible monthly cycle.
      //    active   → period currently open
      //    past_due → period open but payment failing
      //    cancelled→ period closed, canceled_at set
      const suffix = m.email.split("@")[0];
      const periodStart =
        m.status === "cancelled" ? daysAgo(m.joinedDaysAgo - 25) : daysAgo(12);
      const periodEnd =
        m.status === "cancelled" ? daysAgo(m.joinedDaysAgo - 55) : daysAgo(-18); // ~18d in future
      const canceledAt = m.status === "cancelled" ? daysAgo(m.joinedDaysAgo - 55) : null;

      await tx`
        INSERT INTO university_subscriptions
          (member_id, account_id, email, plan, status,
           stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id,
           current_period_start, current_period_end, canceled_at, created_at, updated_at)
        VALUES
          (${memberId}, ${accountId}, ${m.email}, 'university_monthly', ${m.status},
           ${"cus_SYNTH_" + suffix}, ${"sub_SYNTH_" + suffix}, ${"cs_test_SYNTH_" + suffix},
           ${periodStart}, ${periodEnd}, ${canceledAt}, ${joinedAt}, ${now})
      `;
    }

    // 4) Community posts (status='visible'). account_id resolved from the
    //    member's customer_accounts row so the feed renders the author label.
    for (const p of POSTS) {
      const [acct] = await tx`
        SELECT id FROM customer_accounts WHERE email = ${p.email} LIMIT 1
      `;
      const createdAt = daysAgo(p.daysAgo);
      // light, natural denormalized counts so cards aren't all zeros
      const reactionCount = Math.floor(Math.random() * 9) + 1; // 1..9
      const commentCount = Math.floor(Math.random() * 4); // 0..3
      await tx`
        INSERT INTO university_community_posts
          (account_id, author_email, body, comment_count, reaction_count, status, created_at, updated_at)
        VALUES
          (${acct?.id ?? null}, ${p.email}, ${p.body}, ${commentCount}, ${reactionCount},
           'visible', ${createdAt}, ${createdAt})
      `;
    }
  });

  // ---- Verify ------------------------------------------------------------
  const [counts] = await sql`
    SELECT
      (SELECT count(*) FROM customer_accounts        WHERE email::text LIKE '%@synthetic.local')                 AS accounts,
      (SELECT count(*) FROM university_members        WHERE email LIKE '%@synthetic.local')                       AS members,
      (SELECT count(*) FROM university_members        WHERE email LIKE '%@synthetic.local' AND status='active')   AS members_active,
      (SELECT count(*) FROM university_members        WHERE email LIKE '%@synthetic.local' AND status='past_due') AS members_past_due,
      (SELECT count(*) FROM university_members        WHERE email LIKE '%@synthetic.local' AND status='cancelled')AS members_cancelled,
      (SELECT count(*) FROM university_subscriptions  WHERE email LIKE '%@synthetic.local')                       AS subscriptions,
      (SELECT count(*) FROM university_community_posts WHERE author_email LIKE '%@synthetic.local' AND status='visible') AS visible_posts
  `;
  console.log("Seed complete. Counts:");
  console.table(counts);

  await sql.end({ timeout: 5 });
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  try {
    await sql.end({ timeout: 5 });
  } catch {}
  process.exit(1);
});
