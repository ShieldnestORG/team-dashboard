# dev.to — Round 2 Long-Form

**Round 1 angle (already shipped):** the setup walkthrough — "here's how to do it."
**Round 2 angle:** the cost-math deep dive — *"I tracked every Claude Code call for 30 days. Here's the breakdown that justified switching to Gemma."*

This post should read as analytical, not promotional. Show the math. The link to the tutorial belongs in the conclusion, not the opener.

---

## Suggested title

```
I tracked every Claude Code call for 30 days. Here's the cost breakdown that justified switching to Gemma.
```

## Tags

`#claude` `#ollama` `#productivity` `#opensource`

(dev.to caps at 4 tags. These are the right four — `#claude` for the core audience, `#ollama` for the technique audience, `#productivity` for general dev readers, `#opensource` for amplification.)

## Cover image

`05-verify.png` (the two-tab verify shot). dev.to renders cover images at 1000×420 — re-export specifically for this post.

---

## 5-section structure

### 1. The premise (why I bothered tracking)
~250 words. Set up the problem: Claude Code is great, but quota burns fast. Hand-wavy "saves money" claims aren't enough — wanted to know exactly *which* tasks deserve a frontier model and which don't.

### 2. What I measured + how
~400 words. Tracking method: every Claude Code session logged with task type (lint / refactor / debug / architecture / batch op / etc.), engine (Anthropic Sonnet vs `claude-gemma` via Ollama), wall-clock time, approximate token spend (Anthropic side only), and a 1–5 quality rating. Show the spreadsheet schema. Acknowledge sampling bias.

### 3. The breakdown (the chart that runs the post)
~500 words. Stacked bar chart by task category, split by engine. Find: roughly **<X>%** of terminal-side calls were mechanical (formatting, lints, grep-and-replace, batch ops, repetitive edits). Those tasks ran fine on Gemma 7B at $0/call. Frontier-reasoning tasks (multi-file refactors, debugging unfamiliar code, architecture decisions) stayed on Sonnet — and *should* stay on Sonnet.

The ~90% headline number falls out of: (cost of running mechanical tasks on Sonnet) − (cost of running them on Gemma, which is $0) ≈ 88–92% of total monthly Claude Code spend, depending on workload mix. Show the arithmetic. Use a placeholder `<your-actual-monthly-bill>` rather than fabricating a specific dollar amount.

### 4. Where it breaks down (the honest part)
~350 words. Things Gemma 7B is bad at: cross-file context that exceeds its window, anything requiring tool use beyond shell, code in less common languages, debugging that needs real reasoning. Don't oversell. The point isn't "replace Anthropic with Ollama," it's "stop burning Pro quota on tasks that any decent local model can handle."

### 5. The setup (the soft pitch + link)
~250 words. Brief description of the two-engine pattern. Link to the hosted tutorial and GitHub repo here, **once each**, in flowing text — not as a CTA block. Mention MIT license. Close with a question to drive comments: "What's your mechanical-vs-strategic split? Curious if other people's mix looks different from mine."

---

## Opening 200 words (drop in as-is)

```
A month ago I switched my Claude Code setup so that the terminal calls go through a local Ollama model instead of hitting Anthropic. The claim I made publicly at the time was that this cuts Claude Code spending by roughly 90%. A few people in the comments asked, very fairly, "where does that number come from?"

So I started tracking. Every Claude Code session for the next 30 days got logged: what kind of task it was, which engine handled it, how long it took, and — for the Anthropic-side calls — what it cost in tokens at published per-million pricing. I also rated quality 1 to 5 on every task: did the model actually do the job, or did I have to bounce it back to Sonnet?

The takeaway is more nuanced than the headline. The 90% number basically held, but not because Gemma is "as good as Sonnet" — it isn't. The savings are real because a surprising fraction of what you actually ask Claude Code to do is mechanical, and mechanical work doesn't need a frontier model.

Here's the breakdown.
```

(That's ~200 words and lands the reader in section 2 with momentum.)

---

## Writing notes

- Use code blocks for any `router.json` snippets. dev.to renders them clean.
- Embed the 21-slide presentation in an iframe near the end of section 5 (dev.to allows iframes from approved domains; coherencedaddy.com may need allowlisting — fall back to a screenshot link if not).
- Cross-post to Hashnode the same day with the same title. Hashnode's audience is smaller but the SEO compounds.
- Do **not** title-case the headline — dev.to convention is sentence-case.
