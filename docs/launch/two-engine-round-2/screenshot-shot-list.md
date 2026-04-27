# Screenshot Shot List — 5 Hero Slides

All screenshots are taken from the live deck at https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude (or `presentation/index.html` locally — they're identical).

Final dimensions: **1200×675** (16:9, OG-friendly, also fits Twitter inline images cleanly).
Format: PNG, sRGB, no transparency.
Save to: `/Users/exe/Downloads/Claude/team-dashboard/docs/launch/two-engine-round-2/screenshots/`

| # | Slide | Filename | Crop / framing | Highlight |
|---|---|---|---|---|
| 1 | **Cover** (slide 1 of 21) | `01-cover.png` | Full slide, edge-to-edge. The Coherence Daddy face mark is bottom-right; keep it in frame. | None — let the title "Two-Engine Setup" carry it. |
| 2 | **The problem** (slide 3 — "Claude Code eats your quota") | `02-problem.png` | Full slide. If a "burned through in 9 days" stat is on screen, make sure it's centered. | Soft red glow / underline behind the cost number using Photoshop or Preview annotate (`#D94343` at 30% opacity). |
| 3 | **Install Ollama** (slide ~8 — the install step where the OS auto-detect chip is visible) | `03-install.png` | Crop to show the OS-detect chip + the install command block. Trim ~10% off the slide chrome if the deck has letterbox. | Yellow highlight box around the active-OS chip (e.g., "macOS detected"). |
| 4 | **Router config** (slide ~14 — `~/.claude/router.json` or the equivalent config block) | `04-router-config.png` | Tight crop on the JSON / TOML block. Keep 40px padding on all sides. Mono font must render crisp — record at 2× retina then downscale. | Coral arrow (`#FF6B4A`) pointing at the `model: "ollama/gemma:7b"` line. |
| 5 | **Verify both engines** (slide 20 — the climactic two-pane verify) | `05-verify.png` | Full slide. This is the same composition as the hero GIF, just static. | Two pill labels burned in: `ANTHROPIC · paid` (left), `OLLAMA · free` (right), same color spec as the GIF overlays. |

## Capture method

- macOS: `Cmd+Shift+4` → spacebar → click slide window → results land on Desktop.
- Open each in Preview → Tools → Adjust Size → exactly **1200×675** (uncheck "Resample" only if source is bigger; otherwise resample with bicubic).
- If the source slide is 16:10 or 4:3, prefer cropping over squishing — keep the title and key visual centered.

## Brand stamp

The deck already has the "Coherence Daddy" sidebar credit on every slide. Don't add a second watermark. If a screenshot accidentally crops the stamp out, restore it before exporting — it's a non-negotiable on every public asset.

## Naming + alt-text crib

When uploaded to X/Reddit, use these alt-text strings (accessibility + SEO):

1. `01-cover.png` → "Two-Engine Setup cover slide: pair Claude Desktop with Claude Code routed through Ollama."
2. `02-problem.png` → "Claude Code burns through Pro quota fast — chart of typical monthly usage."
3. `03-install.png` → "Install Ollama step with OS auto-detect chip selecting macOS."
4. `04-router-config.png` → "claude-code router config pointing the default model at ollama/gemma:7b."
5. `05-verify.png` → "Side-by-side terminal verify: Anthropic on the left, Ollama on the right, both responding."
