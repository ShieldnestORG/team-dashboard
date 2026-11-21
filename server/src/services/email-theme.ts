// ---------------------------------------------------------------------------
// House email look for everything team-dashboard sends as Coherence Daddy.
//
// The values are PORTED from coherencedaddy-landing `emails/theme.ts` (the
// single source of truth for the Coherence Daddy email look, "campus warm
// paper"). Same hex, same PNG monogram, same coral-rule PNG. Do not invent
// values here: change them in the landing theme first, then mirror them.
//
// Rules carried over from that theme (and checked by __tests__/email-theme.test.ts):
//   • Inline styles + tables only. No flexbox/grid, no web fonts, no SVG.
//   • Brand coral lives in PNGs (top rule, monogram). The one CSS coral surface
//     is the button fallback, and its label is INK, never white (ink on coral is
//     6.8:1, near-white on coral 2.5:1).
//   • Coral is never running text. Links are INK and underlined.
//   • Borders are the neutral HAIRLINE grey, never coloured (Proton's dark mode
//     repaints coloured CSS but cannot touch raster pixels).
//   • Dark mode: the two colour-scheme metas + DARK_MODE_CSS cover Apple Mail
//     and legacy Proton; elements opt in with the .bg-page/.bg-card/.t-* classes,
//     so every text element below carries one.
//
// Two frames:
//   renderCustomerEmail → full letterhead + postal address (+ unsubscribe link
//                         on commercial mail). Customers, affiliates, partners.
//   renderOwnerEmail    → the same look in a light, compact frame for mail that
//                         only the owner reads (alerts, signup notices): quick
//                         to scan, no postal address, no unsubscribe.
//
// Text values are escaped by default (see `h` and the component helpers). Only
// `SafeHtml` — what `h`/`raw` and the helpers return — is inserted verbatim.
// ---------------------------------------------------------------------------

// ── Palette (emails/theme.ts) ───────────────────────────────────────────────

/** Warm paper — the canvas. */
export const PAPER = "#F8F7F4";
/** Charcoal ink — body text, headings, links and the label on coral. */
export const INK = "#0E0E10";
/** Secondary text. */
export const MUTED = "#57554F";
/** Tertiary / legal / footer text. */
export const FAINT = "#8A8780";
/** Rules and borders (neutral grey, opaque). */
export const HAIRLINE = "#E5E2DC";
/** Clean surface — the raised card on the paper canvas. */
export const CARD = "#FFFFFF";
/** Rizz Coral — the accent. Buttons and the top rule; never running text. */
export const CORAL = "#FF6B4A";

/** System stack only — web fonts do not load in most mail clients. */
export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO_STACK = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

/** Dark counterparts of the paper palette (Apple Mail, legacy Proton). */
export const DARK_MODE_CSS = `@media (prefers-color-scheme: dark) {
  .bg-page { background-color: #101017 !important; }
  .bg-card { background-color: #191927 !important; }
  .t-ink { color: #F2F1EE !important; }
  .t-muted { color: #C7C5BF !important; }
  .t-faint { color: #8E8C86 !important; }
}`;

/**
 * Additions to the ported theme (not in the landing's): narrow phones get a bit
 * more room, and in dark mode the hairlines drop to a dark grey instead of
 * glowing as white lines on the dark card.
 */
const RESPONSIVE_CSS = `@media only screen and (max-width: 480px) {
  .px { padding-left: 22px !important; padding-right: 22px !important; }
}
@media (prefers-color-scheme: dark) {
  .hairline { border-top-color: #34343F !important; }
  .chip, .chip * { color: ${INK} !important; }
}`;

// ── Brand assets + legal line ───────────────────────────────────────────────

export const MONOGRAM_URL = "https://coherencedaddy.com/brand/monogram-cd-coral-email.png";
export const CORAL_RULE_URL = "https://coherencedaddy.com/brand/email/coral-rule.png";
export const SITE_URL = "https://coherencedaddy.com";
export const SUPPORT_EMAIL = "info@coherencedaddy.com";
/** CAN-SPAM postal address (owner decision, 2026-11-21). */
export const POSTAL_LINE = "Coherence Daddy · 415 Dairy Rd E413 · Kahului, HI 96732";
/**
 * Unsubscribe target for commercial mail. team-dashboard has no suppression
 * list of its own, so opt-out is by email to the business inbox (a person acts
 * on it); the storefront's tokenized one-click page only edits the storefront's
 * own newsletter list.
 */
