# Discord Blurbs

Discord is one of the few channels where minimal emoji use is normalized — keeping it sparse. Lead with the GIF (`assets/verify-demo.gif`), not the link. Drop blurbs in the right channel only — wrong-channel posts get nuked and burn the operator's reputation.

---

## 1) Anthropic Discord — `#showcase`

```
Just shipped a tutorial that pairs Claude Desktop with Claude Code routed through Ollama. Strategy stays on Pro, terminal grunt work runs on a free local model — cut my Claude Code usage roughly an order of magnitude.

It's a 21-slide visual walkthrough with a copy-paste install prompt that auto-detects your OS. Verify-both-engines step at the end so you can actually see it working.

Repo (MIT): https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude
Hosted: https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude

Feedback welcome — especially if anyone has tested with Sonnet 4.5 + a different local model.
```

Attach `verify-demo.gif`. Tone: peer-to-peer, technical, no marketing language.

---

## 2) Ollama Discord

```
Built a tutorial showing the Claude Code → Ollama routing pattern end to end. Anthropic for strategy, Gemma 7B locally for mechanical terminal work (lints, refactors, batch ops, grep-and-replace). Same Claude Code UX in both panes.

The deck auto-detects OS, the copy-paste prompt does ~98% of the install, and there's a verify-both-engines step at the end. MIT, fork it freely.

Repo: https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude

If anyone's running this with Qwen2.5-coder or DeepSeek-coder instead of Gemma I'd love to compare notes on quality/latency.
```

Attach `verify-demo.gif`. Tone: this audience cares about local-first and open-source. Lean into that.

---

## 3) BuildSpace Discord

```
Quick one for the BS crew shipping AI projects on a budget. Claude Code is great but eats quota — I wrote up a setup that pairs Claude Desktop (paid, for thinking) with Claude Code pointed at Ollama (free, for terminal grunt work). Cut my monthly bill ~90% without giving up the Claude UX.

Setup is ~10 min. Visual walkthrough + copy-paste prompt: https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude
Repo: https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude

If you're running Pro and watching your bill, this is worth 10 minutes.
```

Attach `verify-demo.gif`. Tone: builder-to-builder, money-saving framing lands here.

---

## 4) Cursor Discord

```
Tangential to Cursor but worth sharing — same pattern works for anyone routing terminal-side LLM calls through a local model.

I shipped a Claude Code + Ollama walkthrough: keep the heavy reasoning model for planning/review, route mechanical terminal calls (lints, refactors, batch ops) to Gemma 7B running locally. Same UX, ~90% cost cut.

The router config + verify steps generalize to any tool that supports a custom OpenAI-compatible endpoint.

https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude
```

Attach `verify-demo.gif`. Tone: don't pretend it's a Cursor tutorial — frame it as a transferable pattern. Cursor folks respect that.

---

## 5) Aider Discord

```
For the Aider crowd — same two-engine principle ports cleanly to Aider's `--model` + `--editor-model` split. I wrote up the Claude Code variant: Anthropic for strategy, Ollama (Gemma 7B) for terminal grunt work, ~90% cost cut.

Repo + 21-slide visual walkthrough: https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude

Curious if anyone here has run a similar split with Aider's editor/architect model setting and what the quality cliff looks like for them.
```

Attach `verify-demo.gif`. Tone: technical, treat them as peers, ask a question to spark discussion.

---

## Channel etiquette reminders

- **Don't post in `#general`** in any of these servers. Find the dedicated `#showcase`, `#self-promotion`, or `#projects` channel.
- **Don't @-mention staff or maintainers.** Ever.
- If a server has a "promo allowed once per X days" rule, set a calendar reminder before posting elsewhere.
- After posting, stick around for 30+ minutes to reply to questions. Drive-by promo posts get muted.
