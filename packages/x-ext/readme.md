# TestMedia Bot — Chrome Extension

A Chrome Extension that injects a floating bot widget into X.com.
Built in phases — this is Phase 1 (UI only).

---

## Folder Structure
```
testmedia-extension/
├── manifest.json       — Extension config & permissions
├── background.js       — Navigates to x.com on icon click
├── content.js          — Injects floating UI into x.com
└── README.md
```

---

## Installation

1. Open Chrome → go to `chrome://extensions`
2. Turn on **Developer Mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `testmedia-extension` folder
5. Click the extension icon in your toolbar — it navigates to x.com and the widget appears

---

## Current Features (Phase 1)

- Clicking the extension icon navigates to `https://x.com/home`
- A floating dark widget injects into the top-right corner of the page
- ON/OFF toggle switch with smooth spring animation
- Green pulsing dot indicator when active
- Toggle state persists across reloads via `chrome.storage.local`
- Draggable — grab the header and move it anywhere on screen
- Survives X.com SPA navigation — stays visible as you browse

---

## Phases

| Phase | Status | Description |
|---|---|---|
| 1 — UI | ✅ Done | Floating widget, toggle, drag, state persistence |
| 2 — Actions | 🔜 Next | Post, like, comment, follow |
| 3 — Scheduler | 🔜 Next | Random daily scheduling (3-6x/day) |
| 4 — Content | 🔜 Next | Google Sheets + AI content generation |

---

## How to Reload After Changes

Go to `chrome://extensions` → click the **refresh icon** on the extension card.