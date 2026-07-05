// ---------------------------------------------------------------------------
// import-marketing-kits — sync §6 of the marketing plan into the committed
// Content Hub data module.
//
//   pnpm kits:sync                 parse + write ui/src/content/marketing-kits/kits.generated.ts
//   pnpm kits:sync --check         re-parse and diff against the committed module (CI-able);
//                                  exits 1 if the plan md and the module drifted
//   pnpm kits:sync <path-to-md>    parse a different source file (or set MARKETING_PLAN_PATH)
//
// WHY a build-time script + committed artifact (not a runtime read): prod runs
// with a read-only rootfs and the marketing/ folder is outside the Docker
// build context — the md is unreachable at runtime AND at image-build time.
// Precedent: ui/src/content/affiliate-learn/. Refresh path: edit the plan md
// → `pnpm kits:sync` → commit the kits.generated.ts diff → deploy.
//
// Parse strategy (two stages, per the build plan):
//   Stage 1 (lossless): each `### KIT N — Title` heading's single fenced block
//     is captured VERBATIM into `raw` — that alone powers "copy whole kit"
//     with zero fidelity risk (UTF-8/emoji byte-exact; we parse the md, never
//     the board HTML, so no &amp;-style entity mangling).
//   Stage 2 (best-effort): start-of-line label regexes carve the block into
//     labeled fields for per-field copy buttons; every field is optional.
//
// staticStatus/subtitle below are a hand-maintained buildability fallback
// mirroring the funnel board's badges — the UI must NEVER render them as live
// funnel status (live green/amber/red comes from /api/socials/zernio/greenlight).
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SOURCE = "/Users/exe/Downloads/Claude/marketing/plans/plan-zernio-leverage.md";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(
  __dirname,
  "../ui/src/content/marketing-kits/kits.generated.ts",
);

type KitVoiceKey = "mark" | "brianna" | "mami" | "remy" | "solene";

interface KitField {
  label: string;
  value: string;
}

interface KitSpokenLine {
  voiceKey: string;
  label: string;
  text: string;
}

interface MarketingKit {
  id: number;
  title: string;
  kind: "endcard-pack" | "funnel";
  raw: string;
  keyword?: string;
  account?: string;
  voiceKey?: KitVoiceKey;
  clickTags?: string[];
  fields: KitField[];
  spokenLines: KitSpokenLine[];
  staticStatus?: "live" | "plan" | "defer";
  subtitle?: string;
}

// Voice routing per kit (plan §6: Mark reads the brand kits, personas theirs).
const VOICE_BY_KIT: Record<number, KitVoiceKey> = {
  0: "mark", 1: "mark", 2: "mark", 3: "mark", 4: "mark", 5: "mark",
  6: "brianna", 7: "mami", 8: "solene", 9: "remy",
};

// Hand-maintained buildability badges (mirrors the board's b-live/b-plan/b-defer).
const STATIC_STATUS: Record<number, { status: "live" | "plan" | "defer"; subtitle: string }> = {
  0: { status: "live", subtitle: "End-card pack — bolt onto content that already exists" },
  1: { status: "live", subtitle: "Founding-100 seats — post daily until July 12" },
  2: { status: "live", subtitle: "Free tool funnel — live and starving for content" },
  3: { status: "plan", subtitle: "Story check-in — waiting on the Check URL" },
  4: { status: "plan", subtitle: "Diagnostic carousel — waiting on the Check URL" },
  5: { status: "live", subtitle: "OutRizzd merch — live, per-post only" },
  6: { status: "plan", subtitle: "Brianna persona — checklist asset needed" },
  7: { status: "plan", subtitle: "Mami persona — EN/ES guide asset needed" },
  8: { status: "defer", subtitle: "Solène persona — on hold until the account exists" },
  9: { status: "defer", subtitle: "Remy persona — on hold until connected to Zernio" },
};

