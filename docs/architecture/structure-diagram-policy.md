# Structure Diagram Policy — Team Dashboard

## Overview
The company structure Mermaid diagram (`/structure` page) is a **living document** and the single source of truth for the backend topology of the Team Dashboard. It must stay in sync with the codebase at all times.

## Maintenance Rules

### 1. Mandatory Updates
**Every structural change must include a corresponding update to the structure diagram.** Any commit that adds, removes, or restructures the following must trigger an update:
- Backend services (new files in `server/src/services/`)
- API routes (new files in `server/src/routes/`)
- Cron jobs (newly added or modified schedules)
- Plugin services (newly added or modified plugin workers)
- Route mounting changes in `server/src/app.ts`
- Visual backends (newly added providers)

### 2. The Update Process
Updates are performed via the API:
1. **Read current diagram**: `GET /api/companies/:companyId/structure`
2. **Modify Mermaid source**: Update the graph to reflect the new service, route, or cron.
3. **Save changes**: `PUT /api/companies/:companyId/structure` with:
   - `body`: The updated Mermaid source.
   - `changeSummary`: A dated changelog entry (e.g., `"2026-04-15: added Knowledge Graph agents, updated cron counts"`).

Use `TEAM_DASHBOARD_COMPANY_ID` (`8365d8c2-ea73-4c04-af78-a7db3ee7ecd4`) as the companyId.

### 3. Fallback Synchronization
The `DEFAULT_DIAGRAM` constant in `ui/src/pages/Structure.tsx` must be kept in sync with the persisted state so that new installations render an accurate diagram from the start.

### 4. Audit and Fix
If you notice the diagram is stale, missing features, or has broken arrows during any session, fix it immediately. Do not defer this task.
