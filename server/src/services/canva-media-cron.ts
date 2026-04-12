// ---------------------------------------------------------------------------
// Canva Media Tweet Cron — posts Canva designs as image tweets 2x/day
//
// ACTIVATED in app.ts. Requires: Canva OAuth connected + X OAuth connected.
// Will gracefully skip if Canva is not connected (logs warning, no crash).
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import {
  listDesigns,
  listFolderItems,
  exportDesignAsBuffer,
  loadTokens as loadCanvaTokens,
} from "./canva-connect.js";
import { uploadMedia } from "./x-api/media.js";
import { XApiClient } from "./x-api/client.js";
import { canUseDailyBudget } from "./x-api/rate-limiter.js";
import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";
const CANVA_MEDIA_FOLDER_ID = process.env.CANVA_MEDIA_FOLDER_ID || "";
const CANVA_MEDIA_MAX_PER_DAY = parseInt(process.env.CANVA_MEDIA_MAX_PER_DAY || "2", 10);

import { callOllamaGenerate } from "./ollama-client.js";

// ---------------------------------------------------------------------------
// In-memory tracking — which designs have been posted today
// ---------------------------------------------------------------------------

let postedDesignIds = new Set<string>();
let postedCountToday = 0;
let lastResetDate = "";

function resetDailyIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (lastResetDate !== today) {
    postedDesignIds = new Set();
    postedCountToday = 0;
    lastResetDate = today;
  }
}

// ---------------------------------------------------------------------------
// Ollama — generate tweet text for a Canva design
// ---------------------------------------------------------------------------

async function generateMediaTweetText(designTitle: string): Promise<string> {
  const prompt = `You are a social media manager for the Coherence Daddy / TX blockchain ecosystem.
Write a single tweet (under 260 characters to leave room for the image link) about this visual design.
The design is titled: "${designTitle}"

Include 1-2 of these accounts/links naturally:
- @txEcosystem — TX blockchain L1 (tx.org)
- @tokns_fi — portfolio dashboard at app.tokns.fi
- @txDevHub — developer tools on TX
- @coheraborator — Coherence Daddy (coherencedaddy.com — 523+ free tools)
- txdex.live — TX DEX for on-chain trading

Be engaging and draw people in. Create viral hooks — make people curious about the ecosystem.
Don't describe the image literally — reference the topic and tie it to something exciting happening in crypto.
Return ONLY the tweet text, nothing else.`;

  const raw = await callOllamaGenerate(prompt);
  let text = raw;

  // Remove quotes if Ollama wraps the response
  if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);

  // Truncate if over limit
  if (text.length > 260) text = text.slice(0, 259) + "\u2026";

  return text;
}

// ---------------------------------------------------------------------------
// Run one media tweet cycle
// ---------------------------------------------------------------------------

export async function runCanvaMediaCycle(db: Db): Promise<{
  posted: boolean;
  designId?: string;
  designTitle?: string;
  tweetId?: string;
  error?: string;
}> {
  resetDailyIfNeeded();

  // Check daily limit
  if (postedCountToday >= CANVA_MEDIA_MAX_PER_DAY) {
    return { posted: false, error: `Daily limit reached (${CANVA_MEDIA_MAX_PER_DAY})` };
  }

  // Check X API budget
  const budget = canUseDailyBudget("post");
  if (!budget.allowed) {
    return { posted: false, error: "X API daily budget exhausted" };
  }

  // Check Canva connection
  const canvaTokens = await loadCanvaTokens(db, DEFAULT_COMPANY_ID);
  if (!canvaTokens) {
    return { posted: false, error: "Canva not connected — visit /api/canva/oauth/authorize" };
  }

  try {
    // Get designs — from specific folder or all designs
    let designs;
    if (CANVA_MEDIA_FOLDER_ID) {
      designs = await listFolderItems(db, DEFAULT_COMPANY_ID, CANVA_MEDIA_FOLDER_ID);
    } else {
      designs = await listDesigns(db, DEFAULT_COMPANY_ID, { ownership: "owned" });
    }

    if (designs.length === 0) {
      return { posted: false, error: "No designs found in Canva" };
    }

    // Pick an unposted design
    const unposted = designs.filter((d) => !postedDesignIds.has(d.id));
    if (unposted.length === 0) {
      return { posted: false, error: "All designs already posted today — reset tomorrow" };
    }

    // Pick a random unposted design
    const design = unposted[Math.floor(Math.random() * unposted.length)]!;

    // Export as PNG
    logger.info({ designId: design.id, title: design.title }, "canva-media: exporting design");
    const buffer = await exportDesignAsBuffer(db, DEFAULT_COMPANY_ID, design.id, "png");

    // Upload to X
    const mediaId = await uploadMedia(db, DEFAULT_COMPANY_ID, buffer, "image/png");
    if (!mediaId) {
      return { posted: false, designId: design.id, error: "Media upload to X failed" };
    }

    // Generate tweet text
    const tweetText = await generateMediaTweetText(design.title);

    // Post tweet with media
    const client = new XApiClient(db, DEFAULT_COMPANY_ID);
    const tweetResult = await client.createTweet({ text: tweetText, mediaIds: [mediaId] });
    const tweetId = tweetResult?.data?.id;

    // Track
    postedDesignIds.add(design.id);
    postedCountToday++;

    logger.info(
      { designId: design.id, title: design.title, tweetId, postedCountToday },
      "canva-media: design posted as image tweet",
    );

    return { posted: true, designId: design.id, designTitle: design.title, tweetId };
  } catch (err) {
    logger.error({ err }, "canva-media: cycle failed");
    return { posted: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Register cron jobs — activated in app.ts
// ---------------------------------------------------------------------------

export function startCanvaMediaCrons(db: Db) {
  registerCronJob({
    jobName: "content:canva-media:morning",
    schedule: "0 10 * * *",
    ownerAgent: "sage",
    sourceFile: "canva-media-cron.ts",
    handler: async () => {
      const result = await runCanvaMediaCycle(db);
      logger.info({ result }, "Canva media morning cycle completed");
      return result;
    },
  });

  registerCronJob({
    jobName: "content:canva-media:evening",
    schedule: "0 18 * * *",
    ownerAgent: "sage",
    sourceFile: "canva-media-cron.ts",
    handler: async () => {
      const result = await runCanvaMediaCycle(db);
      logger.info({ result }, "Canva media evening cycle completed");
      return result;
    },
  });

  logger.info("Canva media cron jobs registered (2 jobs: morning + evening)");
}
