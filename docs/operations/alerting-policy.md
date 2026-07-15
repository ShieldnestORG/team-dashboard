# Alerting Policy — immediate vs weekly recap

> **Cluster:** operations/alerting · **Tags:** alerts, email, severity, weekly recap, alert_events, cron watchdog, egress-watch · **Related:** [Cron Inventory](cron-inventory.md), [Agent Cron Ownership](../guides/agent-cron-ownership.md), [VPS Cheat Sheet](../deploy/vps-cheat-sheet.md)

Owner directive (2026-07-09): **the ops inbox gets an immediate email only for genuinely
important events; everything else lands in one predictable Sunday recap.** Before this,
every alert type emailed immediately and the inbox was flooded (cron watchdog + eval
failures + host egress alerts = multiple emails/day).

## Severity routing (`server/src/services/alerting.ts`)

`sendAlert(type, subject, body)` routes by type:

| Severity | Types | Behavior |
|---|---|---|
| **critical** | `service_down`, `service_recovered`, `health_down`, `disk_warning`, `memory_warning`, `cron_breaker`, `weekly_recap`, and all other non-routine types | Emailed immediately (Brevo-first, Proton SMTP fallback) **and** persisted to `alert_events` |
| **routine** | `cron_stale`, `eval_failed` | Persisted to `alert_events` only — surfaces in the Sunday recap |

- The routine set lives in `ROUTINE_TYPES` in `alerting.ts`. Keep it small: it exists to
  stop inbox noise, not to hide outages.
- The 1h per-type cooldown applies to both severities (bounds `alert_events` rows too).
- `cron_breaker` (circuit breaker auto-disabling a crash-looping job) got its own type on
  2026-07-09 — it previously shared `cron_stale`'s cooldown key, so a watchdog alert could
  silently suppress a breaker trip for an hour.
- **`service_down` is debounced** (`vps-monitor.ts`, `DOWN_ALERT_THRESHOLD = 2`, added
  2026-07-14): the every-3-min health check must fail **2 consecutive** times before a
  `service_down` email fires, and the paired `service_recovered` only sends if a
  `service_down` actually paged. A single transient timeout (e.g. a one-off 15s Ollama
  `/api/version` blip) no longer emails; a genuine outage still pages within a few minutes.

## Persistence: `alert_events` (migration 0151)

Every alert (emailed or not) inserts a row: `type`, `severity`, `subject`, `body`,
`email_sent`, `email_error`, `created_at`. Set up via `setAlertDb(db)` at boot
(`startAlertCrons`). Best-effort: a DB failure never blocks the alert path. The old
50-entry in-memory ring buffer (`GET /api/system-health/alerts`) still exists for the UI.

## The weekly recap (`alert:weekly-recap`, Sunday 08:00 UTC)

One email summarizing: last 7 days of `alert_events` grouped by type, currently unhealthy
crons (same filter as the watchdog), and the latest eval run. **Sends even when all
clear** — a missing Sunday email is itself a signal. Replaced `alert:digest` (daily 07:00
eval digest), whose `system_crons` row is deleted by migration 0151 because the registry
sync only upserts and an orphaned row would eventually flag as critically stale.

## Host-level egress alerts (VPS1 + VPS4, not in the app registry)

`/usr/local/bin/egress-watch.sh` (every 5 min) still emails immediately on threshold
breach — that layer is the miner/exfil tripwire and stays hair-triggered on **load15**.
Changes made 2026-07-09:

- **VPS1 TX threshold raised 512 KB/s → 4 MB/s** — the `tokns-ipfs` kubo node (deployed
  2026-07-02) legitimately pushes P2P traffic peaking ~2.1 MB/s, which had the old
  threshold alerting on normal workload 13–26×/day. load15 remains the primary
  compromise signal (miners peg cores; their bandwidth is tiny).
- **Daily summaries → weekly** (`egress-weekly-summary.sh`, Sundays 23:55, both boxes),
  aggregating a per-day table for the week.

## History / why this exists

The 2026-07 inbox flood had three stacked causes, only one of which was a real problem:

1. **A zombie team-dashboard container on VPS1** (leftover "rollback" from the 2026-05-10
   server swap, `restart: unless-stopped`) ran every cron in duplicate against prod Neon
   for two months on pre-fix code with a dead VPS3 `EMBED_URL`. It kept writing
   `last_error` into shared `system_crons` rows, and VPS4's watchdog honestly emailed
   about them — months after the underlying bugs were fixed. Stopped + `restart=no`
   2026-07-09. See the trap log in [VPS Cheat Sheet](../deploy/vps-cheat-sheet.md).
2. **VPS1 egress alerts on legitimate IPFS traffic** (threshold fixed above).
3. **A real issue**: the Anthropic API usage limit was reached (resets 2026-08-01), which
   made `eval:smoke` and `content:seo-engine` fail every day — each failure emailed.
