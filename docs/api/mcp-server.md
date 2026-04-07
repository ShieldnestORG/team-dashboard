# MCP Server

Model Context Protocol server exposing Team Dashboard task management as 35 tools for AI agents.

## Package

Location: `packages/mcp-server/`

## Setup

```bash
# Install dependencies
cd packages/mcp-server && pnpm install

# Run in development
pnpm dev

# Build
pnpm build

# Start production
pnpm start
# or
npx paperclip-mcp
```

## Configuration

Environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PAPERCLIP_API_URL` | No | `http://localhost:3100` | Team Dashboard API base URL |
| `PAPERCLIP_API_TOKEN` | Yes | — | Agent JWT or API key for authentication |
| `PAPERCLIP_COMPANY_ID` | Yes | — | Company UUID (e.g., `8365d8c2-ea73-4c04-af78-a7db3ee7ecd4`) |

## Transport

Uses **stdio** transport. Configure in your MCP client:

```json
{
  "mcpServers": {
    "paperclip": {
      "command": "npx",
      "args": ["paperclip-mcp"],
      "env": {
        "PAPERCLIP_API_URL": "http://localhost:3100",
        "PAPERCLIP_API_TOKEN": "your-jwt-token",
        "PAPERCLIP_COMPANY_ID": "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4"
      }
    }
  }
}
```

## Tools (35 total)

### Issues (6 tools)
| Tool | Description |
|------|-------------|
| `list_issues` | List and filter issues (query, team, status, assignee, project, labels, priority) |
| `get_issue` | Get issue by ID or identifier (e.g., `ENG-123`) with all relations expanded |
| `create_issue` | Create a new issue with title, team, description, priority, assignee, labels |
| `update_issue` | Update issue fields (title, status, priority, assignee, estimate, due date) |
| `archive_issue` | Archive an issue (soft delete) |
| `list_my_issues` | Convenience: list issues assigned to the current agent |

### Projects (5 tools)
| Tool | Description |
|------|-------------|
| `list_projects` | List projects with optional status filter |
| `get_project` | Get project details with milestones and issue counts |
| `create_project` | Create a new project |
| `update_project` | Update project fields |
| `archive_project` | Archive a project |

### Milestones (4 tools)
| Tool | Description |
|------|-------------|
| `list_milestones` | List milestones for a project |
| `get_milestone` | Get milestone details with issue breakdown |
| `create_milestone` | Create a milestone within a project |
| `update_milestone` | Update milestone fields |

### Labels (4 tools)
| Tool | Description |
|------|-------------|
| `list_labels` | List all labels |
| `get_label` | Get label details |
| `create_label` | Create a new label (name, color, group) |
| `update_label` | Update label fields |

### Teams (2 tools)
| Tool | Description |
|------|-------------|
| `list_teams` | List all teams |
| `get_team` | Get team details with members and workflow states |

### Workflow States (2 tools)
| Tool | Description |
|------|-------------|
| `list_workflow_states` | List workflow states for a team |
| `get_workflow_state` | Get workflow state details |

### Comments (4 tools)
| Tool | Description |
|------|-------------|
| `list_comments` | List comments on an issue |
| `create_comment` | Add a comment to an issue |
| `update_comment` | Edit a comment |
| `resolve_comment` | Mark a comment as resolved |

### Issue Relations (3 tools)
| Tool | Description |
|------|-------------|
| `list_issue_relations` | List relations for an issue |
| `create_issue_relation` | Create a relation (related, blocks, blocked_by, duplicate) |
| `delete_issue_relation` | Remove a relation |

### Initiatives (5 tools)
| Tool | Description |
|------|-------------|
| `list_initiatives` | List initiatives/goals |
| `get_initiative` | Get initiative details with linked projects and issues |
| `create_initiative` | Create a new initiative |
| `update_initiative` | Update initiative fields |
| `archive_initiative` | Archive an initiative |

## Architecture

```
MCP Client (Claude, Codex, etc.)
    ↕ stdio
packages/mcp-server/src/index.ts  (MCP Server)
    ↕ HTTP (fetch)
packages/mcp-server/src/client.ts (REST Client)
    ↕ HTTP
Team Dashboard API (:3100)
```

## Specification

Full parameter schemas and return types are documented in `doc/TASKS-mcp.md`.
