# Postgres Array-Binding Footgun (`= ANY(...)`) with drizzle + postgres.js

> **Cluster:** db-footguns · **Tags:** drizzle, postgres.js, ANY, array-binding, malformed-array-literal · **Related:** [cron-inventory](../operations/cron-inventory.md), [agent-cron-ownership](agent-cron-ownership.md), [test-isolation](test-isolation.md), [branch-safety](branch-safety.md)

A recurring, silent data-layer bug in this repo. It compiles, passes types, and
often passes tests — then throws at runtime on every non-empty batch. It has bitten
us at least three times. Read this before writing any `WHERE col = ANY(...)`.

## The bug

Interpolating a JavaScript array straight into an `= ANY(...)` predicate:

```ts
// ❌ WRONG — do not do this
const emails = ["a@x.com", "b@x.com"];
await db.select().from(t).where(sql`LOWER(${t.email}) = ANY(${emails})`);
```

With **drizzle + postgres.js**, the `${emails}` is bound as a multi-element
parameter, so the SQL that reaches Postgres is:

```sql
LOWER(email) = ANY(($1, $2))
```

That `($1, $2)` is a **row/tuple expression**, not an array literal. Postgres tries
to coerce the row to the column's array type and fails:

```
error: malformed array literal: "(a@x.com,b@x.com)"
```

Key trap: the batch has to be **non-empty** to trigger it. An empty array often
short-circuits or renders differently, so the query "works" in a smoke test that
happens to run against zero rows — and then throws the moment real data flows.

## What does NOT fix it

Adding a cast on the **row** does not help — you are still handing Postgres a tuple:

```ts
// ❌ STILL WRONG — the cast is on the tuple, not on a real array literal
sql`... = ANY(${emails}::text[])`
sql`... = ANY(${ids}::uuid[])`
```

## Safe forms

Pick one:

1. **drizzle `inArray()`** — the idiomatic choice; drizzle emits a correct
   parameterized `IN (...)` for you:

   ```ts
   import { inArray } from "drizzle-orm";
   await db.select().from(t).where(inArray(t.email, emails));
   ```

2. **Scalar loop / per-row query** — when the set is tiny or you already loop.
   One bound scalar per iteration, no array binding at all.

3. **Explicit `ARRAY[...]` literal built from per-element `sql` fragments** — when
   you specifically need `= ANY(ARRAY[...])` (e.g. combining with other array
   operators):

   ```ts
   sql`LOWER(${t.email}) = ANY(ARRAY[${sql.join(
     emails.map((e) => sql`${e}`),
     sql`, `,
   )}]::text[])`
   ```

   Here each element is its own bound parameter and `ARRAY[$1, $2]::text[]` is a
   genuine array literal — this is the form the 2026-07-07 university-crons fix used.

## Recurrences in this repo (learn from these)

| When | Where | Symptom |
|------|-------|---------|
| PR #113 (social-relayer) | batch-claim query; regression test at `server/src/__tests__/social-relayer-batch-claim.test.ts` | `malformed array literal` claiming a batch of relay rows |
| `kg:deduplicate-tags` | `knowledge-graph-crons.ts` (tag-merge query) | array-of-tag-ids passed to `= ANY(...)` |
| 2026-07-07 university crons | `server/src/services/university-crons.ts:666 / 685 / 837 / 967` (`university:streak-nudge`, `university:reengage`, `university:dunning-d3`, `university:dunning-d7`) | silent `malformed array literal` on every non-empty email batch; fixed to `= ANY(ARRAY[...]::text[])` |

## Rule of thumb

If you are about to type `= ANY(${someJsArray})`, stop. Reach for `inArray()`
first. If you genuinely need `ANY(ARRAY[...])`, build the literal from per-element
`sql` fragments (form 3) — never interpolate the raw array, and never rely on a
`::type[]` cast on the tuple to save you.