// Start-of-line field labels (order matters: first match wins). The captured
// group is the label text (without the trailing colon). Values consume every
// following line — including indented sub-lines like `  BUTTON:` — until the
// next known label starts a line.
const FIELD_LABEL_RES: RegExp[] = [
  /^(FUNNEL):\s?/,
  /^(ACCOUNT):\s?/,
  /^(KEYWORD):\s?/,
  /^(IDEA):\s?/,
  /^(THUMBNAIL[^:\n]*):\s?/,
  /^(SCRIPT[^:\n]*):\s?/,
  /^(VOICE SNIPPET[^:\n]*):\s?/,
  /^(DM #1[^:\n]*):\s?/,
  /^(DM #2[^:\n]*):\s?/,
  /^(DM COPY):\s?/,
  /^(DM \([^)\n]*\)):\s?/,
  /^(DM pattern):\s?/,
  /^(PUBLIC REPLY):\s?/,
  /^(ZERNIO SETTINGS):\s?/,
  /^(SETTINGS):\s?/,
];

function matchFieldLabel(line: string): { label: string; rest: string } | null {
  for (const re of FIELD_LABEL_RES) {
    const match = re.exec(line);
    if (match) {
      return { label: match[1], rest: line.slice(match[0].length) };
    }
  }
  return null;
}

/** §6 slice: from its heading to the next `## ` heading (or EOF). */
function extractSection6(md: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((line) => /^## §6 /.test(line));
  if (start === -1) {
    throw new Error("Could not find the '## §6' heading in the source md.");
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

interface RawKit {
  id: number;
  title: string;
  raw: string;
}

/** Stage 1: heading + verbatim fenced block per kit. */
function extractRawKits(section: string): RawKit[] {
  const lines = section.split("\n");
  const kits: RawKit[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^### KIT (\d+) — (.*)$/.exec(lines[i]);
    if (!heading) continue;
    const id = Number(heading[1]);
    const title = heading[2];
    // The single following unlanguaged fenced block, captured verbatim.
    let fenceOpen = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^### /.test(lines[j])) break; // next kit — no block found
      if (lines[j] === "```") {
        fenceOpen = j;
        break;
      }
    }
    if (fenceOpen === -1) {
      throw new Error(`KIT ${id}: no fenced block found after the heading.`);
    }
    let fenceClose = -1;
    for (let j = fenceOpen + 1; j < lines.length; j += 1) {
      if (lines[j] === "```") {
        fenceClose = j;
        break;
      }
    }
    if (fenceClose === -1) {
      throw new Error(`KIT ${id}: fenced block never closes.`);
    }
    kits.push({ id, title, raw: lines.slice(fenceOpen + 1, fenceClose).join("\n") });
  }
  return kits;
}

/** Stage 2: best-effort labeled fields (funnels — KIT 0 has its own parser). */
function parseFields(raw: string): KitField[] {
  const fields: KitField[] = [];
  let current: { label: string; parts: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    fields.push({ label: current.label, value: current.parts.join("\n").trim() });
    current = null;
  };
  for (const line of raw.split("\n")) {
    const labeled = matchFieldLabel(line);
    if (labeled) {
      flush();
      current = { label: labeled.label, parts: [labeled.rest] };
    } else if (current) {
      current.parts.push(line);
    }
  }
  flush();
  return fields;
}

/** First double-quoted span inside a field value, unwrapped to one line. */
function extractQuoted(value: string): string | null {
  const first = value.indexOf('"');
  const last = value.lastIndexOf('"');
  if (first === -1 || last <= first) return null;
  return value.slice(first + 1, last).replace(/\s*\n\s*/g, " ").trim();
}

/** KIT 0: the five `on-screen:` / `say:` pairs under their platform headers. */
function parseEndcardPack(raw: string, voiceKey: KitVoiceKey): {
  fields: KitField[];
  spokenLines: KitSpokenLine[];
} {
  const lines = raw.split("\n");
  const fields: KitField[] = [];
  const spokenLines: KitSpokenLine[] = [];
  let header: string | null = null;
  for (const line of lines) {
    if (/^\S/.test(line) && line.trim() !== "") {
      header = line.trim();
      continue;
    }
    const onScreen = /^\s+on-screen:\s*"(.*)"\s*$/.exec(line);
    if (onScreen && header) {
      fields.push({ label: `${header} — on-screen`, value: onScreen[1] });
      continue;
    }
    const say = /^\s+say:\s*"(.*)"\s*$/.exec(line);
    if (say && header && !say[1].includes("{link}")) {
      spokenLines.push({ voiceKey, label: header, text: say[1] });
    }
  }
  return { fields, spokenLines };
}

/** Every clickTag value in the block (all notations), deduped in order. */
function extractClickTags(raw: string): string[] {
  const re = /clickTags?\s*[:=]\s*"?([A-Za-z0-9][\w-]*)"?|clickTag\s+"([A-Za-z0-9][\w-]*)"|clickTag\s+([a-z0-9][\w-]*)/g;
  const tags: string[] = [];
  for (const match of raw.matchAll(re)) {
    const tag = match[1] ?? match[2] ?? match[3];
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function buildKit(rawKit: RawKit): MarketingKit {
  const voiceKey = VOICE_BY_KIT[rawKit.id];
  const meta = STATIC_STATUS[rawKit.id];
  const base = {
    id: rawKit.id,
    title: rawKit.title,
    raw: rawKit.raw,
    ...(voiceKey ? { voiceKey } : {}),
    ...(meta ? { staticStatus: meta.status, subtitle: meta.subtitle } : {}),
  };

  if (rawKit.id === 0) {
    const { fields, spokenLines } = parseEndcardPack(rawKit.raw, voiceKey ?? "mark");
    return { ...base, kind: "endcard-pack", fields, spokenLines };
  }

  const fields = parseFields(rawKit.raw);
  const fieldValue = (prefix: string) =>
    fields.find((field) => field.label.startsWith(prefix))?.value;

  // KEYWORD: first `·`-separated segment, parenthetical stripped ("READY (story reply)" → "READY").
  const keywordField = fieldValue("KEYWORD");
  const keyword = keywordField
    ? keywordField.split("·")[0].replace(/\([^)]*\)/g, "").trim() || undefined
    : undefined;

  // ACCOUNT: up to the inline `· VOICE:` marker.
  const accountField = fieldValue("ACCOUNT");
  const account = accountField ? accountField.split("·")[0].trim() || undefined : undefined;

  // Spoken line for the voice chips: the VOICE SNIPPET's quoted text only.
  // `{link}` placeholders must never reach TTS.
  const spokenLines: KitSpokenLine[] = [];
  const snippetField = fields.find((field) => field.label.startsWith("VOICE SNIPPET"));
  if (snippetField && voiceKey) {
    const text = extractQuoted(snippetField.value);
    if (text && !text.includes("{link}")) {
      spokenLines.push({
        voiceKey,
        label: snippetField.label.replace(/^VOICE SNIPPET/, "Voice snippet"),
        text,
      });
    }
  }

  const clickTags = extractClickTags(rawKit.raw);

  return {
    ...base,
    kind: "funnel",
    ...(keyword ? { keyword } : {}),
    ...(account ? { account } : {}),
    ...(clickTags.length > 0 ? { clickTags } : {}),
    fields,
    spokenLines,
  };
}

function generateModule(kits: MarketingKit[], meta: {
  sourcePath: string;
  sha256: string;
  syncedAt: string;
}): string {
  // Key order inside each kit is fixed by construction; kits sort by id —
  // re-syncs diff cleanly.
  const sorted = [...kits].sort((a, b) => a.id - b.id);
  return `// ============================================================================
// AUTO-GENERATED — DO NOT EDIT BY HAND. (scripts/import-marketing-kits.ts)
//
// Source: ${meta.sourcePath} (§6)
// Section sha256: ${meta.sha256}
// Synced: ${meta.syncedAt}
//
// Refresh path: edit the plan md → \`pnpm kits:sync\` → commit this diff.
// Verify drift: \`pnpm kits:sync --check\` (exits 1 when md and module differ).
// ============================================================================
import type { KitSyncMeta, MarketingKit } from "./types";

export const KIT_SYNC_META: KitSyncMeta = ${JSON.stringify(meta, null, 2)};

export const KITS: MarketingKit[] = ${JSON.stringify(sorted, null, 2)};
`;
}

/** Drop the volatile syncedAt bits so --check compares content, not run time. */
function stripVolatile(moduleSource: string): string {
  return moduleSource
    .split("\n")
    .filter((line) => !line.includes("// Synced:") && !line.includes('"syncedAt"'))
    .join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes("--check");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const sourcePath = positional[0] ?? process.env.MARKETING_PLAN_PATH ?? DEFAULT_SOURCE;

  if (!fs.existsSync(sourcePath)) {
    console.error(`[kits:sync] source md not found: ${sourcePath}`);
    console.error("[kits:sync] pass a path argument or set MARKETING_PLAN_PATH.");
    process.exit(1);
  }

  const md = fs.readFileSync(sourcePath, "utf8");
  const section = extractSection6(md);
  const sha256 = createHash("sha256").update(section, "utf8").digest("hex");
  const rawKits = extractRawKits(section);
  if (rawKits.length === 0) {
    console.error("[kits:sync] no '### KIT N — ...' headings found in §6 — refusing to write.");
    process.exit(1);
  }
  const kits = rawKits.map(buildKit);
  const moduleSource = generateModule(kits, {
    sourcePath,
    sha256,
    syncedAt: new Date().toISOString(),
  });

  if (checkMode) {
    if (!fs.existsSync(OUTPUT_PATH)) {
      console.error(`[kits:sync --check] committed module missing: ${OUTPUT_PATH}`);
      process.exit(1);
    }
    const committed = fs.readFileSync(OUTPUT_PATH, "utf8");
    if (stripVolatile(committed) !== stripVolatile(moduleSource)) {
      console.error(
        "[kits:sync --check] DRIFT: the plan md no longer matches the committed module.",
      );
      console.error("[kits:sync --check] run `pnpm kits:sync` and commit the diff.");
      process.exit(1);
    }
    console.log(`[kits:sync --check] clean — ${kits.length} kits match §6 (${sha256.slice(0, 12)}…).`);
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, moduleSource, "utf8");
  console.log(
    `[kits:sync] wrote ${path.relative(process.cwd(), OUTPUT_PATH)} — ${kits.length} kits, §6 sha256 ${sha256.slice(0, 12)}…`,
  );
}

main();
