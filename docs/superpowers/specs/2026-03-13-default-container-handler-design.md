# Default Container Handler — Design Spec

## Problem

Zen browser lacks a "default workspace" feature. External links open in whichever workspace is currently active. The "Open URL in Container" extension can route links to a Personal container, but causes a race condition: when Zen auto-reassigns a tab to a different container, focus flips back to Personal instead of following the tab.

## Root Cause

The extension creates an **active** tab in Personal, causing an immediate workspace switch. When Zen then removes that tab and creates a new one in the correct container, the removal just activates the previous tab in Personal — stranding the user there.

## Solution: Inactive Tab + Event-Driven Activation

Create the tab with `active: false` to avoid the premature workspace switch. Use browser events to determine what happened:
- **`tabs.onRemoved`** fires → Zen reassigned the tab → do nothing (Zen handles focus)
- **`webNavigation.onCommitted`** fires → page committed in our container, Zen didn't intercept → activate immediately
- **Fallback timeout (2s)** → safety net, activate if neither event fired

## Architecture

Minimal MV2 Firefox extension with a background script. No popup, no build step.

### Flow

1. Finicky rewrites external URL → `ext+container:name=Personal&url=https://example.com`
2. Firefox protocol handler → `opener.html#ext+container:name=Personal&url=...`
3. `background.js` detects opener tab via `tabs.onCreated` / `tabs.onUpdated`
4. Finds or creates the named container via `contextualIdentities` API
5. Closes the opener tab (returns focus to previously active tab)
6. Creates tab: `{ url, cookieStoreId, active: false }`
7. Waits for event-driven signal (`onRemoved`, `onCommitted`, or 2s timeout)
8. If tab still exists, activates it; if removed by Zen, no-op

### Files

```
src/
├── manifest.json   # MV2, protocol handler, background script, permissions
├── background.js   # All logic: tab detection, container management, event-driven activation
├── opener.html     # Empty HTML shell (required for protocol handler registration)
└── icon.svg        # Extension icon
```

### Permissions

- `contextualIdentities` — look up / create containers
- `cookies` — required alongside contextualIdentities
- `tabs` — create, activate, remove tabs
- `webNavigation` — detect when page commits (signals Zen didn't intercept)

### No Security Layer

The original extension uses signed URLs to prevent clickjacking. We omit this because:
- Finicky is the sole URL source (local machine, trusted)
- Simplicity is a priority

### Configurable

- `FALLBACK_TIMEOUT_MS = 2000` — constant at top of background.js, safety-net timeout
