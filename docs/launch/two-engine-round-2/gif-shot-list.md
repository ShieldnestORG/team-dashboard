# Hero GIF — Shot List

Goal: a 6–10s looping GIF of the **verify-both-engines** moment. This is the climax slide of the 21-slide deck made real. Drop it in the GitHub README at `assets/verify-demo.gif` and reuse it on Discord posts.

## Window layout

- Aspect ratio: **16:9**, target render 1280×720 → downscale.
- Split screen, exactly 50/50:
  - **Left pane:** Anthropic Claude Desktop (the native Mac app), conversation already loaded with one short prompt visible (e.g., "Write me a haiku about coherent code.").
  - **Right pane:** macOS Terminal (or iTerm2) with `claude` (Claude Code) running, configured to point at Ollama.
- Both panes anchored to the screen edges, no dock/menu bar bleeding in. Hide notifications. Light-mode in both apps to match Coherence Daddy brand (warm paper background).

## Exact commands

### Right pane (Claude Code → Ollama) — keystroke sequence

```bash
# Already cd'd into a tiny demo repo. Prompt is fresh.
claude
# (Claude Code starts; model line shows "ollama/gemma:7b" in the status bar)
> verify both engines: tell me which model you're running on and lint ./hello.js
```

Wait for the response to start streaming. Cut once 2–3 lines of output have appeared.

### Left pane (Anthropic Claude Desktop) — same beat

Type or have prefilled:
```
Quick check — which Anthropic model am I talking to right now?
```
Hit return roughly **0.5s after** the right pane fires. Both responses should begin streaming nearly simultaneously — that's the money shot.

## Captions / overlay

- Top-left overlay (left pane): `ANTHROPIC · paid` in white-on-coral pill (`#FF6B4A` bg, `#FFFFFF` text, 14px Geist Mono).
- Top-right overlay (right pane): `OLLAMA · free` in coral-on-paper pill (`#FFFFFF` bg, `#FF6B4A` text, same font).
- Bottom-center, fade-in at 4s, fade-out at 7s: **"Two engines. Same UX. One bill cut ~90%."** in Geist 18px, charcoal `#0E0E10`.
- No logo overlay — let the slide deck do branding work elsewhere.

## Recording tool

**Recommended: [Kap](https://getkap.co/)** for macOS. Records to `.mp4`, easy crop to 1280×720, export at 30fps.
Backup: QuickTime → File → New Screen Recording → crop in post.

## ffmpeg conversion to GIF

GitHub README inline images cap at ~10MB; aim for **<8MB** to stay safe.

```bash
# input: verify-demo.mp4 (1280x720, 30fps, 6-10s)
# output: verify-demo.gif at 12fps, palette-optimized, ~3-6MB

ffmpeg -i verify-demo.mp4 -vf "fps=12,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" -loop 0 verify-demo.gif

# If file is still > 8MB, drop fps to 10 and width to 800:
# fps=10,scale=800:-1
```

Verify size: `ls -lh verify-demo.gif`. Commit to `assets/verify-demo.gif` in the repo and link from README near the top, right under the badges.

## Loop notes

- Trim so the start frame ≈ end frame (both panes idle, prompts visible, no streaming text yet) — this makes the loop feel intentional rather than a hard cut.
- Test the loop in Quick Look before committing.
