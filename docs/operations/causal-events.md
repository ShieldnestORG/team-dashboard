# Causal Events — Operations Guide

PyRapide / RAPIDE-inspired observability layer over `activity_log`. Lets you
trace *why* something happened — backward to its causes, forward to its
effects — across the 24-cron / 13-agent surface.

## What it adds

Migration `0113_causal_events.sql` (additive, non-blocking) extends
`activity_log` with two columns:

- `event_kind TEXT` — dotted namespace (`watchtower.query.sent`,
  `stripe.checkout.completed`, `agent.creditscore-content.run.started`, …).
  Legacy rows have `NULL` here. New rows written via `recordEvent()` always
  populate it.
- `caused_by UUID[]` — array of parent `activity_log.id` values. An array,
  not a single FK, because some events have multiple parents (e.g. a
  `watchtower.run.completed` is caused by *every* `watchtower.query.response`
  in the run).

A new table `event_constraints` stores declarative "every X within N ms
must produce Y" patterns. A shared cron walks it every 5 min and emits
`causal.constraint.violated` events on violations.

## Event-kind namespace convention

```
<system>.<domain>.<action>.<phase?>
```

- First segment is the system/agent name (`watchtower`, `creditscore`,
  `agent`, `stripe`, `webhook`, `causal`).
- Second segment is the domain or workflow (`subscription`, `query`,
  `checkout`, `run`).
- Third segment is the action or noun (`started`, `sent`, `response`,
  `completed`, `created`).
- Optional fourth phase (`failed`, `retried`).

Examples already in use:

| Kind | Emitter |
|---|---|
| `webhook.stripe.received` | Stripe webhook entry (3 webhooks) |
| `webhook.stripe.handled` | Stripe webhook per-branch terminator |
| `watchtower.run.started` / `watchtower.run.completed` | Watchtower runner |
| `watchtower.query.sent` / `watchtower.query.response` | Per-engine query |
| `watchtower.results.persisted` | Persist step |
| `watchtower.subscription.created` | Checkout fulfillment |
| `intel.subscription.created` | Intel-billing checkout |
| `creditscore.subscription.created` | CreditScore checkout |
| `causal.constraint.violated` | Constraint cron |
| `agent.<agent-name>.run.*` | The 10 instrumented agents |

When adding a new event kind: pick the dotted segment that matches an
existing pattern. Don't invent a new first segment if one already exists.

## How `caused_by` chains events

`recordEvent()` returns the new event's UUID. To chain, pass that UUID into
`causedBy` of the next event:

```ts
const runId = await recordEvent(db, {
  kind: "watchtower.run.started",
  companyId, entityId: subscriptionId,
  payload: { prompts: 25 },
});
const sentId = await recordEvent(db, {
  kind: "watchtower.query.sent",
  companyId, entityId: subscriptionId,
  causedBy: [runId],
  payload: { engine: "claude" },
});
await recordEvent(db, {
  kind: "watchtower.query.response",
  companyId, entityId: subscriptionId,
  causedBy: [sentId],
  payload: { engine: "claude", latencyMs, ok },
});
```

Multi-parent is supported — e.g. a final `watchtower.run.completed` can list
every query response as a parent.

## Traversal limit

The `/causal-events/:id` endpoint walks **3 hops** of ancestors AND
3 hops of descendants. This is a hard cap to keep the DAG viewer fast and
prevent runaway joins on long agent chains. If a chain is deeper than 3
hops, you'll see "..." in the viewer; click any descendant to re-center.

Descendant lookup uses the GIN index on `activity_log.caused_by` — see the
index size note inline in `packages/db/src/migrations/0113_causal_events.sql`.

## Adding a new constraint

### Via UI

Open `/event-constraints`, click **+ New Constraint**, fill in:

- **Kind** — your label, e.g. `creditscore:report-emails`.
- **Pattern.of** — the parent event kind.
- **Pattern.require** — the child event kind required after the parent.
- **Max lag (ms)** — how long a child has to appear before the parent is
  considered a violator.
- **Enabled** — flip off to suspend a constraint without deleting it.

### Via SQL (for seeding or backfill)

```sql
INSERT INTO event_constraints (kind, pattern, max_lag_ms, enabled)
VALUES (
  'watchtower:query-completes',
  '{"of":"watchtower.query.sent","require":"watchtower.query.response"}'::jsonb,
  60000,
  TRUE
);
```

Seeded defaults at boot (see `seedDefaultEventConstraints` in
`server/src/services/causal-constraints-cron.ts`):

- `watchtower:query-completes` — query.sent → query.response within 60 s.
- `watchtower:run-completes` — run.started → run.completed within 10 min.

Seeding is idempotent — existing kinds are skipped.

## Kill switches

Two independent env vars, both default `true`:

| Var | Effect |
|---|---|
| `CAUSAL_EVENTS_ENABLED=false` | Master switch. `recordEvent()` becomes a no-op returning `""`. Use if `caused_by` / `event_kind` column writes are misbehaving and you need to silence the whole layer without redeploying observed code. |
| `CAUSAL_CONSTRAINTS_ENABLED=false` | Cron-only switch. The `causal-constraints:check` job and the default-constraint seed are skipped at boot. Use if the violation query itself is generating spurious `causal.constraint.violated` events. Does NOT stop new events being recorded — for that, use `CAUSAL_EVENTS_ENABLED`. |

Set in `/opt/team-dashboard/.env` on VPS4, then `docker compose up -d` to
take effect. Both are documented in
[docs/deploy/env-vars.md](../deploy/env-vars.md).

## Cron schedule

- **`causal-constraints:check`** — every 5 min. Owner: `causal`. Source:
  `server/src/services/causal-constraints-cron.ts`. Registered via
  `startCausalConstraintsCron(db)` in `server/src/app.ts`. Skipped at boot
  when `CAUSAL_CONSTRAINTS_ENABLED=false`.

Per-run summary (constraintsChecked, totalViolations, errors) is pino-logged
at `info`. Violations themselves log at `warn` with parent event id and
entity id.

## Safety contracts

- `recordEvent()` catches all throws (DB error, validation, JSON
  serialization, array marshalling). It also `try/catch`-wraps the warn
  logger so even logger failures cannot escape.
- Stripe webhook handlers rely on that internal swallow — they deliberately
  do NOT wrap `recordEvent` calls in extra `try/catch`. Inline comments at
  the 3 webhook entrypoints (`watchtower-checkout.ts`, `intel-billing.ts`,
  `creditscore.ts`) document this contract.

## See also

- [Stigmergy Bridge follow-ups](../plans/stigmergy-followups.md) — related
  event-driven knowledge graph work.
- [Structure Diagram Policy](../architecture/structure-diagram-policy.md) —
  the Monitor subgraph in `company-structure.mmd` contains the
  CausalEventsSvc + CausalCron nodes.
