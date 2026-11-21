// ---------------------------------------------------------------------------
// House email look — theme module contract.
//
// The values are ported from coherencedaddy-landing emails/theme.ts (the
// single source of truth for the Coherence Daddy email look). If a value here
// drifts from there, the emails stop matching the storefront's.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  PAPER,
  INK,
  MUTED,
  FAINT,
  HAIRLINE,
  CARD,
  CORAL,
  MONOGRAM_URL,
  CORAL_RULE_URL,
  POSTAL_LINE,
  UNSUBSCRIBE_HREF,
  escapeHtml,
  h,
  raw,
  htmlToText,
  heading,
  para,
  link,
  ctaButton,
  monoBox,
  renderCustomerEmail,
  renderOwnerEmail,
} from "../services/email-theme.js";
import {
  expectBrandHeader,
  expectInkOnCoral,
  expectInkUnderlinedLinks,
  expectKitPaletteOnly,
  expectPngImagesOnly,
} from "./helpers/email-assert.js";

describe("palette + brand assets", () => {
  it("uses the exact hex values of coherencedaddy-landing emails/theme.ts", () => {
    expect({ PAPER, INK, MUTED, FAINT, HAIRLINE, CARD, CORAL }).toEqual({
      PAPER: "#F8F7F4",
      INK: "#0E0E10",
      MUTED: "#57554F",
      FAINT: "#8A8780",
      HAIRLINE: "#E5E2DC",
      CARD: "#FFFFFF",
      CORAL: "#FF6B4A",
    });
  });

  it("points at the PNG monogram, the PNG coral rule, and the Kahului postal address", () => {
    expect(MONOGRAM_URL).toBe("https://coherencedaddy.com/brand/monogram-cd-coral-email.png");
    expect(CORAL_RULE_URL).toBe("https://coherencedaddy.com/brand/email/coral-rule.png");
    expect(POSTAL_LINE).toBe("Coherence Daddy · 415 Dairy Rd E413 · Kahului, HI 96732");
    expect(UNSUBSCRIBE_HREF).toBe("mailto:info@coherencedaddy.com?subject=Unsubscribe");
  });
});

describe("escaping", () => {
  it("escapes & < > \" ' in text", () => {
    expect(escapeHtml(`a<b>&"c'd`)).toBe("a&lt;b&gt;&amp;&quot;c&#39;d");
  });

  it("h`` escapes interpolated values but not its own markup or already-safe html", () => {
    const evil = `<script>alert(1)</script>`;
    const out = h`<p>Hi <strong>${evil}</strong> ${raw("<em>ok</em>")}</p>`.html;
    expect(out).toBe("<p>Hi <strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong> <em>ok</em></p>");
  });

  it("heading/para/link escape plain strings and accept safe html", () => {
    expect(heading("Hi <x>").html).toContain("Hi\u00A0&lt;x&gt;"); // last two words stay together
    expect(heading("Hello there friend").html).toContain("there\u00A0friend");
    expect(para("a & b").html).toContain("a &amp; b");
    expect(para(h`a <strong>b</strong>`).html).toContain("a <strong>b</strong>");
    expect(link(`https://x.test/?a=1&b="2"`, "go <now>").html).toContain(
      `href="https://x.test/?a=1&amp;b=&quot;2&quot;"`,
    );
    expect(link("https://x.test", "go <now>").html).toContain(">go &lt;now&gt;</a>");
  });
});

