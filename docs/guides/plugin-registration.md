# Plugin Registration

This note explains how workspace plugins under `packages/plugins/` (e.g.
`plugin-discord`, `plugin-twitter`, `plugin-moltbook`, `plugin-firecrawl`) go
from "source in the monorepo" to "rows in `plugins` + `plugin_config` that
`plugin-job-scheduler` actually picks up."

## Why there is no seeder script

It is tempting to write `scripts/seed-plugins.ts` that inserts `plugin_config`
rows directly. Don't — `plugin_config.plugin_id` is a foreign key onto the
`plugins` table with `ON DELETE CASCADE`, so a `plugin_config` row without a
matching `plugins` row will fail to insert. The `plugins` row is not a seed
target either: it is created by `PluginLoader.installPlugin()` after the
manifest has been validated, capabilities checked, and the package staged on
disk.

## The actual registration path

1. **Discovery** — `PluginLoader` (`server/src/services/plugin-loader.ts`)
   scans `~/.paperclip/plugins/` and `node_modules` for packages whose name
   starts with `paperclip-plugin-`. Workspace packages are published under
   `@paperclipai/plugin-*`, so they are **not** auto-discovered by a running
   server.
2. **Installation** — An operator (or an agent with the right capability)
   calls `installPlugin()` via the `/api/plugins` route. This validates the
   manifest, writes a `plugins` row, copies the package into the local plugin
   directory, and allows `plugin_config` rows to be created through the
   plugin settings UI.
3. **Activation** — `activatePlugin()` resolves the entrypoint, spawns a
   worker, syncs job declarations into the cron registry, and registers the
   plugin with `plugin-job-scheduler`, `plugin-tool-dispatcher`, and
   `plugin-event-bus`.

## What to do when a workspace plugin is "dormant"

If `plugin-discord` or `plugin-twitter` are not running in production:

- Confirm they have been installed via the `/api/plugins` install flow on the
  target host — check the `plugins` table for a matching row. If absent, that
  is the fix: install via the plugins API, then configure via the settings
  UI.
- If installed but not configured, the `plugin_config` row will be missing or
  empty. Configure it via `PUT /api/plugins/:id/config` or the settings UI
  rather than writing raw SQL.
- The server log line `[plugin-job-scheduler] no jobs for plugin <id>` is the
  usual symptom of a plugin that is present in `plugins` but has not yet had
  its worker declare its jobs; check worker startup for errors.

## If you really need a seeder

A valid "seed" for a local dev environment looks like this, in order:

1. Run `installPlugin()` programmatically against a local path
   (`packages/plugins/plugin-foo`) — this creates the `plugins` row.
2. Write a default `plugin_config` row via the same API the settings UI
   calls.

Anything else will either violate FK constraints or leave the plugin system
in an inconsistent state where the DB has rows for a plugin the loader has
never seen.

---

## Plain-English walkthrough: register `coherencedaddy.moltbook`

This is the "I just want the plugin to turn on" version. Written for the
admin who doesn't care about foreign keys or worker entrypoints — they just
want moltbook to start posting.

### What "dormant" means
The `/automation-health` dashboard says
> *"Plugin manifest 'coherencedaddy.moltbook' exists on disk but is not
> registered in plugin_config"*

In plain English: **we have the plugin code, we have the moltbook API key in
the vault, but nobody has told the server "turn it on and remember my
settings."** The install step never ran.

The other plugins (Discord, Twitter, Firecrawl) ARE in the `plugins` table
but they're in an `error` state with
`Activation failed: Worker entrypoint not found` — those are a separate
problem (the packaged JS entrypoints weren't found at the expected path on
disk). Moltbook is the simpler case: just never installed at all.

### The three steps

**Step 1 — Open the Plugins admin page**

In the dashboard sidebar, click **Plugins** (or go directly to `/plugins`).
You will see a list of currently-installed plugins. Moltbook will not be
there. That's the bug.

**Step 2 — Click "Install plugin"**

At the top of the page there is an **Install plugin** button. Click it. A
dialog opens asking for the package path or name. Enter:

```
@paperclipai/plugin-moltbook
```

(Or if the UI prompts for a local path, point it at
`packages/plugins/plugin-moltbook` inside the team-dashboard repo on the
VPS.)

Click **Install**. The server will:
1. Read the plugin's `manifest.json` to see what permissions it wants (posting
   on moltbook.com, rate-limited HTTP calls, 3 scheduled jobs).
2. Stage the compiled code into the local plugins directory.
3. Create a row in the `plugins` table — this is "hello, I exist".
4. Create a default row in the `plugin_config` table — this is "here are
   my blank settings, please fill them in".

**Step 3 — Configure + activate**

Back on the Plugins page, Moltbook will now appear in the list with status
**Installed**. Click it to open its settings:

- **API key:** paste the value from `~/.config/moltbook/credentials.json`
  (or `$MOLTBOOK_API_KEY` from the VPS env).
- **Daily caps** (sanity guardrails — do not skip these):
  - Posts per day: `4`
  - Comments per day: `20`
  - Votes per day: `50`
- **Approval mode:** `manual` (recommended for the first 1–2 weeks — every
  generated post waits in a queue for you to approve).
- **Domain allowlist:** `www.moltbook.com` (do not touch).

Click **Save**, then click the **Activate** toggle at the top of the
settings page.

On activation the server will:
- Spawn the moltbook worker process
- Register its 3 cron jobs (`moltbook:ingest`, `moltbook:post`,
  `moltbook:engage`) into the plugin-job scheduler
- Start writing to the `moltbook_feed` + `moltbook_posts` tables

You should see them appear inside 30 seconds on the `/automation-health`
dashboard under **crons** with `ownerAgent: moltbook`, and the dormancy
warning should disappear.

### How to know it worked

- **`/automation-health`** — the warning "Plugin manifest 'coherencedaddy.
  moltbook' exists on disk but is not registered in plugin_config" is gone.
- **`/crons`** — `moltbook:*` jobs show up with recent `lastRunAt` values.
- **`/plugins`** — moltbook row status is `active`, not `installed` or
  `error`.
- **Moltbook dashboard on moltbook.com** — you should see new activity from
  the `coherencedaddy` account within 30–60 minutes (depends on the cron
  schedule).

### If something goes wrong

- **Install button says "Package not found"** — the package wasn't built
  into a shape the loader can find. SSH the VPS and run `pnpm install` +
  `pnpm --filter @paperclipai/plugin-moltbook build`, then retry.
- **Activation button says "Worker entrypoint not found"** — same problem
  the Discord + Twitter plugins currently have. The built JS isn't at the
  path the manifest points to. Rebuild with `pnpm --filter
  @paperclipai/plugin-moltbook build` and retry. If it persists, the
  package's `main` field in `package.json` is wrong.
- **API key is wrong** — the worker will post a warning to the plugin's log
  pane (`/plugins/coherencedaddy.moltbook/logs`) but stay running. Paste a
  correct key and **Save** to retry.

### What NOT to do

- Do not run raw SQL against `plugin_config`. It will fail on foreign keys,
  and even if it succeeds the loader won't know the plugin exists.
- Do not skip the `manual` approval mode on the first activation. Moltbook
  has 7 layers of content safety, but the approval queue is the one you
  control. Turn it off once you trust the output.
- Do not install all four plugins at once — start with Moltbook (it's the
  simplest and the one the current expansion is leaning on). Fix Discord /
  Twitter / Firecrawl separately after their "Worker entrypoint not found"
  root cause is sorted.
