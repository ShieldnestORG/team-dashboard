/**
 * Funnel Library (BUILD PHASE 2 of the funnel system).
 *
 * A standing library of comment->DM funnel *drafts* per Zernio-capable
 * account. Goal: every account with a zernioAccountId keeps >=5 funnels
 * "ready to go" (approved, not yet live) at all times.
 *
 *   draft --(admin approve)--> ready --(admin arm)--> live --(admin retire)--> retired
 *     \--(admin reject)--> rejected                     ^
 *      ready --(admin reject)--------------------------/
 *
 * "arm" is the one action that touches Zernio: it creates the real
 * comment-automation via createZernioCommentAutomation (the same function the
 * existing POST /zernio/automations route uses) and stores the minted id.
 * "retire" reverses it: DELETE on Zernio (tolerating an already-gone 404,
 * same as setZernioCommentAutomationActive's kill path), then status ->
 * retired.
 *
 * Three moving parts live in this module:
 *   1. Catalog import — lazily upserts funnel-catalog.json into this table
 *      (idempotent; catalog_id is unique) so the read-only strategy catalog
 *      and the working library share one status vocabulary.
 *   2. AI drafting — callLlmChat + a defensive parser that never throws on
 *      bad model output (garbage in -> [] out, valid entries still extracted
 *      from a partially-malformed response).
 *   3. Status-transition guards — pure functions, unit-tested directly (see
 *      funnels-service.test.ts) and reused by both the routes and the cron.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { funnels, socialAccounts, type Funnel, type NewFunnel } from "@paperclipai/db";
import { callLlmChat, type LlmChatMessage } from "../llm-client.js";
import {
  createZernioCommentAutomation,
  deleteZernioCommentAutomation,
  ZernioApiError,
} from "../platform-publishers/zernio.js";
import { logger } from "../../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

export type FunnelStatus = "draft" | "ready" | "live" | "rejected" | "retired";
export type FunnelStyle = "standard" | "controversial" | "weird";

const FUNNEL_STATUSES: readonly FunnelStatus[] = ["draft", "ready", "live", "rejected", "retired"];
const FUNNEL_STYLES: readonly FunnelStyle[] = ["standard", "controversial", "weird"];

/** Every account is expected to hold at least this many 'ready' funnels. */
export const READY_TARGET = 5;
/** Hard ceiling on drafts minted per POST /funnels/generate call. */
const GENERATE_MAX_PER_CALL = 10;
/** Hard ceiling on drafts minted per cron tick, across every account. */
const TOPUP_CAP_PER_RUN = 10;

/** Thrown by guard checks so routes can map status -> HTTP status verbatim. */
export class FunnelGuardError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FunnelGuardError";
  }
}

// ---------------------------------------------------------------------------
// Catalog loading — moved from routes/socials.ts so both the read-only
// GET /funnels/catalog endpoint and the funnel-library import share one
// loader (same lazy + cached pattern, same file).
// ---------------------------------------------------------------------------

export interface FunnelCatalogEntry extends Record<string, unknown> {
  id: string;
  name: string;
  status: string;
  accounts?: string[];
  trigger?: string;
  destination?: string;
  tos_risk?: string;
  notes?: string;
}

export interface FunnelCatalog {
  snapshotDate: string;
  source: string;
  funnels: FunnelCatalogEntry[];
}

const FUNNEL_CATALOG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../content-templates/funnel-catalog.json",
);

let funnelCatalogCache: FunnelCatalog | null = null;

export function loadFunnelCatalog(): FunnelCatalog {
  if (!funnelCatalogCache) {
    funnelCatalogCache = JSON.parse(readFileSync(FUNNEL_CATALOG_PATH, "utf8")) as FunnelCatalog;
  }
  return funnelCatalogCache;
}

// ---------------------------------------------------------------------------
// Status-transition guards — pure, unit-tested directly.
// ---------------------------------------------------------------------------

/** draft -> ready */
export function canApprove(status: FunnelStatus): boolean {
  return status === "draft";
}

/** draft -> rejected, or ready -> rejected (pull back an approved-not-armed draft). */
export function canReject(status: FunnelStatus): boolean {
  return status === "draft" || status === "ready";
}

