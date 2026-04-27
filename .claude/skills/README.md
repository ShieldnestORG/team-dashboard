# `.claude/skills/` — project skill registry

Skills here are loaded automatically by Claude Code when working in this repo. Each skill is a directory containing a `SKILL.md` (with frontmatter `name` + `description`) and an optional `references/` tree loaded on demand via progressive disclosure.

## Inventory

| Skill | Origin | Purpose |
|---|---|---|
| `design-guide/` | Built in-house | Paperclip UI design system reference for the team-dashboard frontend. Owned by this repo. |
| `obsidian-power-user/` | Upstream — [Sleestk/Skills-Pipeline](https://github.com/Sleestk/Skills-Pipeline) `Obsidian/obsidian-power-user/` | Vault design, templates, Bases, Dataview, plugins. Pairs with the kepano-style conventions in `~/Documents/Obsidian Vault/{Personal Vault, Projects Brain}/_CONVENTIONS.md`. |
| `stripe-developer/` | Upstream — [Sleestk/Skills-Pipeline](https://github.com/Sleestk/Skills-Pipeline) `SaaS/stripe-developer/` | Checkout, Products & Prices, Subscriptions, Webhooks, Customer Portal. Used during CreditScore (and future product) Stripe work. |

## Refresh procedure (re-pull from upstream)

When upstream Skills-Pipeline updates, refresh in place:

```bash
# 1. Clone fresh upstream copy
rm -rf /tmp/skills-pipeline
git clone --depth 1 https://github.com/Sleestk/Skills-Pipeline.git /tmp/skills-pipeline

# 2. Confirm the SHA we're pulling from
git -C /tmp/skills-pipeline rev-parse HEAD

# 3. Replace just the upstream-sourced trees (do NOT touch design-guide/)
rm -rf .claude/skills/obsidian-power-user .claude/skills/stripe-developer
cp -R /tmp/skills-pipeline/Obsidian/obsidian-power-user .claude/skills/obsidian-power-user
cp -R /tmp/skills-pipeline/SaaS/stripe-developer .claude/skills/stripe-developer

# 4. Update the "Last refreshed" line below with the new SHA + date
```

**Last refreshed:** 2026-04-27 from upstream commit `504a11ee73d01fb9d0e361a190dacdb97ca2cb9f`.

## Why we don't use a submodule

Upstream is a flat content repo with three independent collections (YouTube/, SaaS/, Obsidian/). We only want two folders. A submodule would pull all three and would also bind us to upstream's release cadence. Direct copy + recorded SHA is simpler and lets us cherry-pick future updates per-skill.

## Adding a new skill

- **Skill from upstream:** add a row to the inventory table above with the source path, then run the refresh procedure with the new path appended.
- **In-house skill:** create a new directory with a `SKILL.md` whose frontmatter `description` is *aggressive about triggering* (see how `obsidian-power-user`'s description lists every keyword). Claude only invokes a skill when the description matches the user's intent — under-described skills get ignored.
