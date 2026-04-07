# X Bot — Chrome Extension

Standalone Chrome extension ("Tokns Automation Bot") for X/Twitter automation via DOM manipulation.

## Usage
1. Open `chrome://extensions` in Chrome
2. Enable Developer Mode
3. Click "Load unpacked" and select this directory
4. Navigate to x.com — the bot widget will appear

## How it works
- Injects content scripts into x.com pages at `document_start`
- Polls the dashboard backend for tasks (posts, missions, engagement)
- Executes actions via X.com's internal GraphQL API + DOM manipulation
- Anti-bot: jittered timing (12-25s cycles), breathing pauses, daily limits

## Related
- `packages/plugins/plugin-twitter/` — Dashboard plugin (queues tasks for this extension or X API v2)
- `server/src/services/x-api/` — Server-side X API v2 integration (alternative to this extension)