/**
 * ready -> live. Requires the account's funnels_enabled gate to be on, and
 * requires the funnel to actually be armable (non-empty DM message + at
 * least one non-empty keyword) — otherwise createZernioCommentAutomation
 * throws a generic error that would surface as an opaque 500 instead of a
 * clean 409. Catches the empty-dmMessage/keywords stubs that POST /funnels
 * (defaults) and the catalog import ('built' rows) can produce.
 */
export function canArm(
  status: FunnelStatus,
  funnelsEnabled: boolean,
  dmMessage: string,
  keywords: string[],
): { ok: true } | { ok: false; error: string } {
  if (status !== "ready") {
    return { ok: false, error: `funnel must be 'ready' to arm (current status: '${status}')` };
  }
  if (!funnelsEnabled) {
    return { ok: false, error: "funnels are disabled for this account — enable funnels first" };
  }
  if (!dmMessage.trim()) {
    return { ok: false, error: "funnel has no DM message set — add one before arming" };
  }
  if (!keywords.some((k) => k.trim().length > 0)) {
    return { ok: false, error: "funnel has no keyword set — add at least one before arming" };
  }
  return { ok: true };
}

/** ready -> retired (shelve an approved draft), or live -> retired (kill it). */
export function canRetire(status: FunnelStatus): boolean {
  return status === "ready" || status === "live";
}

// ---------------------------------------------------------------------------
// Catalog import — idempotent, lazy on first read.
// ---------------------------------------------------------------------------

/**
 * Map a funnel-catalog.json status onto our five-state vocabulary. Anything
 * unrecognized lands in 'draft' with a note rather than being silently
 * dropped — fail loud, not silent.
 */
export function mapCatalogStatus(raw: string): { status: FunnelStatus; extraNote?: string } {
  const s = (raw || "").trim().toLowerCase();
  if (s === "live") return { status: "live" };
  if (s === "ready" || s === "built") return { status: "ready" };
  if (s === "planned" || s === "idea") return { status: "draft" };
  if (s === "blocked-on-account") {
    return { status: "draft", extraNote: "Blocked on account: not yet connected to Zernio." };
  }
  if (s === "wont-build") return { status: "rejected" };
  return { status: "draft", extraNote: `Unmapped catalog status '${raw}' — defaulted to draft.` };
}

