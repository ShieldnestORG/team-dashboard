# Database round trips: count the waits, not the queries

> **Cluster:** db-footguns · **Tags:** latency, neon, round-trip, drizzle, postgres.js, promise-all · **Related:** [pg-array-binding-footgun](pg-array-binding-footgun.md), [production](../deploy/production.md), [test-isolation](test-isolation.md)

Production's database is a network hop from the app, so a request's time is set by how
many queries it waits for **one after another**. What the queries do inside Postgres
barely registers. Read this before adding a query to a hot path (auth middleware,
anything agents or the Mac's session-start hook call).

## Measured 2026-10-21 (inside `team-dashboard-server-1` on VPS4)

| What | Time | Why |
|---|---:|---|
| Network round trip VPS4 → Neon `us-east-1` (`SELECT 1`, 10 runs) | **55 ms** (55.1–55.6) | distance |
| One drizzle query **with parameters** | **~110 ms** | 2 round trips, see below |
| One query with no parameters | ~55 ms | 1 round trip |
| The open-issue list executing inside Postgres (`EXPLAIN ANALYZE`) | 0.24 ms | not the problem |
| A new connection (TCP + TLS + auth) | ~630 ms | the pool keeps connections warm; spaced requests did not pay it |

**Why two round trips:** drizzle-orm 0.45.2 sends every query through postgres.js
`sql.unsafe(query, params)`. postgres.js 3.4.8 makes `unsafe()` unprepared
(`prepare: false`, `src/index.js:122`), and an unprepared query that has parameters is
described first (`describeFirst`, `src/connection.js:238`). Its bind is sent only after
the server answers (`src/connection.js:633`).

## Rules

1. **Independent queries go in one `Promise.all`.** Two lookups in a row cost ~220 ms;
   side by side they cost ~110 ms.
2. **Never make a request wait for a bookkeeping write** (`lastUsedAt`, "touch"). Fire it
   and log a failure: `void db.update(...).catch((err) => logger.warn(...))`.
3. **One query beats lookup-then-query.** Use a join or an `inArray(col, subquery)`
   rather than fetching ids first.
4. **Measure it.** `server/src/__tests__/db-round-trips.test.ts` puts a latency proxy
   (`helpers/latency-proxy.ts`) in front of Postgres and pins the round-trip count of
   agent-key auth and `GET /companies/:id/issues`. The migrations need pgvector, which
   embedded Postgres lacks, so run it against a throwaway server:
   `ROUND_TRIPS_PG_URL=postgres://user:pass@127.0.0.1:<port>/postgres npx vitest run src/__tests__/db-round-trips.test.ts`
   (from `server/`, with a `pgvector/pgvector:pg17` container). Add `DB_RTT_MS=55` to use
   production's distance.

## What fixed the session-start hook

Agent Ops' `tix ls` (every Claude session start on the owner's Mac) calls
`GET /companies/:id/issues?status=todo,in_progress,blocked` with an agent key. It waited
for 6 queries one after another: board-key lookup, agent-key lookup, `lastUsedAt`
UPDATE, agent lookup, issues, labels (plus active runs when an open issue has one).
After this guide's rules it waits for 3: both key lookups at once with the agent joined,
then the issues, then labels and runs at once.

If the database moves onto VPS4 (plan on branch `docs/db-move-neon-to-vps4`), a round
trip drops from 55 ms to a fraction of a millisecond, and these rules matter far less.