export const UNSUBSCRIBE_HREF = `mailto:${SUPPORT_EMAIL}?subject=Unsubscribe`;

// ── Escaping ────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** HTML that is already safe to insert as-is. Only the helpers below create it. */
export class SafeHtml {
  constructor(readonly html: string) {}
  toString(): string {
    return this.html;
  }
}

/** Mark a string as trusted markup (static snippets only — never user text). */
export function raw(html: string): SafeHtml {
  return new SafeHtml(html);
}

export type Content = string | number | SafeHtml;
type Hole = Content | readonly Content[] | null | undefined | false;

function holeToHtml(v: Hole): string {
  if (v == null || v === false) return "";
  if (Array.isArray(v)) return v.map((x) => holeToHtml(x as Hole)).join("");
  if (v instanceof SafeHtml) return v.html;
  return escapeHtml(String(v));
}

/**
 * Tagged template: static markup passes through, every `${value}` is escaped
 * unless it is already `SafeHtml` (component output, or a nested `h``).
 * Arrays are joined; `false`/`null`/`undefined` render nothing, so
 * `${cond && h`…`}` works.
 */
export function h(strings: TemplateStringsArray, ...values: Hole[]): SafeHtml {
  let out = strings[0];
  values.forEach((v, i) => {
    out += holeToHtml(v) + strings[i + 1];
  });
  return new SafeHtml(out);
}

function c(content: Content): string {
  return content instanceof SafeHtml ? content.html : escapeHtml(String(content));
}

// ── Components ──────────────────────────────────────────────────────────────

export function heading(content: Content): SafeHtml {
  // Plain text only: join the last two words with a non-breaking space so a
  // wrapped heading never leaves one word (often half a name) on its own line.
  const inner = typeof content === "string" ? c(content).replace(/ ([^ ]+)$/, "\u00A0$1") : c(content);
  return raw(
    `<h1 class="t-ink" style="margin:0 0 14px;color:${INK};font-size:27px;font-weight:700;letter-spacing:-0.02em;line-height:1.15;">${inner}</h1>`,
  );
}

/** Keep a phrase on one line ("1–2 business days"). */
export function nowrap(content: Content): SafeHtml {
  return raw(`<span style="white-space:nowrap;">${c(content)}</span>`);
}

export function para(content: Content): SafeHtml {
  return raw(
    `<p class="t-muted" style="margin:0 0 16px;color:${MUTED};font-size:15px;line-height:1.7;">${c(content)}</p>`,
  );
}

/** A bold lead-in line ("What happens next:") in ink. */
export function lead(content: Content): SafeHtml {
  return raw(
    `<p class="t-ink" style="margin:22px 0 8px;color:${INK};font-size:15px;font-weight:600;line-height:1.5;">${c(content)}</p>`,
  );
}

/** Small uppercase label above a value ("YOUR API KEY"). */
export function label(content: Content): SafeHtml {
  return raw(
    `<p class="t-muted" style="margin:16px 0 4px;color:${MUTED};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">${c(content)}</p>`,
  );
}

/** Small meta line under a title (alert type, timestamp). */
export function meta(content: Content): SafeHtml {
  return raw(
    `<p class="t-muted" style="margin:0 0 14px;color:${MUTED};font-size:12px;line-height:1.5;">${c(content)}</p>`,
  );
}

/** Small print under a call to action. */
export function note(content: Content): SafeHtml {
  return raw(
    `<p class="t-muted" style="margin:20px 0 0;color:${MUTED};font-size:13px;line-height:1.6;">${c(content)}</p>`,
  );
}

export function rule(): SafeHtml {
  return raw(`<hr class="hairline" style="margin:28px 0;border:none;border-top:1px solid ${HAIRLINE};height:0;" />`);
}

export function bulletList(items: readonly Content[]): SafeHtml {
  const lis = items
    .map(
      (it) =>
        `<li class="t-muted" style="margin:0 0 8px;color:${MUTED};">${c(it)}</li>`,
    )
    .join("");
  return raw(
    `<ul class="t-muted" style="margin:0 0 16px;padding-left:20px;color:${MUTED};font-size:15px;line-height:1.7;">${lis}</ul>`,
  );
}