/** First "@handle"-shaped entry in a catalog row's accounts list, or 'multi-account'. */
export function catalogAccountHandle(accounts: string[] | undefined): string {
  if (Array.isArray(accounts)) {
    for (const a of accounts) {
      const trimmed = (a ?? "").trim();
      if (trimmed.startsWith("@")) {
        const handle = trimmed.slice(1).split(/[\s(]/)[0];
        if (handle) return handle;
      }
    }
  }
  return "multi-account";
}

/** Pull quoted keyword(s) out of a catalog trigger string, e.g. comment "ROOM". */
export function catalogKeywords(trigger: string | undefined): string[] {
  if (!trigger) return [];
  const matches = [...trigger.matchAll(/"([^"]+)"/g)].map((m) => m[1]!.toUpperCase());
  return matches.slice(0, 4);
}

export function mapCatalogEntryToFunnelInsert(entry: FunnelCatalogEntry, companyId: string): NewFunnel {
  const { status, extraNote } = mapCatalogStatus(entry.status);
  const notes = [entry.notes, extraNote].filter((n): n is string => Boolean(n && n.trim())).join(" ");
  const destination =
    typeof entry.destination === "string" && /\./.test(entry.destination) && entry.destination !== "varies"
      ? entry.destination
      : null;
  return {
    companyId,
    catalogId: entry.id,
    name: entry.name,
    accountHandle: catalogAccountHandle(entry.accounts),
    keywords: catalogKeywords(entry.trigger),
    dmMessage: "",
    destinationUrl: destination,
    postHooks: [],
    style: "standard",
    tosRisk: entry.tos_risk ?? null,
    notes: notes || null,
    status,
    createdBy: "system:catalog-import",
  };
}

// Attempted (not necessarily succeeded) once per process — the DB upsert
// itself is fully idempotent (onConflictDoNothing on catalog_id), so a retry
// on the next process start is harmless.
let catalogImportAttempted = false;

/** Upsert funnel-catalog.json into the funnels table. Safe to call repeatedly. */
export async function ensureFunnelCatalogImported(db: Db): Promise<void> {
  if (catalogImportAttempted) return;
  catalogImportAttempted = true;
  try {
    const catalog = loadFunnelCatalog();
    const rows = catalog.funnels
      .filter((e) => typeof e?.id === "string" && typeof e?.name === "string")
      .map((e) => mapCatalogEntryToFunnelInsert(e, COMPANY_ID));
    if (rows.length === 0) return;
    const inserted = await db
      .insert(funnels)
      .values(rows)
      .onConflictDoNothing({ target: funnels.catalogId })
      .returning({ id: funnels.id });
    if (inserted.length > 0) {
      logger.info({ imported: inserted.length }, "funnels-service: catalog import upserted new rows");
    }
  } catch (err) {
    logger.error({ err }, "funnels-service: catalog import failed");
  }
}

// ---------------------------------------------------------------------------
// AI drafting — defensive parser + prompt builder.
// ---------------------------------------------------------------------------

export const FUNNEL_STYLE_DEFS: Record<FunnelStyle, string> = {
  standard: "Clear value hook — plainly states what the person gets and why it's worth a comment.",
  controversial:
    "Spicy, contrarian take that provokes debate in the comments — NEVER hateful, harassing, " +
    "defamatory, or health/finance misinformation.",
  weird:
    'Absurd, playful bait (e.g. "comment SPOON or your Tuesday runs backwards") — obviously ' +
    "nonsense, intriguing, tells the user to comment.",
};

export interface FunnelDraft {
  name: string;
  keywords: string[];
  dmMessage: string;
  destinationUrl: string | null;
  postHooks: string[];
  style: FunnelStyle;
  tosRisk: string;
  notes: string;
}

/**
 * Defensive parser for the LLM's funnel-draft JSON. Never throws: garbage
 * input (empty string, prose, truncated JSON, wrong shape) returns [];
 * partially-malformed arrays still yield whatever entries pass validation.
 * Mirrors the comment-knowledge-extractor.ts parseTriples pattern.
 */
export function parseFunnelDrafts(response: string): FunnelDraft[] {
  const match = response.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: FunnelDraft[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;

    const name = String(t.name ?? "").trim();
    if (name.length < 3 || name.length > 140) continue;

    const keywordsRaw = Array.isArray(t.keywords) ? t.keywords : [];
    const keywords = keywordsRaw
      .map((k) => String(k).trim().toUpperCase())
      .filter((k) => k.length > 0 && k.length <= 24)
      .slice(0, 2);
    // ToS hazard (fire-on-any-comment) if there is no keyword gate — drop.
    if (keywords.length === 0) continue;

    const dmMessageRaw = String(t.dm_message ?? t.dmMessage ?? "").trim();
    if (!dmMessageRaw) continue;
    const dmMessage = dmMessageRaw.slice(0, 640); // Zernio button_template limit

    const destRaw = t.destination_url ?? t.destinationUrl;
    const destinationUrl = typeof destRaw === "string" && destRaw.trim() ? destRaw.trim() : null;

    const postHooksRaw = Array.isArray(t.post_hooks) ? t.post_hooks : Array.isArray(t.postHooks) ? t.postHooks : [];
    const postHooks = postHooksRaw
      .map((h) => String(h).trim())
      .filter((h) => h.length > 0 && h.length <= 200)
      .slice(0, 3);

    const styleRaw = String(t.style ?? "").trim().toLowerCase();
    const style: FunnelStyle = (FUNNEL_STYLES as readonly string[]).includes(styleRaw)
      ? (styleRaw as FunnelStyle)
      : "standard";

    const tosRiskRaw = String(t.tos_risk ?? t.tosRisk ?? "").trim().toLowerCase();
    // Default to 'medium' (never invent 'low' when the model didn't say so).
    const tosRisk = ["low", "medium", "high"].includes(tosRiskRaw) ? tosRiskRaw : "medium";

    const notes = String(t.notes ?? "").trim().slice(0, 500);

    out.push({ name, keywords, dmMessage, destinationUrl, postHooks, style, tosRisk, notes });
  }
  return out;
}

/** Known free-tool destination URLs for an account, harvested from the catalog. */
function harvestDestinationUrls(accountHandle: string): string[] {
  const catalog = loadFunnelCatalog();
  const urls = new Set<string>();
  for (const e of catalog.funnels) {
    const accounts = e.accounts ?? [];
    const matches = accounts.some((a) => (a ?? "").replace(/^@/, "").split(/[\s(]/)[0] === accountHandle);
    if (!matches) continue;
    if (typeof e.destination === "string" && /\./.test(e.destination) && e.destination !== "varies") {
      urls.add(e.destination);
    }
  }
  if (urls.size === 0) {
    urls.add("coherencedaddy.com/tools/coherence-engine");
    urls.add("jointhecoherent.com");
  }
  return [...urls];
}

async function existingFunnelSummaries(
  db: Db,
  accountHandle: string,
): Promise<Array<{ name: string; keywords: string[] }>> {
  const rows = await db
    .select({ name: funnels.name, keywords: funnels.keywords })
    .from(funnels)
    .where(and(eq(funnels.companyId, COMPANY_ID), eq(funnels.accountHandle, accountHandle)));
  return rows;
}

function buildGenerationPrompt(input: {
  accountHandle: string;
  count: number;
  styles: FunnelStyle[];
  destinationUrls: string[];
  existing: Array<{ name: string; keywords: string[] }>;
}): LlmChatMessage[] {
  const styleLines = FUNNEL_STYLES.map((s) => `- ${s}: ${FUNNEL_STYLE_DEFS[s]}`).join("\n");
  const existingLines =
    input.existing.length > 0
      ? input.existing.map((f) => `- ${f.name} (${f.keywords.join("/")})`).join("\n")
      : "(none yet)";

  const system = `You draft Instagram comment-to-DM "funnel" campaigns for the account @${input.accountHandle}.

MECHANIC (every draft assumes this 2-step pattern):
1. Someone comments the KEYWORD on a post.
2. The automation sends DM #1 — a link-free opener that asks them to reply/confirm.
3. When they reply, DM #2 (in-window) carries the tracked link/button.

STYLES:
${styleLines}

RULES (Instagram ToS safety is non-negotiable):
- Every draft must be keyword-gated — never fire-on-any-comment.
- No destination-masking, no automated multi-message qualification loops, no promo-DM drip.
- keywords: 1-2 short ALL-CAPS words (e.g. "ROOM", "COHERENT").
- dm_message: describe DM #1 (the link-free opener + the confirm ask), <=300 chars.
- destination_url: prefer one of the known URLs below; only propose a new /tools/<slug> page under coherencedaddy.com if none fit.
- post_hooks: exactly 3 short caption hooks (<=140 chars each) ending on the keyword CTA.
- tos_risk: "low" | "medium" | "high" — be honest, never claim "low" for something borderline.
- notes: one sentence on the angle and why it fits the style.
- Do not repeat an existing funnel's name or keyword.

Known destination URLs for this account:
${input.destinationUrls.map((u) => `- ${u}`).join("\n")}

Existing funnels already running or drafted for this account (avoid duplicates):
${existingLines}

Output ONLY a JSON array of exactly ${input.count} objects, no markdown, no explanation. Cycle through the styles in this order: [${input.styles.join(", ")}]. Each object:
{"name":"...","keywords":["..."],"dm_message":"...","destination_url":"...","post_hooks":["...","...","..."],"style":"standard|controversial|weird","tos_risk":"low|medium|high","notes":"..."}`;

  return [
    { role: "system", content: system },
    { role: "user", content: `Draft ${input.count} funnels for @${input.accountHandle}.` },
  ];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export interface GenerateFunnelsResult {
  inserted: Funnel[];
  requestedCount: number;
  parsedCount: number;
  provider: string;
  model: string;
}

/** AI-draft new funnels for one account and insert them as status='draft'. */
export async function generateFunnelDraftsForAccount(
  db: Db,
  accountHandle: string,
  opts: { count?: number; styles?: FunnelStyle[] } = {},
): Promise<GenerateFunnelsResult> {
  const count = clamp(Math.floor(opts.count ?? 5), 1, GENERATE_MAX_PER_CALL);
  const requestedStyles = (opts.styles ?? []).filter((s) => (FUNNEL_STYLES as readonly string[]).includes(s));
  const styleCycle = requestedStyles.length > 0 ? requestedStyles : [...FUNNEL_STYLES];
  const styles = Array.from({ length: count }, (_, i) => styleCycle[i % styleCycle.length]!);

  const destinationUrls = harvestDestinationUrls(accountHandle);
  const existing = await existingFunnelSummaries(db, accountHandle);
  const messages = buildGenerationPrompt({ accountHandle, count, styles, destinationUrls, existing });

  const result = await callLlmChat(messages, { temperature: 0.8, maxTokens: 2500 });
  const drafts = parseFunnelDrafts(result.content).slice(0, count);

  const accountRows = await db
    .select({ id: socialAccounts.id })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.companyId, COMPANY_ID),
        eq(socialAccounts.handle, accountHandle),
        eq(socialAccounts.archived, false),
      ),
    )
    .limit(1);
  const socialAccountId = accountRows[0]?.id ?? null;

  let inserted: Funnel[] = [];
  if (drafts.length > 0) {
    const rows: NewFunnel[] = drafts.map((d) => ({
      companyId: COMPANY_ID,
      catalogId: null,
      name: d.name,
      accountHandle,
      socialAccountId,
      keywords: d.keywords,
      matchMode: "contains",
      dmMessage: d.dmMessage,
      destinationUrl: d.destinationUrl,
      postHooks: d.postHooks,
      style: d.style,
      tosRisk: d.tosRisk,
      notes: d.notes || null,
      status: "draft",
      createdBy: `ai:${result.model}`,
    }));
    inserted = await db.insert(funnels).values(rows).returning();
  }

  logger.info(
    { accountHandle, requested: count, parsed: drafts.length, inserted: inserted.length, provider: result.provider },
    "funnels-service: generated drafts",
  );

  return {
    inserted,
    requestedCount: count,
    parsedCount: drafts.length,
    provider: result.provider,
    model: result.model,
  };
}

