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