/** Ink, underlined link (the house link style). */
export function link(href: string, text: Content): SafeHtml {
  return raw(
    `<a class="t-ink" href="${escapeHtml(href)}" style="color:${INK};text-decoration:underline;">${c(text)}</a>`,
  );
}

export function secondaryLink(href: string, text: Content): SafeHtml {
  return raw(`<p style="margin:14px 0 0;font-size:13px;line-height:1.6;">${link(href, text).html}</p>`);
}

/**
 * Coral call to action: a table cell with the coral fill and an INK label.
 * (The landing's pre-rendered PNG buttons only exist for its own fixed labels;
 * this is the CSS fallback path from its theme. The marker comment lets the
 * plain-text renderer print "Label: url".)
 */
export function ctaButton(href: string, text: Content): SafeHtml {
  return raw(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;"><tr>` +
      `<td bgcolor="${CORAL}" style="background:${CORAL};border-radius:10px;">` +
      `<a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 26px;color:${INK};font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;"><!--cta-->${c(text)}</a>` +
      `</td></tr></table>`,
  );
}

/** Monospace chip for keys, references and quoted evidence. */
export function monoBox(content: Content, opts: { pre?: boolean } = {}): SafeHtml {
  const ws = opts.pre ? "white-space:pre-wrap;" : "";
  return raw(
    `<div class="chip" style="margin:16px 0;background:${PAPER};border:1px solid ${HAIRLINE};border-radius:10px;padding:14px 16px;font-family:${MONO_STACK};font-size:12px;line-height:1.5;color:${INK};word-wrap:break-word;overflow-wrap:anywhere;word-break:break-word;${ws}">${c(content)}</div>`,
  );
}

/** Inline code (endpoint paths). */
export function code(content: Content): SafeHtml {
  return raw(
    `<code class="t-ink" style="font-family:${MONO_STACK};font-size:13px;color:${INK};">${c(content)}</code>`,
  );
}

/** Label/value rows (owner notices). The marker comment becomes ": " in plain text. */
export function dataTable(rows: ReadonlyArray<readonly [string, Content]>): SafeHtml {
  const trs = rows
    .map(
      ([k, v]) =>
        `<tr><td class="t-muted" style="padding:5px 18px 5px 0;color:${MUTED};font-size:14px;line-height:1.5;vertical-align:top;">${escapeHtml(k)}</td><!--:--><td class="t-ink" style="padding:5px 0;color:${INK};font-size:14px;line-height:1.5;">${c(v)}</td></tr>`,
    )
    .join("");
  return raw(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 8px;">${trs}</table>`,
  );
}

// ── Frames ──────────────────────────────────────────────────────────────────

const FOOT = `font-size:11px;line-height:1.6;letter-spacing:0.03em;`;

function page(title: string, rows: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(title)}</title>
<style>${DARK_MODE_CSS}
${RESPONSIVE_CSS}</style>
</head>
<body class="bg-page" style="margin:0;padding:0;background:${PAPER};font-family:${FONT_STACK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-page" bgcolor="${PAPER}" style="background:${PAPER};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="532" cellpadding="0" cellspacing="0" border="0" class="bg-card" bgcolor="${CARD}" style="width:100%;max-width:532px;background:${CARD};border-radius:14px;overflow:hidden;">
<tr><td style="padding:0;font-size:0;line-height:0;"><img src="${CORAL_RULE_URL}" alt="" width="532" height="4" style="display:block;width:100%;height:4px;border:0;" /></td></tr>
${rows}
</table>
</td></tr>
</table>
</body>
</html>`;
}

export type CustomerKind = "transactional" | "commercial";

/**
 * Full letterhead for mail to customers, affiliates and partners.
 * `commercial` adds the unsubscribe link; both carry the postal address.
 */
export function renderCustomerEmail(opts: {
  title: string;
  body: SafeHtml;
  kind: CustomerKind;
}): { html: string; text: string } {
  const reason =
    opts.kind === "commercial"
      ? "You’re receiving this email because you signed up or started a checkout with Coherence&nbsp;Daddy."
      : "You’re receiving this email because of your activity with Coherence&nbsp;Daddy.";
  const links =
    opts.kind === "commercial"
      ? `${link(SITE_URL, "coherencedaddy.com").html}</p>