describe("components follow the kit rules", () => {
  it("the CTA is ink on coral inside a coral table cell (never white on coral)", () => {
    const html = ctaButton("https://coherencedaddy.com/x", "Open it").html;
    expect(html).toContain(`bgcolor="${CORAL}"`);
    expect(html).toContain(`color:${INK}`);
    expectInkOnCoral(html);
    expectKitPaletteOnly(html);
  });

  it("links are ink and underlined, with the dark-mode hook class", () => {
    const html = link("https://coherencedaddy.com", "Coherence Daddy").html;
    expect(html).toContain(`color:${INK}`);
    expect(html).toContain("text-decoration:underline");
    expect(html).toContain('class="t-ink"');
    expectInkUnderlinedLinks(html);
  });

  it("chips stay ink on paper in dark mode too (text and links inside them)", () => {
    const html = renderCustomerEmail({ title: "t", body: h`${monoBox(link("https://x.test/a", "https://x.test/a"))}`, kind: "transactional" }).html;
    expect(html).toContain('class="chip"');
    expect(html).toMatch(/\.chip, \.chip \* \{ color: #0E0E10 !important; \}/);
  });

  it("monoBox is a paper chip with a neutral hairline border and ink text", () => {
    const html = monoBox("cd_live_123").html;
    expect(html).toContain(PAPER);
    expect(html).toContain(HAIRLINE);
    expect(html).toContain(INK);
    expect(html).toContain("overflow-wrap:anywhere"); // wraps at spaces first, inside a word only when it must
    expectKitPaletteOnly(html);
  });
});

describe("renderCustomerEmail", () => {
  const body = h`${heading("Welcome, Alex!")}${para("Your account is ready.")}${ctaButton("https://coherencedaddy.com/go", "Go")}`;

  it("transactional: monogram + coral rule + postal address, no unsubscribe", () => {
    const { html } = renderCustomerEmail({ title: "A & B <title>", body, kind: "transactional" });
    expectBrandHeader(html);
    expect(html.replace(/&nbsp;/g, " ")).toContain(POSTAL_LINE);
    expect(html).not.toMatch(/unsubscribe/i);
    expect(html).toContain("<title>A &amp; B &lt;title&gt;</title>");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toMatch(/\.hairline \{ border-top-color: #34343F !important; \}/);
    expect(html).toMatch(/<td class="px hairline"/);
    expectKitPaletteOnly(html);
    expectPngImagesOnly(html);
    expectInkOnCoral(html);
    expectInkUnderlinedLinks(html);
  });

  it("commercial: adds a working unsubscribe link under the address", () => {
    const { html, text } = renderCustomerEmail({ title: "Hello", body, kind: "commercial" });
    expect(html.replace(/&nbsp;/g, " ")).toContain(POSTAL_LINE);
    expect(html).toContain(`href="${UNSUBSCRIBE_HREF}"`);
    expect(html).toMatch(/>Unsubscribe<\/a>/);
    expect(text).toContain("Unsubscribe");
    expect(text).toContain(UNSUBSCRIBE_HREF);
    expectInkUnderlinedLinks(html);
  });

  it("returns a plain-text part that carries the content, the address and no markup", () => {
    const { text } = renderCustomerEmail({ title: "Hello", body, kind: "transactional" });
    expect(text).toContain("Welcome, Alex!");
    expect(text).toContain("Your account is ready.");
    expect(text).toContain("Go: https://coherencedaddy.com/go");
    expect(text).toContain(POSTAL_LINE);
    expect(text).not.toMatch(/<[a-z!/]/i);
    expect(text).not.toMatch(/&[a-z#0-9]+;/i);
  });
});

describe("renderOwnerEmail (light branded frame for owner-only mail)", () => {
  it("has the monogram + coral rule, no postal address and no unsubscribe", () => {
    const { html, text } = renderOwnerEmail({
      title: "Ollama is down",
      label: "Alert",
      body: h`${monoBox("line 1\nline 2")}`,
    });
    expectBrandHeader(html);
    expect(html.replace(/&nbsp;/g, " ")).not.toContain(POSTAL_LINE);
    expect(html).not.toMatch(/unsubscribe/i);
    expect(html).toContain("Ollama is down");
    expectKitPaletteOnly(html);
    expectPngImagesOnly(html);
    expect(text).toContain("Ollama is down");
    expect(text).toContain("line 1");
  });
});

describe("htmlToText", () => {
  it("renders links, lists, headings and entities as readable plain text", () => {
    const t = htmlToText(
      `<h1>Title &amp; more</h1><p>See <a href="https://x.test/a?b=1&amp;c=2">the docs</a>.</p>` +
        `<ul><li>One</li><li>Two</li></ul><p>Mail <a href="mailto:info@coherencedaddy.com">info@coherencedaddy.com</a></p>`,
    );
    expect(t).toContain("Title & more");
    expect(t).toContain("See the docs (https://x.test/a?b=1&c=2).");
    expect(t).toContain("- One");
    expect(t).toContain("- Two");
    expect(t).toContain("Mail info@coherencedaddy.com");
    expect(t).not.toContain("mailto:info@coherencedaddy.com)");
  });

  it("collapses runs of blank lines and trims", () => {
    expect(htmlToText("<p>a</p>\n\n\n<p>b</p>")).toBe("a\n\nb");
  });
});