// ---------------------------------------------------------------------------
// Coverage — per funnels-capable account, counts by status vs. the target.
// ---------------------------------------------------------------------------

export function emptyStatusCounts(): Record<FunnelStatus, number> {
  return { draft: 0, ready: 0, live: 0, rejected: 0, retired: 0 };
}

async function statusCountsByAccount(db: Db): Promise<Map<string, Record<FunnelStatus, number>>> {
  const rows = await db
    .select({ accountHandle: funnels.accountHandle, status: funnels.status, n: sql<number>`count(*)::int` })
    .from(funnels)
    .where(eq(funnels.companyId, COMPANY_ID))
    .groupBy(funnels.accountHandle, funnels.status);
  const map = new Map<string, Record<FunnelStatus, number>>();
  for (const row of rows) {
    if (!map.has(row.accountHandle)) map.set(row.accountHandle, emptyStatusCounts());
    const status = FUNNEL_STATUSES.includes(row.status as FunnelStatus) ? (row.status as FunnelStatus) : "draft";
    map.get(row.accountHandle)![status] = row.n;
  }
  return map;
}

export interface FunnelAccountCoverage {
  accountId: string;
  handle: string;
  zernioAccountId: string;
  funnelsEnabled: boolean;
  counts: Record<FunnelStatus, number>;
  readyCount: number;
  readyTarget: number;
  atTarget: boolean;
}