<p class="t-faint" style="margin:6px 0 0;color:${FAINT};${FOOT}">${link(UNSUBSCRIBE_HREF, "Unsubscribe").html}`
      : `${link(SITE_URL, "coherencedaddy.com").html} · ${link(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL).html}`;
  const rows = `<tr><td class="px" style="padding:30px 36px 4px;"><img src="${MONOGRAM_URL}" width="38" height="38" alt="Coherence Daddy" style="display:block;margin-bottom:10px;border:0;" /><p class="t-ink" style="margin:0;color:${INK};font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">Coherence Daddy</p></td></tr>
<tr><td class="px" style="padding:20px 36px 28px;color:${MUTED};font-size:15px;line-height:1.7;">
${opts.body.html}
</td></tr>
<tr><td class="px hairline" style="padding:22px 36px 28px;border-top:1px solid ${HAIRLINE};">
<p class="t-faint" style="margin:0 0 6px;color:${FAINT};${FOOT}">${reason}</p>
<p class="t-faint" style="margin:0 0 6px;color:${FAINT};${FOOT}">${escapeHtml(POSTAL_LINE).replace("HI 96732", "HI&nbsp;96732")}</p>
<p class="t-faint" style="margin:0;color:${FAINT};${FOOT}">${links}</p>
</td></tr>`;
  const html = page(opts.title, rows);
  return { html, text: htmlToText(html) };
}

/**
 * Light, compact frame for mail only the owner reads. Quick to scan: a small
 * header, the title, then the content. No postal address, no unsubscribe.
 * `text` overrides the derived plain-text part (alerts keep their exact body).
 */
export function renderOwnerEmail(opts: {
  title: string;
  label?: string;
  body: SafeHtml;
  text?: string;
}): { html: string; text: string } {
  const tag = opts.label
    ? `<br /><span class="t-muted" style="color:${MUTED};font-size:11px;font-weight:600;letter-spacing:0.14em;">${escapeHtml(opts.label)}</span>`
    : "";
  const rows = `<tr><td class="px" style="padding:22px 28px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0 12px 0 0;vertical-align:middle;"><img src="${MONOGRAM_URL}" width="30" height="30" alt="Coherence Daddy" style="display:block;border:0;" /></td><td class="t-ink" style="vertical-align:middle;color:${INK};font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;line-height:1.5;">Coherence Daddy${tag}</td></tr></table></td></tr>
<tr><td class="px" style="padding:18px 28px 22px;">
<h1 class="t-ink" style="margin:0 0 14px;color:${INK};font-size:22px;font-weight:700;letter-spacing:-0.01em;line-height:1.25;">${escapeHtml(opts.title)}</h1>
${opts.body.html}
</td></tr>
<tr><td class="px hairline" style="padding:14px 28px 22px;border-top:1px solid ${HAIRLINE};">
<p class="t-faint" style="margin:0;color:${FAINT};${FOOT}">Owner-only message from Team Dashboard.</p>
</td></tr>`;
  const html = page(opts.title, rows);
  return { html, text: opts.text ?? htmlToText(html) };
}

// ── Plain text ──────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Deterministic HTML → plain text for the text/plain part of every send.
 * Links print as "label (url)", the call to action as "Label: url", list items
 * as "- item", label/value rows as "Label: value". Entities are decoded.
 */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--:-->/g, "\u0001") // label/value separator survives comment stripping
    .replace(/<!--cta-->/g, "\u0002")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ");

  s = s.replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const url = decodeEntities(href);
    const isCta = inner.includes("\u0002");
    const text = decodeEntities(inner.replace(/\u0002/g, "").replace(/<[^>]*>/g, "")).trim();
    if (isCta) return `\n\n${text.replace(/\s*→\s*$/, "")}: ${url}\n\n`;
    if (!text) return url;
    if (text === url || (url.startsWith("mailto:") && url.slice(7).split("?")[0] === text)) return text;
    return `${text} (${url})`;
  });

  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|table|ul|ol)>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\u0001/g, ": ");

  s = decodeEntities(s)
    .replace(/\u00A0/g, " ")
    .split("\n")
    .map((line) => line.replace(/^ +/, "").replace(/ +$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}
