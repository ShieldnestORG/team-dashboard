# YouTube Slide Design System

This is the canonical brand reference for slide rendering in the YouTube
auto-publish pipeline. The same system governs the public storefront and
the public tutorial decks — see "Source of truth" below.

## Source of truth

The brand is defined in **two** places that already agree:

1. **Storefront** — [`coherencedaddy-landing/app/globals.css`](../../../coherencedaddy-landing/app/globals.css)
   defines the tokens via Tailwind v4's `@theme inline` block. This is the
   live, deployed brand. Changes here must be mirrored to (4) below.
2. **Public tutorial decks** in the
   [`Coherence-Daddy` GitHub org](https://github.com/orgs/Coherence-Daddy/repositories):
   - [`give-claude-a-workflow`](https://github.com/Coherence-Daddy/give-claude-a-workflow) — `index.html`
   - [`give-claude-an-organized-brain`](https://github.com/Coherence-Daddy/give-claude-an-organized-brain) — `index.html`
   - [`use-ollama-to-enhance-claude`](https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude) — `presentation/index.html`

The team-dashboard YouTube pipeline mirrors these tokens in
[`server/src/services/youtube/slide-templates.ts`](../../server/src/services/youtube/slide-templates.ts)
under the `coherencedaddy` template. **When the storefront updates its
tokens, this template must be updated too.**

## Tokens

| Token | Hex / value | Use |
|---|---|---|
| **Rizz Coral** (primary) | `#FF6B4A` | THE accent. Headlines emphasis, active states, key numbers, CTAs |
| Coral pressed | `#E5553A` | `:active` state, inverse hover |
| Coral light | `#FF8A6B` | Subtle highlights |
| **Link Blue** (secondary) | `#5B9DF9` | Links, secondary accents only |
| **Deep Canvas** | `#0E0E10` | Primary dark background. Pure `#000` is BANNED |
| Raised Surface | `#18181B` | Cards, dialogs |
| Surface-2 | `#1D1D20` | Elevated containers |
| **Paper Ink** | `#F2F1ED` | Primary text on dark. Warm off-white, pure `#fff` BANNED |
| Body 70% | `rgba(242,241,237,0.7)` | Body copy |
| Muted Fog | `#A1A1A6` | Captions, metadata |
| Whisper Line | `rgba(255,255,255,0.08)` | 1px structural borders |
| Whisper Strong | `rgba(255,255,255,0.14)` | Inset top highlights |
| Coral glow | `rgba(255,107,74,0.35)` | Active-state halos. Sparingly |
| Success | `#4A9D7C` | Validation checks, passing scores |
| Danger | `#D94343` | Errors, destructive confirms |

### Typography
- **Headline + body**: Geist Sans (400–800 weight). Loaded via Google Fonts
  `@import` in [`buildBaseCss`](../../server/src/services/youtube/slide-templates.ts).
  Inter is **banned** — too generic, used by every AI demo on the internet.
- **Mono**: JetBrains Mono. Used for any number ≥3 digits, timestamps,
  scores, label-caps eyebrows.
- **Letter-spacing**: -0.02em on body, -0.035em on headlines.
- **Eyebrows**: uppercase mono, 0.18em tracking, Rizz Coral, with a 28px
  horizontal leading rule (`::before { width:28px; height:1px; background:coral; }`).
- **Heading ceiling**: 4.5rem. Hierarchy comes from weight + color contrast +
  space — never from gigantic font sizes.

### Geometry
- Radii: 6 / 10 / 16 / 24 px. Slide content cards default to **16px**.
- Spacing scale: 4 / 8 / 16 / 24 / 40 / 64 / 96 px.
- 1px coral left rail at 30% opacity is the canonical visual-rhythm device.

## Visual identity rules

The brand operates in two registers:

1. **Editorial Minimal** (the default for video slides) — calm, type-driven,
   generous whitespace, soft coral accents, never centered hero.
2. **Brutalist Accent** (rare; tutorial deck score breakouts) — sharp 0px
   radius nested inside rounded containers, 2px Paper Ink borders, mono
   caps labels, zero shadow. Reads like a printed coupon.

Default to Editorial Minimal for all video content.

### Banned (do not generate, do not render)
- Pure `#000` or `#fff` anywhere
- Cyan `#00d4ff` (was the previous secondary; ripped out)
- Inter font
- Gradient text on headings
- Circular loading spinners at page scale
- Emojis as decorative elements
- Centered hero compositions
- Coral glow on buttons (glow is reserved for marketing-block halos and
  active-state highlights, never on interactive elements)

## Pipeline behaviour

The slide renderer at
[`presentation-renderer.ts`](../../server/src/services/youtube/presentation-renderer.ts)
uses these tokens via the `SlideTemplate` interface. Two paths produce
slide HTML:

- **AI path** (`buildSlidesFromScriptAI`): Ollama generates HTML per slide
  for **title, hook, section_title, conclusion, and CTA** slides.
  `generateSlideHtml` injects the brand tokens into the system prompt so
  Ollama renders consistently with the brand.
- **Static path** (used for content/bullet slides and as the AI fallback):
  templates in `presentation-renderer.ts` (`staticTemplateBullets`,
  `staticTemplateConclusion`, etc.) render directly from the tokens
  without any LLM call. Bullet cards specifically are always rendered by
  the static template — see commit
  `9fdf4acf` for the rationale (Ollama was producing different HTML per
  highlight state, causing the title and tail text to drift between
  bullet-highlight frames).

## Updating the system

When the storefront updates a token:

1. Edit the relevant `coherencedaddy` field in
   [`slide-templates.ts`](../../server/src/services/youtube/slide-templates.ts).
2. Update the token table in this doc.
3. Trigger one production via `POST /api/youtube/pipeline/run` with
   `YT_PIPELINE_ENABLED=false` still in effect, scp the resulting MP4
   locally, eyeball it.
4. Only after visual confirmation: re-enable the cron.

Do **not** copy fresh tokens from a tutorial deck without first
cross-checking the storefront — the storefront is the live source of truth
and the decks lag it by definition.