/** Every funnels-capable (zernioAccountId set) account, with status counts. */
export async function computeFunnelCoverage(db: Db): Promise<FunnelAccountCoverage[]> {
  await ensureFunnelCatalogImported(db);
  const accounts = await db
    .select({
      id: socialAccounts.id,
      handle: socialAccounts.handle,
      zernioAccountId: socialAccounts.zernioAccountId,
      funnelsEnabled: socialAccounts.funnelsEnabled,
    })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.companyId, COMPANY_ID),
        eq(socialAccounts.archived, false),
        isNotNull(socialAccounts.zernioAccountId),
      ),
    );
  const countsByAccount = await statusCountsByAccount(db);

  return accounts.map((a) => {
    const counts = countsByAccount.get(a.handle) ?? emptyStatusCounts();
    return {
      accountId: a.id,
      handle: a.handle,
      zernioAccountId: a.zernioAccountId!,
      funnelsEnabled: a.funnelsEnabled === true,
      counts,
      readyCount: counts.ready,
      readyTarget: READY_TARGET,
      atTarget: counts.ready >= READY_TARGET,
    };
  });
}

// ---------------------------------------------------------------------------
// Row-level actions: approve / reject / arm / retire.
// ---------------------------------------------------------------------------

async function getFunnelOrThrow(db: Db, id: string): Promise<Funnel> {
  const rows = await db
    .select()
    .from(funnels)
    .where(and(eq(funnels.id, id), eq(funnels.companyId, COMPANY_ID)))
    .limit(1);
  const funnel = rows[0];
  if (!funnel) throw new FunnelGuardError(404, "funnel not found");
  return funnel;
}

