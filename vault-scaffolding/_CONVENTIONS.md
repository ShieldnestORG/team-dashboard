---
type: conventions
created: 2026-04-27
categories: ["[[Reference]]"]
---

# Vault conventions — kepano-style frontmatter graph

This vault uses Steph Ango ([@kepano](https://github.com/kepano))'s **bottom-up
organization pattern**: folders are buckets, but the real graph lives in
frontmatter. Every note declares its categories and typed relations as
**wikilinks inside YAML** — turning the vault into a parseable knowledge graph
that both Obsidian's graph view and our local-brain → Qdrant indexer can read
without NLP.

## The two laws

1. **Every note has a `categories:` field.** Value is one or more wikilinks to
   a Category index (`categories: ["[[Project]]"]`, `categories: ["[[Reference]]", "[[People]]"]`).
2. **Typed relations are wikilinks, not strings.** Author? `author: ["[[Steph Ango]]"]`.
   Topic? `topics: ["[[Evergreen]]"]`. Org? `org: ["[[Anthropic]]"]`. Never plain text.

That's it. Folders are still useful for buckets (Daily, Clippings, Projects),
but discovery happens through frontmatter + Bases queries, not folder spelunking.

## Noun-types we use

Each gets a template in `Templates/<Noun> Template.md` and a category index in
`Categories/<Noun>.md`. Add new ones as needed; don't feel bound to the starter
set.

| Type | When to use | Lives in |
|---|---|---|
| `[[Project]]` | A working initiative with a goal and an end state | `Projects Brain/Projects/<slug>/` |
| `[[Reference]]` | An entity you didn't author — a book, a city, a person, a tool | `References/` (or anywhere) |
| `[[People]]` | A specific person (often overlaps with Reference) | anywhere |
| `[[Decision]]` | A captured decision that supersedes older thinking | `Decisions/` (optional) |
| `[[Evergreen]]` | Your own writing — an idea polished over time | `Notes/` |
| `[[Daily]]` | A daily journal note | `Daily/` (optional) |
| `[[Category]]` | A category index file (meta — used by `Categories/*.md`) | `Categories/` |

## Properties cheat sheet

Common across most note types:

- `created:` — ISO date `YYYY-MM-DD`. Always set on creation.
- `categories:` — array of wikilinks. Required.
- `tags:` — sparse, workflow states only (`to-read`, `0🌲`, `inbox`). NOT topics.
- `topics:` — array of wikilinks for topical relations.
- `via:` — wikilink or URL of where you found this.
- `url:` — canonical URL if external.
- `status:` — workflow state (`active`, `archived`, `idea`).

Type-specific properties live in each `<Type> Template.md`.

## Title rules

- **Evergreens** — full sentences, declarative, quotable: `Frontmatter is a knowledge graph in disguise.md`. They're meant to be inline-linked mid-prose.
- **References** — canonical name: `Steph Ango.md`, `Kyoto.md`, `Blade Runner.md`.
- **Projects** — slug-style, matches the working directory: `team-dashboard.md`.
- **Daily notes** — `YYYY-MM-DD.md`.

## What this enables

- **Obsidian graph view** — every `categories:` link becomes an edge. Filter by
  category to see the subgraph.
- **Bases queries** — `Categories/Project.md` is a 4-line stub embedding a
  saved Bases query that lists every note where `categories` contains
  `[[Project]]`. No manual MOC curation.
- **local-brain → Qdrant** — the frontmatter parser can extract typed
  relations into Qdrant payload fields, turning semantic search into typed
  graph search ("find me all notes where `author: [[Anthropic]]` AND
  `categories: [[Reference]]`").

## What this does NOT change

- The shortcut files at vault root (🏠 Home, 🔍 Ask Brain, 🔄 Sync Brain, etc.)
  keep their `type: shortcut` convention. They drive the local-brain command
  palette and aren't part of the kepano graph.
- Existing notes without `categories:` still work — they just don't show up in
  category-filtered queries until you add the field. Backfill on touch, don't
  do a mass migration.

## Sources

- Inspiration: [kepano/kepano-obsidian](https://github.com/kepano/kepano-obsidian) (Steph Ango's published vault template)
- Companion essay: <https://stephango.com/vault>
- Local skill: `obsidian-power-user` in `.claude/skills/` (covers Obsidian features end-to-end)
