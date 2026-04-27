# Tutorials Hub

Canonical doc for the Coherence Daddy tutorials product surface. The implementation lives in the public-facing storefront repo (`coherencedaddy-landing`); this file records the cross-repo decisions so future agents stop relitigating them.

## Surface map

- **Live URL pattern:** `coherencedaddy.com/tutorials/<slug>` (subdirectory on the root domain — see policy below).
- **Index page:** `coherencedaddy.com/tutorials` — list view rendered from the registry.
- **Per-tutorial GitHub mirror:** `github.com/Coherence-Daddy/<slug>` under the public `Coherence-Daddy` org. MIT-licensed. Contains the presentation HTML, the copy-paste setup prompt(s), and a README.
- **Source format:** each tutorial is a self-contained static HTML file at `coherencedaddy-landing/public/tutorials/<slug>/index.html` with all `<head>` metadata (title, OG, Twitter, AdSense script) inlined. Static HTML does NOT pass through the Next root layout.
- **Registry:** `coherencedaddy-landing/lib/tutorials.ts` exports a typed `Tutorial[]` (slug, title, tagline, description, category, duration, level, publishedAt, updatedAt, tags, featured) and helpers `getAllTutorials()` / `getTutorialBySlug()`. Slugs are kebab-case and locked once published — renaming a slug breaks every share link in the wild.

### Currently live (verified 2026-04-26)

| Slug | Published | Repo |
|---|---|---|
| `use-ollama-to-enhance-claude` | 2026-04-25 | [Coherence-Daddy/use-ollama-to-enhance-claude](https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude) |
| `give-obsidian-a-memory` | 2026-04-26 | `Coherence-Daddy/give-obsidian-a-memory` |

## Subdirectory vs subdomain — DECISION: subdirectory

Tutorials stay on `coherencedaddy.com/tutorials/<slug>`. Do NOT migrate to `tutorials.coherencedaddy.com`.

**Reasoning:**
- Subdirectories consolidate link equity and topical authority on the root domain. Tutorials reinforce the brand's authority in AI agents / dev tooling — that signal should compound on `coherencedaddy.com`, not be siphoned to a sibling host.
- Google's John Mueller has publicly stated Google "handles both" subdomain and subdirectory equivalently. Technically true; practically, observed SEO outcomes consistently favor subdirectories for content closely related to the main brand. (Sources: Mueller via Search Engine Journal; Semrush; Victorious.)
- AdSense is **not** a constraint either direction. Post-2023 site-management changes, root-domain verification covers all subdomains automatically and a root `ads.txt` falls through. AdSense doesn't decide this; SEO does.

If a future tutorial program is large enough to warrant its own marketing identity (separate brand, separate auth, separate analytics), revisit. Until then: subdirectory.

## Adding a new tutorial — checklist

All paths below are inside `coherencedaddy-landing` unless noted.

1. **Author the static HTML.** Create `public/tutorials/<slug>/index.html`. Copy the `<head>` template (title, meta description, canonical, OG, Twitter, AdSense `<script async>`) from `public/tutorials/use-ollama-to-enhance-claude/index.html`. Update the OG image URL.
2. **Add a per-tutorial `og.png`** next to the `index.html` (e.g. `public/tutorials/<slug>/og.png`). Do NOT reuse the brand-wide OG — every tutorial gets its own card.
3. **Register in `lib/tutorials.ts`.** Append a `Tutorial` entry to the `TUTORIALS` array. Required fields: `slug`, `title`, `tagline`, `description`, `category` (`ai-agents` | `developer-tools` | `self-help` | `crypto`), `duration`, `level`, `publishedAt` (ISO), `updatedAt` (ISO), `tags`. Optional `featured?: true` to pin to top of the index.
4. **Update `public/llms.txt`** — add a line under the `## Tutorials` section pointing to the live URL. Keeps LLM-driven discovery accurate.
5. **Create the public mirror repo** under the `Coherence-Daddy` GitHub org (NOT `ShieldnestORG` — see CLAUDE.md identity map). Include: `README.md`, `LICENSE` (MIT), the presentation HTML, and a `prompts/` directory containing any copy-paste setup prompts referenced by the tutorial.
6. **Submit for indexing after deploy:** Google Search Console URL Inspection (Request Indexing) + Bing Webmaster Tools URL Submission, for both the tutorial URL and the updated `/tutorials` index.

## AdSense behavior

- Single fixed banner ad pinned to the bottom of the slide stage, rendered in a `.tutorial-ad` aside via raw `<ins class="adsbygoogle">` markup.
- AdSense loader (`adsbygoogle.js?client=...`) is inlined in the tutorial `<head>`. Static HTML doesn't go through the Next root layout, so the script must travel with the file.
- Ad is hidden on cover, intro, and last slides via a `body[data-current-slide="..."] .tutorial-ad { display: none }` selector pattern.
- `ads.txt` lives at site root (`public/ads.txt`) — covers all subdirectory URLs automatically. No per-tutorial AdSense config needed.

## Cross-references

- **Implementation source-of-truth:** [`coherencedaddy-landing/docs/TUTORIALS.md`](../../../coherencedaddy-landing/docs/TUTORIALS.md) — slide structure, theme tokens, build/serve specifics. (Verified present 2026-04-26.)
- **SEO discipline:** [`coherencedaddy-landing/docs/SEO-CHECKLIST.md`](../../../coherencedaddy-landing/docs/SEO-CHECKLIST.md) — sitemap, schema, indexing routine.
- **Architecture context:** [System Overview](../architecture/system-overview.md).
- **GitHub org policy:** see "GitHub Identity Map" in [`team-dashboard/CLAUDE.md`](../../CLAUDE.md). Tutorial repos go in `Coherence-Daddy`, never `ShieldnestORG`.

## Boundaries

This product surface is owned entirely by `coherencedaddy-landing`. `team-dashboard` does not host tutorial content, does not run tutorial crons, and does not own any tutorial DB tables. If a future tutorial requires gated content, paid access, or per-user state, that's the trigger to add a `tutorial_*` table here and a `/checkout` + `/entitlement` surface — until then, tutorials are pure static content and live exclusively in the storefront repo.
