# YouTube Speed Test — Side-by-Side Script (CD-63)

**Format:** 16:9 horizontal, 1920×1080.
**Length:** 90 seconds. Hard ceiling 120.
**Title (suggested):** `Claude Code vs claude-gemma — same lint task, side by side`
**Description includes:** repo link, hosted tutorial link, MIT note.

The video's job: make the cost difference visceral. One side shows a token cost ticker climbing. The other side shows `$0.00` flat. That's the whole pitch.

---

## 0:00 — 0:05 — Cold open

**Shot:** Black screen. Title card fades in.
**On-screen text:** `Same task. Two engines. One bill.`
**VO:** "Quick experiment. Same lint task, two ways."

---

## 0:05 — 0:15 — Setup

**Shot:** Split screen, 50/50.
- **Left:** terminal labeled `ANTHROPIC · Sonnet 4.5`. Cost ticker pinned top-right showing `$0.0000`.
- **Right:** terminal labeled `OLLAMA · gemma:7b`. Cost ticker pinned top-right showing `$0.0000` permanently.
**On-screen text:** `Task: lint and fix 47 files in this repo.`
**VO:** "On the left, Claude Code on Anthropic Sonnet. On the right, the same Claude Code routed through Ollama Gemma 7B running locally. Both got the same prompt: lint and fix every file in this repo."

---

## 0:15 — 0:50 — The race (sped up 2-3×)

**Shot:** Both panes stream output simultaneously. Cost ticker on the left climbs in real time as tokens roll. Cost ticker on the right stays at `$0.0000`.

**On-screen overlays as they happen:**
- (file count progress bar at the bottom of each pane)
- (~0:30) `LEFT: $0.18 · 12/47 files` / `RIGHT: $0.0000 · 14/47 files`
- (~0:45) `LEFT: $0.41 · 30/47 files` / `RIGHT: $0.0000 · 33/47 files`

**VO** (over the race): "Both are streaming. Both are getting the work done. The cost ticker on the left is doing what cost tickers do."

---

## 0:50 — 1:05 — The result

**Shot:** Both panes finish. Final numbers freeze on screen in big type.
**On-screen text (full screen, swap from split):**
```
ANTHROPIC: $<your-actual-cost> · 47/47 files
OLLAMA:    $0.00 · 47/47 files
```
**VO:** "Same outcome. Different bill."

> Note: don't fabricate a specific dollar amount. Use whatever the real Anthropic-side cost was during the recording. If you didn't measure, leave the placeholder and add it in post.

---

## 1:05 — 1:25 — The honest caveat

**Shot:** Talking-head camera if available, otherwise the host's terminal with a single `# caveat:` comment.
**On-screen text:** `When does this break down?`
**VO:** "Caveat — Gemma 7B is not Sonnet. For real reasoning, multi-file refactors, hairy debugging, you still want the frontier model. The point isn't 'replace Anthropic.' The point is: stop burning quota on mechanical work that any decent local model can handle. Lints, formatting, grep-and-replace, batch ops — all candidates."

---

## 1:25 — 1:30 — CTA

**Shot:** Coherence Daddy face mark + URL card.
**On-screen text:**
- `Full setup: coherencedaddy.com/tutorials/use-ollama-to-enhance-claude`
- `Repo: github.com/Coherence-Daddy/use-ollama-to-enhance-claude`
- `MIT. No email gate.`
**VO:** "Full setup linked below. MIT, free, no email gate."

---

## Production notes

- The cost ticker on the Anthropic side is the visual hero. Build it as a small overlay app (or in OBS as a text source updated by a script that polls token counts). If real-time is too hard, fake it post-hoc with a smooth count-up animation that matches the actual final number.
- Record both panes simultaneously — same wall clock. Don't run them sequentially and edit them together; viewers can tell.
- 2-3× speed-up during the race is fine and expected. Add a `2×` chip in the corner during sped-up sections.
- Lint task should be real. Use a public throwaway repo so the audit is reproducible if anyone challenges the result.
