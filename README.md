# Default Container Handler

A Firefox/Zen browser extension that routes all external links into a default container (e.g. "Personal"), with graceful handling when Zen reassigns the tab to a different container based on its workspace rules.

## The Problem

Zen browser doesn't have a "default workspace" feature. External links open in whichever workspace happens to be active. Extensions like "Open URL in Container" can route links to a specific container, but cause a race condition — when Zen auto-reassigns the tab to a different container, focus flips back to the original workspace instead of following the tab.

## How It Works

1. [Finicky](https://github.com/nicck/finicky) rewrites all external URLs using the `ext+container:` protocol
2. Firefox's protocol handler opens the extension's `opener.html`
3. The background script detects the opener tab, parses the container name and URL
4. Closes the opener tab and creates an **inactive** tab in the default container
5. Listens for Zen's response:
   - **Tab removed** → Zen reassigned it to another container → creates a new active tab in the correct container (triggering Zen's workspace switch)
   - **Page committed** → Zen didn't intercept → activates the tab in the default container
   - **Timeout (2s)** → safety net fallback

## Installation

### Prerequisites

- [Zen Browser](https://zen-browser.app/)
- [Finicky](https://github.com/nicck/finicky) (macOS URL rewriter)

### Set up Finicky

Create or update your Finicky config (`~/.finicky.js` or `~/.finicky.ts`):

```js
export default {
  defaultBrowser: "Zen",
  rewrite: [
    {
      match: "*",
      url: (url) =>
        `ext+container:name=Personal&url=${encodeURIComponent(url.toString())}`,
    },
  ],
};
```

Change `Personal` to whatever container name you want as your default.

### Install the extension

1. Download the latest `.zip` from the [releases](https://github.com/sarcasticbird/default-container-handler/releases) page (or build it yourself — see below)
2. In Zen, go to `about:config` and set `xpinstall.signatures.required` to `false`
3. Go to `about:addons` → gear icon → **Install Add-on From File** → select the `.zip`
4. When prompted, select **Default Container Handler** as the protocol handler for `ext+container:` links

### Building from source

```sh
npm install --global web-ext
web-ext build --source-dir src --artifacts-dir dist
```

The built extension will be at `dist/default_container_handler-<version>.zip`.

## License

[MPL-2.0](http://mozilla.org/MPL/2.0/)
