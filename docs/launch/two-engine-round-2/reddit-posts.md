# Reddit Posts — 3 drafts

**Universal Reddit etiquette:**
- Lead with value, not the link. The link goes near the bottom or in the first comment.
- Read each subreddit's pinned rules immediately before posting — they change.
- Account should have non-trivial karma. New accounts get auto-filtered on r/ClaudeAI and r/LocalLLaMA.
- Post each subreddit on a different day. Don't carpet-bomb the same hour.
- Respond to every top-level comment in the first 4 hours; that's what the ranker rewards.

---

## 1) r/LocalLLaMA

**Subreddit notes:** This crowd loves anti-cloud-bill content, hates marketing fluff, and rewards "I actually built this and here's the config" posts. Title in lowercase, body should read like a forum reply not a press release. Image attachments are fine; flair as `Tutorial | Guide` or `Resources` per the sidebar.

**Title:**
```
routed claude code through gemma via ollama — cut my anthropic bill ~90%, free 21-slide setup
```

**Body:**
```
Been running Claude Pro for a while. The desktop app is great for thinking, planning, code review. Claude Code in the terminal is also great — but it eats quota fast on stuff that absolutely doesn't need a frontier model: lints, grep-and-replace, batch file ops, refactors that are mostly mechanical.

Fix: keep Claude Desktop on Anthropic for strategy, and point Claude Code's router at a local Ollama model (Gemma 7B in my case, but Qwen2.5-coder works too) for terminal grunt work. Two engines, same UX, one bill cut by an order of magnitude.

I wrote up the whole thing as a 21-slide visual walkthrough that auto-detects your OS (macOS, Windows + WSL2, Linux) and gives you a copy-paste prompt that does ~98% of the install for you. Verify-both-engines moment at the end so you can actually see it working.

Repo (MIT): https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude
Hosted deck: https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude

Happy to answer config questions in comments. The router.json block is the only fiddly bit — I documented every line.
```

**Image attached:** `05-verify.png` (the side-by-side two-tab verify). r/LocalLLaMA renders the screenshot inline.

---

## 2) r/ClaudeAI

**Subreddit notes:** This subreddit is **strict about self-promotion**. Mods and users have nuked posts that lead with a link. Lead with the *technique*, frame it as "here's a workflow that's been working for me," and put the link in a comment if needed. Flair: `Productivity` or `Coding`.

**Title:**
```
A two-engine workflow that kept Claude Pro from blowing up my monthly limit
```

**Body:**
```
Sharing a workflow that's been working really well — wanted to put it in front of folks who are hitting Claude Code rate limits or watching their usage bar fill up by mid-month.

The split:

- Claude Desktop (Anthropic) — strategy, planning, architecture, hairy bug hunts, code review. The stuff where you actually want frontier reasoning.
- Claude Code in the terminal — but routed through Ollama running locally, with Gemma 7B (or Qwen, DeepSeek, whatever). This handles lints, refactors, batch ops, grep-and-replace, formatting passes, repetitive edits.

Both panes feel identical because Claude Code's UX doesn't change — only the underlying model does. Strategy work still hits Anthropic. Mechanical work runs on a free open-source model on localhost.

The big win is that you stop burning Pro quota on tasks that don't need a frontier model in the first place. My monthly Claude Code usage dropped roughly an order of magnitude.

Setup is ~10 minutes. Happy to walk anyone through the router config in comments — that's the only fiddly part.

(I wrote this up as a visual tutorial — link in a comment so I'm not leading with self-promo, per sub norms.)
```

**Comment to drop after posting:**
```
For anyone who wants the full visual walkthrough + copy-paste setup prompt: https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude (and the repo: https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude — MIT, no email gate, no signup).
```

---

## 3) r/LLMDevs

**Subreddit notes:** Smaller, more dev-focused, less allergic to links than r/ClaudeAI. Keep it tight — devs there scroll fast. Code blocks are appreciated.

**Title:**
```
Two-engine Claude setup: Pro for strategy, Ollama for terminal grunt work (~90% cost cut)
```

**Body:**
```
Quick share. Claude Code is awesome but eats quota on tasks that don't need a frontier model — lints, refactors, grep-and-replace, batch file ops.

Solution: keep Claude Desktop on Anthropic, point Claude Code's router at a local Ollama model.

```json
{
  "model": "ollama/gemma:7b",
  "providers": {
    "ollama": { "baseUrl": "http://localhost:11434" }
  }
}
```

(Full config + verify steps in the deck.)

Same Claude Code UX, model swap is invisible. Strategy still hits Anthropic. Mechanical work runs free on localhost.

Repo: https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude
Hosted walkthrough (21 slides + copy-paste install prompt): https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude

MIT licensed. Fork it, ship a YouTube walkthrough of it, no attribution required.
```
