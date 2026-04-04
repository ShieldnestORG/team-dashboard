---
name: structure-updater
description: >
  Scan the backend codebase (services, routes, crons, app.ts) and regenerate
  the company structure Mermaid diagram to reflect the current architecture.
  Use after architectural changes, on a periodic schedule, or when asked to
  update the structure diagram.
---

# Structure Updater Skill

Scan the backend and regenerate the architecture Mermaid diagram.

## When to Use

- After adding/removing services, routes, or cron jobs
- Periodic architecture audit (e.g. weekly)
- When asked "update the structure diagram" or "refresh the architecture map"
- After merging feature branches that add new backend services

## What to Scan

| Source | Path | What to Extract |
|--------|------|-----------------|
| App entry | `server/src/app.ts` | Route mounts, cron scheduler starts, middleware |
| Services | `server/src/services/*.ts` | Service names, dependencies between services |
| Routes | `server/src/routes/*.ts` | API endpoint groups |
| Crons | `server/src/services/*-crons.ts` | Scheduled job names and intervals |
| Visual backends | `server/src/services/visual-backends/` | Backend providers |
| Platform publishers | `server/src/services/platform-publishers/` | Publisher targets |
| Content templates | `server/src/content-templates/` | Personality agents |

## Diagram Rules

### Color Coding by Domain

| Domain | Fill | Stroke |
|--------|------|--------|
| Core Business | `#dbeafe` | `#3b82f6` |
| Agent Execution | `#fce7f3` | `#ec4899` |
| Content Pipeline | `#dcfce7` | `#22c55e` |
| Visual Backends | `#d1fae5` | `#10b981` |
| Intel Engine | `#ffedd5` | `#f97316` |
| Plugin System | `#f3e8ff` | `#a855f7` |
| Monitoring | `#fee2e2` | `#ef4444` |
| Financial | `#ccfbf1` | `#14b8a6` |
| External Services | `#f1f5f9` | `#94a3b8` |

### Structure

- Use `graph TB` (top-to-bottom)
- Group related services in `subgraph` blocks with `style` directives
- Show data flow arrows between services (e.g. `ContentCrons --> ContentSvc`)
- Include service descriptions in node labels using `<br/><i>description</i>`
- The Express App node should be gold/amber: `fill:#fbbf24,stroke:#d97706`

### Accuracy Rules

- Only include services that actually exist in the codebase
- Never fabricate connections — verify by reading imports and function calls
- If a service file was deleted, remove its node
- If a new service was added, add it to the correct subgraph
- Keep cron schedule info current (read from the actual cron files)

## How to Save

```
PUT /api/companies/8365d8c2-ea73-4c04-af78-a7db3ee7ecd4/structure
Content-Type: application/json
Authorization: Bearer <agent-api-key>

{
  "body": "<full mermaid diagram source>",
  "changeSummary": "Added X service, removed Y route, updated Z cron schedule"
}
```

## Verification

After generating the diagram, verify it renders by checking:
1. Valid Mermaid syntax (no unclosed quotes, matching subgraph/end pairs)
2. All node IDs are unique
3. All arrow targets reference existing nodes
4. Subgraph names don't conflict with node IDs