export async function approveFunnel(db: Db, id: string, approvedByUserId: string | null): Promise<Funnel> {
  const funnel = await getFunnelOrThrow(db, id);
  if (!canApprove(funnel.status as FunnelStatus)) {
    throw new FunnelGuardError(409, `funnel must be 'draft' to approve (current status: '${funnel.status}')`);
  }
  const updated = await db
    .update(funnels)
    .set({ status: "ready", approvedByUserId, updatedAt: sql`now()` })
    .where(eq(funnels.id, id))
    .returning();
  return updated[0]!;
}

export async function rejectFunnel(db: Db, id: string): Promise<Funnel> {
  const funnel = await getFunnelOrThrow(db, id);
  if (!canReject(funnel.status as FunnelStatus)) {
    throw new FunnelGuardError(
      409,
      `funnel must be 'draft' or 'ready' to reject (current status: '${funnel.status}')`,
    );
  }
  const updated = await db
    .update(funnels)
    .set({ status: "rejected", updatedAt: sql`now()` })
    .where(eq(funnels.id, id))
    .returning();
  return updated[0]!;
}

/** Resolve the Zernio account id a funnel targets, preferring its stored link. */
async function resolveZernioAccountId(db: Db, funnel: Funnel): Promise<string | null> {
  if (funnel.socialAccountId) {
    const rows = await db
      .select({ zernioAccountId: socialAccounts.zernioAccountId })
      .from(socialAccounts)
      .where(eq(socialAccounts.id, funnel.socialAccountId))
      .limit(1);
    if (rows[0]?.zernioAccountId) return rows[0].zernioAccountId;
  }
  const rows = await db
    .select({ id: socialAccounts.id, zernioAccountId: socialAccounts.zernioAccountId })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.companyId, COMPANY_ID),
        eq(socialAccounts.handle, funnel.accountHandle),
        eq(socialAccounts.archived, false),
      ),
    )
    .limit(1);
  return rows[0]?.zernioAccountId ?? null;
}

/**
 * Arm a 'ready' funnel: create the real Zernio comment automation and flip
 * status -> live. On a Zernio failure the row is left untouched (still
 * 'ready') — callers should let ZernioApiError/ZernioAddonMissingError
 * propagate to the route's existing zernioErr() mapping.
 */
export async function armFunnel(db: Db, id: string): Promise<Funnel> {
  const funnel = await getFunnelOrThrow(db, id);
  const accountRows = await db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.companyId, COMPANY_ID),
        eq(socialAccounts.handle, funnel.accountHandle),
        eq(socialAccounts.archived, false),
      ),
    )
    .limit(1);
  const account = accountRows[0];
  if (!account?.zernioAccountId) {
    throw new FunnelGuardError(409, `@${funnel.accountHandle} is not connected to Zernio yet`);
  }
  const guard = canArm(
    funnel.status as FunnelStatus,
    account.funnelsEnabled === true,
    funnel.dmMessage,
    funnel.keywords,
  );
  if (!guard.ok) throw new FunnelGuardError(409, guard.error);

  // Not caught here — a Zernio failure must leave the row 'ready' and
  // propagate so the route can report it via zernioErr().
  const automation = await createZernioCommentAutomation({
    zernioAccountId: account.zernioAccountId,
    name: funnel.name,
    trigger: "comment",
    keywords: funnel.keywords,
    matchMode: funnel.matchMode === "exact" ? "exact" : "contains",
    dmMessage: funnel.dmMessage,
  });

  // Gate the write on status='ready' too (not just id) so two concurrent arm
  // requests for the same row can't both pass the read-time guard above and
  // both create a live Zernio automation. Whichever request loses the race
  // gets a zero-row result here — its freshly-created Zernio automation is
  // orphaned (not attached to this row), so log it loudly for manual cleanup
  // rather than silently overwriting the winner's zernioAutomationId.
  const updated = await db
    .update(funnels)
    .set({
      status: "live",
      zernioAutomationId: automation.id,
      socialAccountId: account.id,
      updatedAt: sql`now()`,
    })
    .where(and(eq(funnels.id, id), eq(funnels.status, "ready")))
    .returning();
  const row = updated[0];
  if (!row) {
    logger.error(
      { funnelId: id, zernioAutomationId: automation.id },
      "funnel arm: status changed concurrently after the Zernio automation was created — orphaned automation, needs manual cleanup",
    );
    throw new FunnelGuardError(
      409,
      "funnel was armed by another request — check Zernio for a possible duplicate automation",
    );
  }
  return row;
}

