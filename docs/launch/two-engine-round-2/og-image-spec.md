# OG Image Spec — Per-Tutorial

For the `/tutorials/use-ollama-to-enhance-claude` page. Static `1200×630` PNG, sRGB. Save to wherever the storefront expects per-tutorial OG art (commonly `app/tutorials/[slug]/opengraph-image.tsx` or a static file in `public/og/`).

## Dimensions + format

- **Size:** exactly 1200×630 px (the canonical OG ratio Twitter, LinkedIn, Slack, Discord all unfurl correctly).
- **Format:** PNG-24, no transparency.
- **Max file size:** under 1MB. Twitter caps OG images at 5MB but unfurls slow > 1MB.

## Color tokens (verified from `coherencedaddy-landing/app/globals.css`)

| Token | Hex | Use |
|---|---|---|
| `--background` Warm Paper | `#F8F7F4` | Card body / canvas |
| `--foreground` Charcoal Ink | `#0E0E10` | Primary text, brand stamp |
| `--primary` Rizz Coral | `#FF6B4A` | Accent pill, key word highlight, badge background |
| `--primary-foreground` | `#F2F1ED` | Text on coral |
| `--muted-foreground` | `#6B6B70` | Subtitle / supporting line |
| `--border` | `rgba(14, 14, 16, 0.08)` | Inner card stroke if needed |

Fonts: **Geist Sans** for headline, **Geist Mono** for the badge / monospace bits. Both already loaded in the storefront.

## Layout (1200×630, all coordinates from top-left)

```
┌────────────────────────────────────────────────────────────┐
│ [80px padding]                                             │
│                                                            │
│  COHERENCE DADDY · TUTORIAL                                │  ← y≈90, Geist Mono 22px, --muted-foreground
│                                                            │
│  Two-Engine Setup:                                         │  ← y≈170, Geist 72px bold, --foreground
│  Cut Your Claude Code Bill ~90%                            │  ← y≈250, Geist 72px bold, "~90%" in coral
│                                                            │
│  Pair Claude Desktop with Claude Code routed               │  ← y≈360, Geist 28px regular, --muted-foreground
│  through Ollama. Free 21-slide visual setup.               │
│                                                            │
│                                                            │
│  ┌─ ANTHROPIC · paid ─┐  ┌─ OLLAMA · free ─┐               │  ← y≈480, two pills, mono 18px
│                                                            │
│                                                            │
│                          [face mark] coherencedaddy.com    │  ← bottom-right, y≈560, x≈900
└────────────────────────────────────────────────────────────┘
```

## Copy block (verbatim)

- Eyebrow: `COHERENCE DADDY · TUTORIAL`
- Headline (two lines): `Two-Engine Setup:` / `Cut Your Claude Code Bill ~90%`
  - In line 2, render `~90%` in `--primary` (`#FF6B4A`); rest in `--foreground`.
- Subhead: `Pair Claude Desktop with Claude Code routed through Ollama. Free 21-slide visual setup.`
- Pills (mono, all caps):
  - Left: `ANTHROPIC · paid` — bg `#FF6B4A`, text `#F2F1ED`, radius 9999px (pill), padding 8px 16px.
  - Right: `OLLAMA · free` — bg `#F8F7F4`, 1px stroke `#0E0E10` at 12% alpha, text `#0E0E10`, same shape.
- Brand stamp (bottom-right corner, 80px from edges):
  - The Coherence Daddy face mark (use `cd-face-coral.png` from the presentation/ folder, scale to 56×56) + the wordmark `coherencedaddy.com` in Geist Mono 18px `--foreground`.

## Brand stamp placement rules

- Always bottom-right. Never top, never centered. This is a Coherence Daddy convention — stay consistent across all tutorial OG art so the brand becomes recognizable in feeds.
- Minimum 60px from the right edge and 60px from the bottom edge.
- Never put the stamp on a coral background. Always on `--background` or `--card`.

## Implementation note

If generating dynamically via `next/og` `ImageResponse`, mirror this layout in JSX. If exporting static, use Figma → export at 2× → downscale to 1200×630 to keep type sharp.
