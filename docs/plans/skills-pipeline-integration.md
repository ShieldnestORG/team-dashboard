# TODO — Skills-Pipeline + kepano-obsidian integration

> Running tracker for grafting two upstream organization patterns onto this
> ecosystem: Anthropic-style skills from
> [Sleestk/Skills-Pipeline](https://github.com/Sleestk/Skills-Pipeline) into
> `.claude/skills/`, and [kepano/kepano-obsidian](https://github.com/kepano/kepano-obsidian)
> conventions into both Obsidian vaults via the `vault-scaffolding/` kit.
>
> Source plan: `~/.claude/plans/https-github-com-sleestk-skills-pipeline-enchanted-quail.md`.
>
> **Last audited: 2026-04-27** (Phase A + Phase B vault-side execution complete; Phase D tutorial ship pending storefront work).

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

### Phase B — vault-side execution (DONE, 2026-04-27)

User granted vault-write access mid-session, so all of these executed in the same session via direct file writes + a `/sync` invocation.

- [x] **Dropped kit into `Projects Brain`**: `_CONVENTIONS.md`, `Templates/` (6 files), `Categories/` (6 files) at `~/Documents/Obsidian Vault/Projects Brain/`.
- [x] **Dropped kit into `Personal Vault`**: same three trees at `~/Documents/Obsidian Vault/Personal Vault/Personal Vault/` (note: actual vault root is nested one level under the parent folder).
- [x] **Templates core plugin** confirmed already enabled in both vaults' `.obsidian/core-plugins.json`. Wrote `.obsidian/templates.json` in both with `{"folder": "Templates"}` so the plugin uses the new directory.
- [x] **Backfilled 9 files across 5 projects**: `Ollama Engine/{README.md, infrastructure.md}`, `Sample Project/{README.md, infrastructure.md}`, `Team-Dashboard/{README.md, infrastructure.md}`, `coherencedaddy-landing/{README.md, infrastructure.md}`, `v1_shieldnest_org/Todo.md`. Files without frontmatter got a fresh block; files with frontmatter got a `categories: ["[[Project]]"]` line inserted after `project:`. Two opportunistic clean-ups while there: `Team-Dashboard/README.md` `project:` value `"[Project Name]"` → `"Team-Dashboard"`, and `infrastructure.md` `project: "_templates"` → `"Team-Dashboard"`.
- [x] **`/sync` ran clean** — Projects: 22/50 files re-embedded, 39 chunks; Personal: 13/35 files, 22 chunks; zero errors. Dashboard rebuilt at `~/Documents/Obsidian Vault/Projects Brain/dashboard.html`.
- [x] **Search probe confirmed structured frontmatter** — local-brain returns each chunk with a `frontmatter` field that preserves the wikilink array (e.g. `"categories": ["[[Category]]"]`). See Blockers section below — this resolves the open question about wikilinks-in-YAML handling.

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

- [x] **Does local-brain extract wikilinks-in-YAML as typed payload, or only embed text?** **RESOLVED 2026-04-27.** Inspection of search results (`brain_manager.py search "..."`) shows each Qdrant chunk carries a structured `frontmatter` dict where `categories: ["[[Project]]"]` is preserved as a list of strings. Wikilink-style values land verbatim in the payload — no NLP parse needed, no `brain_manager.py` update required. *Caveat:* files whose frontmatter contains Templater placeholders (e.g. `_Claude_Ollama_Human/note_template.md` with `{{project_name}}`) parse to an empty `frontmatter: {}` dict because the placeholders aren't valid YAML. Real notes are fine; templates with unresolved placeholders are the only blind spot.
- [ ] **Final tutorial slug.** Proposal: `give-claude-an-organized-brain`. Confirm or change before authoring static HTML — slugs lock at publish.
- [ ] **Bases queries vs. Dataview.** Category index stubs include a commented-out Bases embed (`<!-- ![[Projects.base]] -->`). Decide whether to author Bases files (Obsidian native, newer) or Dataview queries (community, mature). Lean Bases for portability.
- [ ] **Whether to publish `vault-scaffolding/` as its own public repo** so tutorial readers can `git clone` instead of file-by-file copy. Sibling decision to the mirror repo above.
- [ ] **`obsidian` developer CLI integration** — user provided snippets (`obsidian devtools`, `obsidian plugin:reload`, `obsidian dev:screenshot`, `obsidian eval`, `obsidian dev:errors`, `obsidian dev:css`, `obsidian dev:dom`). Confirm which `obsidian` CLI ships these (Obsidian core has no such binary by default — likely a community plugin or custom shim) and decide whether to wire its calls into the tutorial Phase B verification step or a `vault-scaffolding/scripts/` helper.

## Verification

### Phase A smoke (2026-04-27 — done)

- [x] `ls .claude/skills/obsidian-power-user/SKILL.md` exits 0.
- [x] `ls .claude/skills/stripe-developer/SKILL.md` exits 0.
- [x] Available-skills list in a fresh session shows `obsidian-power-user` and `stripe-developer` with description strings rendered.

### Phase B smoke (DONE, 2026-04-27)

- [x] Backfilled 9 files (5 projects); all carry `categories: ["[[Project]]"]` (verified via `grep -rn '^categories:'`).
- [x] `Categories/Project.md` and `Templates/*` indexed in both vaults.
- [x] `/sync` returned zero errors; combined re-embed count = 35 files / 61 chunks.
- [x] Search returns the new Categories/_CONVENTIONS hits with structured `frontmatter` payload — confirms wikilinks-in-YAML survive into Qdrant.
- [ ] **Visual check, you-only:** open any backfilled project README in Obsidian, confirm `categories:` renders as a clickable graph-view edge. (Agent can't see the GUI.)

### Phase D smoke (post tutorial deploy)

- [ ] `https://coherencedaddy.com/tutorials/give-claude-an-organized-brain` loads, slides render, AdSense banner appears on non-cover slides.
- [ ] Mirror repo `github.com/Coherence-Daddy/give-claude-an-organized-brain` shows README + `prompts/`.
- [ ] Google Search Console + Bing both 200 OK on submit.