/**
 * Retire a 'ready' or 'live' funnel. If live, DELETE on Zernio first
 * (tolerating an already-gone 404, mirroring setZernioCommentAutomationActive's
 * kill path); real Zernio failures propagate for zernioErr() to report.
 */
export async function retireFunnel(db: Db, id: string): Promise<Funnel> {
  const funnel = await getFunnelOrThrow(db, id);
  if (!canRetire(funnel.status as FunnelStatus)) {
    throw new FunnelGuardError(
      409,
      `funnel must be 'ready' or 'live' to retire (current status: '${funnel.status}')`,
    );
  }

  if (funnel.status === "live" && funnel.zernioAutomationId) {
    const zernioAccountId = await resolveZernioAccountId(db, funnel);
    if (zernioAccountId) {
      try {
        await deleteZernioCommentAutomation(zernioAccountId, funnel.zernioAutomationId);
      } catch (err) {
        if (err instanceof ZernioApiError && err.status === 404) {
          logger.info({ funnelId: id }, "funnel retire: Zernio automation already gone — treated as already-off");
        } else {
          throw err;
        }
      }
    } else {
      logger.warn(
        { funnelId: id },
        "funnel retire: no Zernio account resolved — retiring the row without a Zernio-side delete",
      );
    }
  }

  const updated = await db
    .update(funnels)
    .set({ status: "retired", updatedAt: sql`now()` })
    .where(eq(funnels.id, id))
    .returning();
  return updated[0]!;
}

// ---------------------------------------------------------------------------
// Cron: daily top-up.
// ---------------------------------------------------------------------------

export interface FunnelTopupResult {
  accountsChecked: number;
  drafted: number;
  details: Array<{ accountHandle: string; drafted: number; error?: string }>;
}

/**
 * For each funnels-capable account, if count(status in draft,ready) < 5,
 * generate the shortfall. Drafts always land as status='draft' — the cron
 * never approves or arms. Capped at TOPUP_CAP_PER_RUN drafts total per tick
 * so one bad prompt/provider outage cannot spam every account.
 */
export async function runFunnelTopupTick(db: Db): Promise<FunnelTopupResult> {
  await ensureFunnelCatalogImported(db);
  const accounts = await db
    .select({
      handle: socialAccounts.handle,
      zernioAccountId: socialAccounts.zernioAccountId,
    })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.companyId, COMPANY_ID),
        eq(socialAccounts.archived, false),
        isNotNull(socialAccounts.zernioAccountId),
      ),
    );
  const countsByAccount = await statusCountsByAccount(db);

  let drafted = 0;
  const details: FunnelTopupResult["details"] = [];

  for (const account of accounts) {
    if (drafted >= TOPUP_CAP_PER_RUN) {
      details.push({ accountHandle: account.handle, drafted: 0, error: "per-run draft cap reached" });
      continue;
    }
    const counts = countsByAccount.get(account.handle) ?? emptyStatusCounts();
    const backlog = counts.draft + counts.ready;
    if (backlog >= READY_TARGET) {
      details.push({ accountHandle: account.handle, drafted: 0 });
      continue;
    }
    const need = Math.min(READY_TARGET - backlog, TOPUP_CAP_PER_RUN - drafted);
    try {
      const result = await generateFunnelDraftsForAccount(db, account.handle, { count: need });
      drafted += result.inserted.length;
      details.push({ accountHandle: account.handle, drafted: result.inserted.length });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      details.push({ accountHandle: account.handle, drafted: 0, error });
      logger.warn({ err, accountHandle: account.handle }, "socials:funnel-topup: draft generation failed for account");
    }
  }

  logger.info({ accountsChecked: accounts.length, drafted, details }, "socials:funnel-topup tick complete");
  return { accountsChecked: accounts.length, drafted, details };
}
