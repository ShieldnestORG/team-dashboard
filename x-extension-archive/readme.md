# X Extension (Archived)

This Chrome extension ("Tokns Automation Bot") has been replaced by server-side X API v2 integration with OAuth 2.0.

The extension previously ran on x.com pages to execute posting and engagement actions via DOM manipulation. That approach has been superseded by direct API calls from the VPS backend.

## What replaced it
- `server/src/services/x-api/` — X API client with OAuth
- `packages/plugins/plugin-twitter/` — Refactored plugin (no extension dependency)

## Status
Archived 2026-04-06. Not maintained.
