# YouTube Short / TikTok / Reels — 60-90s Script

**Caption:** `Free Claude Code in 90 seconds.`
**Aspect ratio:** 9:16 vertical, 1080×1920.
**Length target:** 75 seconds. Hard ceiling 90.
**Music:** low-energy lo-fi or ambient — under -18LUFS so the voiceover sits on top. No copyrighted tracks.

---

## Hook (0:00 — 0:03)

**Shot:** Tight on a terminal showing a Claude Code session, with a fake "monthly usage: 87%" indicator burned in the top corner.
**On-screen text (large, top half):** `Claude Code burning your Pro quota?`
**VO:** "If Claude Code is eating your monthly limit, you don't have to pay for it."

The hook has to make the viewer not swipe in 3 seconds. Cost frustration + immediate promise of fix.

---

## 0:03 — 0:10 — The reveal

**Shot:** Pull back to split screen. Left: Claude Desktop. Right: terminal with Claude Code.
**On-screen text:** `Two engines. Same UX.`
**VO:** "Keep Claude Pro for thinking. Route the terminal stuff through a free local model."

---

## 0:10 — 0:25 — Step 1: Install Ollama

**Shot:** Screen recording of running `brew install ollama` on macOS, then `ollama pull gemma:7b`.
**On-screen text (timed):**
- `1. Install Ollama` (0:10)
- `brew install ollama` (0:13, mono font, coral background)
- `ollama pull gemma:7b` (0:18)
**VO:** "Step one: install Ollama, pull a model. Gemma, Qwen, DeepSeek — your pick. Free."

---

## 0:25 — 0:40 — Step 2: Router config

**Shot:** Editor view of `~/.claude/router.json` being written. Coral arrow pointing at `"model": "ollama/gemma:7b"`.
**On-screen text:**
- `2. Point Claude Code at Ollama` (0:25)
- (config block visible) (0:28)
**VO:** "Step two: point Claude Code's router at your local model. One JSON block. The copy-paste prompt writes it for you if you don't want to touch the file."

---

## 0:40 — 0:55 — Step 3: Verify

**Shot:** Same hero GIF composition — Claude Desktop on left, Claude Code on right, both responding side by side.
**On-screen text:**
- `3. Verify both engines` (0:40)
- Pill labels: `ANTHROPIC · paid` (left), `OLLAMA · free` (right) (0:44)
**VO:** "Step three: prove it works. Run a prompt on each side. Both stream. One bills you. The other is free."

---

## 0:55 — 1:10 — The number

**Shot:** Big number on screen. Animated count-up from 0% to 90%.
**On-screen text:** `~90% Claude Code bill cut`
**VO:** "About a ninety percent cut on Claude Code spending. Same workflow. No new tools to learn."

---

## 1:10 — 1:15 — CTA

**Shot:** Coherence Daddy face mark, URL on screen.
**On-screen text:**
- `coherencedaddy.com/tutorials`
- `Free 21-slide setup. MIT.`
**VO:** "Full tutorial — Coherence Daddy dot com slash tutorials. Free, MIT licensed, copy-paste prompt included."

---

## Production notes

- Record terminal at 2× retina, scale down — text crispness is everything on vertical.
- Voiceover: one continuous take, then trim to fit. Don't punch in.
- Burned-in captions for the 60% of viewers who watch with sound off. Use Geist Mono, white text, 6px black stroke.
- End frame should hold for 1.5s on the URL — gives the algorithm a clean cut to the next short.
- Cross-post to TikTok, YouTube Shorts, and Instagram Reels the same day. Use the same caption everywhere. Add `#claudecode #ollama #ai #freetools #opensource` on TikTok/Reels (not on Shorts — Shorts hashtags don't help).
