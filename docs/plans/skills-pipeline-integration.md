# TODO — Skills-Pipeline + kepano-obsidian integration

> Running tracker for grafting two upstream organization patterns onto this
> ecosystem: Anthropic-style skills from
> [Sleestk/Skills-Pipeline](https://github.com/Sleestk/Skills-Pipeline) into
> `.claude/skills/`, and [kepano/kepano-obsidian](https://github.com/kepano/kepano-obsidian)
> conventions into both Obsidian vaults via the `vault-scaffolding/` kit.
>
> Source plan: `~/.claude/plans/https-github-com-sleestk-skills-pipeline-enchanted-quail.md`.
>
> **Last audited: 2026-04-27.**

## Phase A — Install upstream skills into `.claude/skills/`

Source: Skills-Pipeline upstream commit `504a11ee73d01fb9d0e361a190dacdb97ca2cb9f`
(pulled 2026-04-27).

- [x] Clone upstream to `/tmp/skills-pipeline`.
- [x] Copy `Obsidian/obsidian-power-user/` → `.claude/skills/obsidian-power-user/` (9 files: SKILL.md + 8 references).
- [x] Copy `SaaS/stripe-developer/` → `.claude/skills/stripe-developer/` (7 files: SKILL.md + 6 references).
- [x] Write `.claude/skills/README.md` recording source URL, pulled SHA, refresh procedure.
- [x] Verify both skills appear in available-skills listing with full description strings rendered. **Confirmed 2026-04-27** in the integration session.

## Phase B — kepano conventions, via the `vault-scaffolding/` kit

Plan-time pivot: rather than write directly into
`~/Documents/Obsidian Vault/...` from a sandboxed Claude session, we stage the
entire kepano scaffolding kit inside this repo at `vault-scaffolding/` and the
user drag-drops it into each vault. Same workflow a tutorial reader follows.

- [x] Build `vault-scaffolding/_CONVENTIONS.md` (the two laws + properties cheat sheet).
- [x] Build `vault-scaffolding/Templates/` with 6 starter templates: Note, Project, Person, Reference, Decision, Daily.
- [x] Build `vault-scaffolding/Categories/` with 6 index stubs: Project, People, Reference, Decision, Evergreen, Daily.
- [x] Build `vault-scaffolding/README.md` with install steps and verification.

### Phase B — user actions (drag-drop the kit + verify)

These run on your laptop with Obsidian open; no agent can do them.

- [ ] **Drop kit into `Projects Brain`**: copy `vault-scaffolding/{_CONVENTIONS.md, Templates/, Categories/}` → `~/Documents/Obsidian Vault/Projects Brain/`.
- [ ] **Drop kit into `Personal Vault`**: copy the same three things → `~/Documents/Obsidian Vault/Personal Vault/`.
- [ ] **Enable Templates core plugin** in each vault (Settings → Core plugins → Templates → on; folder location = `Templates`).
- [ ] **Backfill `Projects Brain/Projects/<slug>/`**: open each project's `README.md` + `infrastructure.md`, add `categories: ["[[Project]]"]` to frontmatter. Mechanical, ~10 seconds per project.
- [ ] **Run `/sync`** — confirm zero indexing errors. Note the indexed-count delta in the Blockers section below.
- [ ] **Run `/ask "what's categorized as a Project?"`** — confirm hits include the backfilled notes.

## Phase C — this TODO file

- [x] Create `docs/plans/skills-pipeline-integration.md` (this file).
- [ ] Flip checkboxes in real time as user actions in Phase B complete.
- [ ] Audit-date refresh whenever a phase closes.

## Phase D — Tutorial: `give-claude-an-organized-brain`

Cross-repo work. The actual tutorial ships from `coherencedaddy-landing`,
following the canonical workflow at `docs/products/tutorials-hub.md`. Drafts
live below; transcribe to static HTML once Phase B verifies clean.

Slug proposal: **`give-claude-an-organized-brain`** (sibling to existing
`give-obsidian-a-memory`, 2026-04-26). Lock once chosen.

### Tutorial draft — slide outlines

**Slide 1 — Hook**

> Your Obsidian vault is full of notes Claude can't reliably find.
>
> Folders organize *bytes*. Frontmatter organizes *meaning*.
>
> Here's how to add a 4-line YAML block to every note that turns your vault
> into a knowledge graph Claude can actually reason about — using two free
> upstream patterns and zero new tools.

**Slide 2 — What we're stealing, from whom**

- **`Sleestk/Skills-Pipeline`** — Anthropic-style skill markdown. We lift two: `obsidian-power-user` (vault expert) and `stripe-developer` (pulled in if you need it; skip if not).
- **`kepano/kepano-obsidian`** — Steph Ango's published personal vault. We lift the convention, not the contents: every note declares `categories: ["[[Project]]"]` etc., turning frontmatter into typed graph edges.

Both are MIT-licensed, both are under 5 MB, both install in under 60 seconds.

**Slide 3 — Step 1: Install the Obsidian skill**

```bash
git clone --depth 1 https://github.com/Sleestk/Skills-Pipeline.git /tmp/skills-pipeline
cp -R /tmp/skills-pipeline/Obsidian/obsidian-power-user ~/your-project/.claude/skills/obsidian-power-user
```

Now Claude has full Obsidian fluency for free. Test by asking
"set up Templates and a Daily Note structure for me" — it'll walk you through.

**Slide 4 — Step 2: Drop the kepano kit into your vault**

(Show the `vault-scaffolding/` tree from this repo.)

Drag `_CONVENTIONS.md`, `Templates/`, `Categories/` into your vault root.
Enable the Templates core plugin and point it at `Templates/`.

(Show before/after: a vault with no Categories/ folder vs. one with the
6-stub Categories/ index showing in the file tree.)

**Slide 5 — Step 3: The two laws of frontmatter graphs**

```yaml
---
created: 2026-04-27
categories: ["[[Project]]"]    # ← Law 1: every note has categories
topics: ["[[Knowledge graphs]]"]   # ← Law 2: typed relations are wikilinks, not strings
---
```

That's the entire commitment. Two fields. Wikilinks-not-strings means every
relation becomes a real edge in Obsidian's graph view *and* a parseable field
for any indexer (local-brain, Dataview, Bases) downstream.

**Slide 6 — Step 4: Backfill on touch**

Don't do a mass migration. Next time you open a note, paste in the
`categories:` line and move on. Over two weeks your graph fills in naturally.

For project notes specifically, the high-leverage one-time pass:

```
For each Projects/<slug>/README.md:
  Add: categories: ["[[Project]]"]
```

Boom — instant clickable "all projects" view via the graph.

**Slide 7 — Step 5: Re-index and ask**

```
/sync       # local-brain re-indexes both vaults
/ask "what's categorized as a Project?"
```

If the answer cites your backfilled notes, the graph is live. If it doesn't,
your indexer is treating frontmatter as plain text — an upgrade target, not
a blocker.

**Slide 8 — Wrap**

Three artifacts you now have:
1. A skill that knows Obsidian inside-out (`obsidian-power-user`).
2. A vault organized as a typed knowledge graph (`_CONVENTIONS.md` + `categories:`).
3. A repeatable kit (`vault-scaffolding/`) you can drop into the *next* vault you build.

Repos:
- This tutorial's mirror: `github.com/Coherence-Daddy/give-claude-an-organized-brain`
- Skills upstream: `github.com/Sleestk/Skills-Pipeline`
- Kepano vault: `github.com/kepano/kepano-obsidian`

### Tutorial — ship checklist (cross-repo)

Runs once Phase B verifies clean. All paths inside `coherencedaddy-landing`
unless noted.

- [ ] Author static HTML at `public/tutorials/give-claude-an-organized-brain/index.html`. Copy `<head>` from `public/tutorials/use-ollama-to-enhance-claude/index.html`.
- [ ] Add per-tutorial `og.png` at `public/tutorials/give-claude-an-organized-brain/og.png`.
- [ ] Append `Tutorial` entry in `lib/tutorials.ts`. Category `developer-tools`, level `intermediate`.
- [ ] Append URL to `public/llms.txt` under `## Tutorials`.
- [ ] Create public mirror `Coherence-Daddy/give-claude-an-organized-brain` (MIT license, README + `prompts/`).
- [ ] Submit to Google Search Console + Bing Webmaster after deploy.

## Blockers / open decisions

- [ ] **Does local-brain extract wikilinks-in-YAML as typed payload, or only embed text?** Verify by running `/sync` after backfilling one project, then `/ask` with a typed query. If only text-embedded, file follow-up to update `/Users/exe/local-brain/src/brain_manager.py` to parse `categories:`, `topics:`, `author:`, etc. into Qdrant payload fields. Capture result here once tested.
- [ ] **Final tutorial slug.** Proposal: `give-claude-an-organized-brain`. Confirm or change before authoring static HTML — slugs lock at publish.
- [ ] **Bases queries vs. Dataview.** Category index stubs include a commented-out Bases embed (`<!-- ![[Projects.base]] -->`). Decide whether to author Bases files (Obsidian native, newer) or Dataview queries (community, mature). Lean Bases for portability.
- [ ] **Whether to publish `vault-scaffolding/` as its own public repo** so tutorial readers can `git clone` instead of file-by-file copy. Sibling decision to the mirror repo above.
- [ ] **`obsidian` developer CLI integration** — user provided snippets (`obsidian devtools`, `obsidian plugin:reload`, `obsidian dev:screenshot`, `obsidian eval`, `obsidian dev:errors`, `obsidian dev:css`, `obsidian dev:dom`). Confirm which `obsidian` CLI ships these (Obsidian core has no such binary by default — likely a community plugin or custom shim) and decide whether to wire its calls into the tutorial Phase B verification step or a `vault-scaffolding/scripts/` helper.

## Verification

### Phase A smoke (2026-04-27 — done)

- [x] `ls .claude/skills/obsidian-power-user/SKILL.md` exits 0.
- [x] `ls .claude/skills/stripe-developer/SKILL.md` exits 0.
- [x] Available-skills list in a fresh session shows `obsidian-power-user` and `stripe-developer` with description strings rendered.

### Phase B smoke (pending user drop-in)

- [ ] Open any `Projects Brain/Projects/<slug>/README.md` in Obsidian — `categories:` field renders as a clickable graph link.
- [ ] `Categories/Project.md` is reachable from the graph view.
- [ ] `/sync` returns zero errors and indexed-count goes up by the kit's file count.
- [ ] `/ask "what's categorized as a Project?"` cites backfilled notes.

### Phase D smoke (post tutorial deploy)

- [ ] `https://coherencedaddy.com/tutorials/give-claude-an-organized-brain` loads, slides render, AdSense banner appears on non-cover slides.
- [ ] Mirror repo `github.com/Coherence-Daddy/give-claude-an-organized-brain` shows README + `prompts/`.
- [ ] Google Search Console + Bing both 200 OK on submit.
