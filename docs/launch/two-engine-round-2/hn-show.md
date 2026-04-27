# Show HN — Round 2 Draft

**Round 1 angle (already shipped):** "Show HN: Two-Engine Setup — route Claude Code through Gemma to slash your Anthropic bill" — led with the setup.
**Round 2 angle:** retrospective. Same product, different framing: *"30 days later — here's what changed."*

> **Decision noted:** if 30-day metrics aren't actually measured yet (and they likely aren't — repo went up 2026-04-25, so day-30 isn't until ~2026-05-25), pivot to the **cost-math walkthrough** angle below. Both drafts are included; pick the one that matches reality on submission day.

**Recommended submit time:** Tuesday or Wednesday, **9:00–10:00am ET**. Avoids the Monday morning glut, lands while EU is finishing the workday and US is just opening laptops.

---

## Draft A — "30 days later" (use only if you have real numbers)

**Title (≤80 chars):**
```
Show HN: 30 days routing Claude Code through Ollama — what actually changed
```
(73 chars)

**Body:**
```
A month ago I shipped a tutorial on pairing Claude Desktop (Anthropic) with Claude Code routed through Ollama, with the claim that it'd cut Claude Code spending ~90%. I've now run that workflow as my daily driver for 30 days and have actual numbers, so this is the retro.

What I tracked: every Claude Code session, what model handled it, wall-clock time, and (for Anthropic-side calls) approximate cost using published per-token pricing. I also tracked subjective quality on a per-task basis — 1 to 5, did Gemma actually do the job or did I have to bounce it back to Sonnet.

The headline is the cost math basically held: terminal-only work (lints, refactors, grep-and-replace, batch file ops, formatting passes) ran on Gemma 7B locally for $0 and was good enough roughly <X>% of the time. The remaining work — anything requiring real reasoning, multi-file architecture changes, or hairy bug hunts — still needed Sonnet, and I didn't try to force Gemma to do it.

The non-obvious finding: the value isn't just cost. It's that the two-engine split forced me to *think about which engine a task belongs to* before I started typing, and that classification step alone made me a better operator. Strategy on Pro, mechanical work on free local. The friction of choosing surfaces the question "does this actually need a frontier model?" — and the answer is "no" more often than I expected.

Repo (MIT, the 21-slide visual walkthrough + copy-paste install prompt): https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude
Hosted: https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude

Happy to share the raw spreadsheet in comments if useful.
```

---

## Draft B — "The cost-math walkthrough" (use this if no real 30-day data yet)

**Title (≤80 chars):**
```
Show HN: The cost math behind routing Claude Code through Ollama (~90% cut)
```
(74 chars)

**Body:**
```
Posted the setup version of this a couple weeks back. The most-asked question in comments was "where does the 90% number actually come from?" — so this is the math, fully shown.

Premise: Claude Code in the terminal is incredible, but a meaningful chunk of what you ask it to do — lints, refactors, grep-and-replace, batch file edits, format passes — does not require a frontier model. If you classify your usage by "does this actually need Sonnet's reasoning" you'll find a long tail of mechanical tasks that a 7B open-source model handles fine.

The setup pairs Claude Desktop (Anthropic, paid) with Claude Code pointed at a local Ollama model (Gemma 7B in my case, but Qwen2.5-coder and DeepSeek work too). Strategy stays on Pro. Mechanical terminal work runs on localhost for $0. Same Claude Code UX in both — only the model changes.

The cost-math walkthrough — token-class breakdown, what counts as "mechanical," where the 90% number falls out, and where it breaks down (hairy refactors, anything cross-repo, anything needing real reasoning still hits Anthropic) — is in the post linked below. The repo includes the full 21-slide visual setup, a copy-paste prompt that does ~98% of the install for you, and the verify-both-engines step at the end so you can actually see it working.

Repo (MIT): https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude
Hosted tutorial: https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude

Caveats up front so HN doesn't have to drag them out of me: Gemma 7B is not Sonnet; routing isn't free of friction; and if all your work is genuinely frontier-grade reasoning you won't see savings. The 90% claim assumes a typical mixed workload.
```

---

## Submission checklist

- Submit from a HN account with non-trivial karma. New accounts get throttled.
- Link target: **the GitHub repo**, not the hosted tutorial. HN ranks repo links higher and the audience prefers code + README first.
- Reply to *every* top-level comment in the first 90 minutes. HN's ranker weighs OP engagement heavily early on.
- Expected pushback: "what about Aider?" / "why not Cursor?" / "Sonnet 4.5 is cheaper now anyway." Have one-liners ready that point at specific slides.
- If the post stalls (under 5 points after 30 minutes), don't repost. Wait a full week and retry from a different angle.
