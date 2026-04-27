# X / Twitter Thread — 7 tweets

**Posting time:** Sunday evening Eastern, **7:30–8:30pm ET**. That window catches US devs winding down + EU devs at Monday morning coffee. Avoid posting during NFL primetime in fall.

**Personal handle:** `@<your-personal-x-handle>` (placeholder — fill in before posting).
**Brand handle:** `@coherencedaddy`.
**Tag once, in T7:** `@AnthropicAI` and `@ollama`. Tagging earlier looks needy and X de-ranks it.

Attach **one image per tweet** for T1–T6, using the screenshots from `screenshot-shot-list.md`. T7 is text-only with two links.

Character counts assume t.co URL shortening (each link = 23 chars).

---

### T1 — Hook (attach `01-cover.png`)

```
I cut my Claude Code bill ~90% by routing terminal-only tasks through a free local model.

Same UX. Two engines. Strategy stays on Claude Pro, the heavy lifting runs on Gemma via Ollama.

Full visual setup + copy-paste prompt below.
```

**Char count: 232 / 280**

---

### T2 — The problem (attach `02-problem.png`)

```
The problem: Claude Code is incredible, but it eats your Pro quota fast.

Lints, refactors, grep-and-replace, batch file ops — context-heavy stuff that doesn't need a frontier model — burns through your monthly limit in days.
```

**Char count: 232 / 280**

---

### T3 — The fix (attach `05-verify.png`)

```
The fix: pair Claude Desktop (Anthropic) with Claude Code pointed at Ollama.

Two side-by-side panes. Same Claude UX in both. One of them runs on a free open-source model.

This is the verify screen at the end of the setup — both engines responding.
```

**Char count: 252 / 280**

---

### T4 — Install (attach `03-install.png`)

```
Step 1: install Ollama. Pull a model — Gemma, Qwen, DeepSeek, your pick.

The deck auto-detects your OS (macOS, Windows + WSL2, Linux) and shows you the right command. No guessing.
```

**Char count: 192 / 280**

---

### T5 — Router config (attach `04-router-config.png`)

```
Step 2: point Claude Code's router at your local Ollama model.

One JSON block. The copy-paste prompt writes it for you if you don't want to touch the file yourself.

Strategy work still hits Anthropic. Terminal grunt work hits localhost:11434.
```

**Char count: 248 / 280**

---

### T6 — Verify (attach `05-verify.png` again, with caption explicitly callling out both panes)

```
Step 3: verify both engines.

Run a prompt on the left (Claude Desktop). Run a prompt on the right (Claude Code → Ollama). Both stream responses. One bills you. The other doesn't.

That's it. ~10 minutes end to end.
```

**Char count: 220 / 280**

---

### T7 — Links + tags (no image)

```
Repo (MIT, fork it): https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude

Hosted tutorial w/ the 21-slide deck + copy-paste prompt: https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude

Built by @coherencedaddy. h/t @AnthropicAI @ollama
```

**Char count (with t.co links counted as 23 each): 23 + 23 + ~145 = ~191 / 280**

---

## Posting checklist

1. Post T1 first, wait for the tweet to publish, then reply T2 to T1, then T3 to T2, etc. (a true thread, not 7 separate tweets).
2. After T7 lands, **quote-tweet T1 from `@coherencedaddy`** with one line: "Tutorial we just shipped — 90% Claude Code bill cut, all open source." This double-amplifies without looking spammy.
3. Pin T1 to the operator's profile for 7 days.
4. If a reply asks "does this work with Sonnet?" or "what about Cursor?" — reply with a one-liner pointing at the relevant slide. Engagement in the first hour drives ranking.
