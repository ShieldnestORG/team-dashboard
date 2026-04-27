# Awesome List PR Templates

Three PR drafts for the canonical "awesome" lists. Each PR adds one line linking the repo. Keep PRs minimal — awesome list maintainers reject anything that looks like marketing.

> **Verify on submission day:** awesome list repos move; if any of the canonical URLs below have changed, re-search before forking. As of writing the canonical URLs are:
>
> - `awesome-claude-code` → **https://github.com/hesreallyhim/awesome-claude-code** (the most-starred and active community list; previously also `langgptai/awesome-claude-prompts` for prompt-only content but that's a different audience)
> - `awesome-llm` → **https://github.com/Hannibal046/Awesome-LLM** (the dominant general-purpose LLM awesome list)
> - `awesome-mcp` → **https://github.com/punkpeye/awesome-mcp-servers** is the canonical "Awesome MCP Servers" list; the broader umbrella `appcypher/awesome-mcp-servers` also exists. **The repo `awesome-mcp` (singular, no suffix) does not exist as a canonical list as of writing — `awesome-mcp-servers` is the closest match.** Submit there.
>
> If the user expected a literal `awesome-mcp` repo and finds one later, swap the URL — the PR copy below applies regardless.

---

## Universal line to add

This is the markdown line that goes into each list's README. Adjust category placement per list (see each section).

```markdown
- [use-ollama-to-enhance-claude](https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude) - Pair Claude Desktop with Claude Code routed through Ollama. 21-slide visual setup + copy-paste install prompt. Cut your Claude Code bill ~90%.
```

---

## PR 1 — `hesreallyhim/awesome-claude-code`

**Where in README:** Under the **Tutorials** or **Guides** section. If neither exists, place under **Resources**. Match the existing list's bullet style exactly (some lists use `*`, some use `-`).

**Section heading to scan for:** `## Tutorials` or `## Guides` or `## Workflows`

**Branch name:** `add-use-ollama-to-enhance-claude`

**PR title:**
```
Add: use-ollama-to-enhance-claude (two-engine setup tutorial)
```

**PR description:**
```markdown
Adds a link to a visual tutorial that pairs Claude Desktop (Anthropic) with Claude Code routed through Ollama, cutting Claude Code spending ~90% on terminal-side workloads (lints, refactors, batch ops, grep-and-replace).

The repo is MIT licensed, includes a 21-slide self-contained HTML walkthrough that auto-detects OS (macOS, Windows + WSL2, Linux), and ships a copy-paste install prompt that does ~98% of the setup automatically.

- Repo: https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude
- Hosted: https://coherencedaddy.com/tutorials/use-ollama-to-enhance-claude
- License: MIT

Placed under **Tutorials** alphabetically. Happy to move it to a different section if you prefer.

(Following the contributor guidelines — single line addition, alphabetical, matches existing bullet style.)
```

---

## PR 2 — `Hannibal046/Awesome-LLM`

**Where in README:** Under **Tutorials** or **LLM Deployment** or **Open LLM Tooling**. This list is huge — scan for the section that has Ollama, llama.cpp, or local-inference content. The repo belongs near other "use a local model with X tool" entries.

**Branch name:** `add-claude-code-ollama-pairing`

**PR title:**
```
Add use-ollama-to-enhance-claude under tutorials
```

**PR description:**
```markdown
Adding a tutorial that demonstrates routing Claude Code (Anthropic's terminal CLI) through a local Ollama-served model (Gemma, Qwen, DeepSeek). Same Claude Code UX, model swap is invisible to the developer; the use case is offloading mechanical terminal tasks (lints, refactors, batch ops) from a paid frontier model to a free local one.

- Repo: https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude
- License: MIT
- Includes a 21-slide visual walkthrough (self-contained HTML), a copy-paste install prompt with OS auto-detection, and a verify-both-engines step.

Placed in the Tutorials section in alphabetical order. Move freely if you'd prefer it under Deployment or Tools.
```

---

## PR 3 — `punkpeye/awesome-mcp-servers` (or `appcypher/awesome-mcp-servers` — pick whichever is more active)

> **Note on fit:** this list is specifically about MCP **servers**. The two-engine tutorial isn't an MCP server. **It's a borderline fit.** Consider whether to submit at all — if the maintainer's contributing guide narrowly scopes to MCP server implementations, this PR will be closed.
>
> **Alternative:** look for `awesome-claude-code-tools` or a more workflow-oriented list. If none, skip this PR rather than spam an off-topic submission.
>
> If submitting anyway, frame as "related tooling" or "complementary workflow" — not as an MCP server.

**Branch name:** `add-claude-code-ollama-workflow`

**PR title:**
```
Add: use-ollama-to-enhance-claude (related Claude Code workflow)
```

**PR description:**
```markdown
Adding a related workflow tutorial. Not strictly an MCP server — feel free to close if out of scope — but it pairs naturally with the MCP ecosystem because it covers routing Claude Code (which speaks MCP) through a local Ollama backend for cost optimization.

- Repo: https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude
- License: MIT
- 21-slide visual setup + copy-paste install prompt + verify-both-engines step.

Suggested placement: **Related Resources** or **Workflows** section, if either exists. If not, please feel free to decline — happy to redirect this submission to a more appropriate awesome list.
```

---

## Submission etiquette (universal)

- **Star the repo first.** Maintainers check.
- **Read the contributing guide.** Most awesome lists require: alphabetical placement, specific bullet format, line ≤120 chars, one-sentence description, no marketing language.
- **One PR per list.** Don't bundle multiple repos.
- **Wait 7 days before nudging.** Don't comment "any update?" before then.
- **If rejected, accept gracefully.** Awesome list maintainers have long memories.
