# Vault scaffolding kit — kepano-style frontmatter graph

Drag-and-drop kit that adopts [@kepano](https://github.com/kepano)'s vault
conventions in any Obsidian vault. Compatible with the local-brain → Qdrant
pipeline at `/Users/exe/local-brain/`.

## What's in here

```
vault-scaffolding/
├── _CONVENTIONS.md                    ← The two laws + properties cheat sheet
├── Templates/
│   ├── Note Template.md               ← Generic evergreen
│   ├── Project Template.md            ← Working initiative
│   ├── Person Template.md             ← Specific person
│   ├── Reference Template.md          ← External entity (book, tool, place)
│   ├── Decision Template.md           ← Captured choice that supersedes older thinking
│   └── Daily Template.md              ← Daily journal note
└── Categories/
    ├── Project.md                     ← Index stubs — Bases queries embed once configured
    ├── People.md
    ├── Reference.md
    ├── Decision.md
    ├── Evergreen.md
    └── Daily.md
```

## Install (one-time, ~30 seconds)

For each Obsidian vault you want to kepano-ify:

1. Open the vault in Finder (e.g. `~/Documents/Obsidian Vault/Projects Brain/`).
2. Drag `_CONVENTIONS.md`, `Templates/`, and `Categories/` from this directory
   into the vault root. Confirm the merge if Obsidian asks.
3. In Obsidian: **Settings → Core plugins → Templates → enable**, then
   **Settings → Templates → Template folder location** set to `Templates`.
4. (Optional) **Settings → Core plugins → Daily notes → enable**, then point
   the template at `Templates/Daily Template.md`.

That's it. New notes you create from a template will have correct frontmatter
out of the gate.

## Backfill (additive only)

For existing notes, **don't do a mass migration**. Backfill on touch: when you
edit an existing project README, paste `categories: ["[[Project]]"]` into its
frontmatter and move on. Over a few weeks the graph fills in naturally.

For project notes specifically, the high-leverage pass is:

1. Open every `Projects Brain/Projects/<slug>/README.md` and `infrastructure.md`.
2. Add `categories: ["[[Project]]"]` to frontmatter (or create the frontmatter
   block if it doesn't exist).
3. Save.

That alone gives you a clickable "all projects" view via the graph.

## What this does NOT touch

- Shortcut files at vault root with `type: shortcut` (🏠 Home, 🔍 Ask Brain, 🔄 Sync Brain, etc.) — they drive the local-brain command palette and stay as-is.
- Existing folder structure — keep your `Projects/`, `Tools/`, `_Claude_Ollama_Human/` folders. Folders are still useful as buckets.

## Verify it works

After dropping the kit and adding `categories:` to one or two notes:

1. Open Obsidian's **Graph View** — you should see edges to the Category index files.
2. Run `/sync` (the local-brain command) — confirm zero indexing errors.
3. Run `/ask "what notes are categorized as Project?"` — should return the backfilled notes.

If wikilinks-inside-YAML aren't surfaced as typed payload by local-brain, log
it in `docs/plans/skills-pipeline-integration.md` Blockers — that's a known
unknown we'll address with a parser update if needed.

## Source

Inspired by [`kepano/kepano-obsidian`](https://github.com/kepano/kepano-obsidian)
(Steph Ango's published personal vault). Companion essay:
<https://stephango.com/vault>.
