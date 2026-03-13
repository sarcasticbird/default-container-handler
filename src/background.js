/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const ZEN_GRACE_PERIOD_MS = 300;
const FALLBACK_TIMEOUT_MS = 2000;
const PROTOCOL_PREFIX = "ext+container:";
const OPENER_PATH = "/opener.html#";

const handledTabs = new Set();

function parseParamsFromUrl(tabUrl) {
    const hashIndex = tabUrl.indexOf("#");
    if (hashIndex === -1) return null;

    const uri = decodeURIComponent(tabUrl.substring(hashIndex + 1));
    if (!uri.startsWith(PROTOCOL_PREFIX)) return null;

    const qs = new URLSearchParams(uri.substring(PROTOCOL_PREFIX.length));
    const name = qs.get("name");
    const url = qs.get("url");

    if (!name || !url) return null;
    return { name, url };
}

async function getOrCreateContainer(name) {
    const containers = await browser.contextualIdentities.query({ name });

    if (containers.length > 0) {
        return containers[0];
    }

    return browser.contextualIdentities.create({
        name,
        color: "blue",
        icon: "fingerprint",
    });
}

function waitForTabSettled(tabId) {
    // Capture all new tab IDs created during the settle window — one of these
    // will be Zen's replacement if it reassigns our tab.
    const capturedTabIds = [];
    const captureNewTab = (tab) => {
        if (tab.id !== tabId) capturedTabIds.push(tab.id);
    };
    browser.tabs.onCreated.addListener(captureNewTab);

    return new Promise((resolve) => {
        let graceTimer = null;

        const cleanup = () => {
            browser.tabs.onRemoved.removeListener(onRemoved);
            browser.webNavigation.onCommitted.removeListener(onCommitted);
            browser.tabs.onCreated.removeListener(captureNewTab);
            clearTimeout(timer);
            clearTimeout(graceTimer);
        };

        const onRemoved = (removedTabId) => {
            if (removedTabId !== tabId) return;
            // Wait a moment for Zen to create the replacement
            browser.webNavigation.onCommitted.removeListener(onCommitted);
            clearTimeout(timer);
            graceTimer = setTimeout(() => {
                cleanup();
                resolve({ result: "removed", capturedTabIds });
            }, 200);
        };

        const onCommitted = (details) => {
            if (details.tabId !== tabId || details.frameId !== 0) return;
            browser.webNavigation.onCommitted.removeListener(onCommitted);
            clearTimeout(timer);
            graceTimer = setTimeout(() => {
                cleanup();
                resolve({ result: "committed", capturedTabIds: [] });
            }, ZEN_GRACE_PERIOD_MS);
        };

        const timer = setTimeout(() => {
            cleanup();
            resolve({ result: "timeout", capturedTabIds: [] });
        }, FALLBACK_TIMEOUT_MS);

        browser.tabs.onRemoved.addListener(onRemoved);
        browser.webNavigation.onCommitted.addListener(onCommitted);
    });
}

// Find Zen's replacement tab among captured IDs by checking each one.
// browser.tabs.get(id) works for ANY tab regardless of Zen's workspace filtering.
async function findReplacement(capturedTabIds, targetUrl) {
    const baseUrl = targetUrl.split("#")[0];
    for (const id of capturedTabIds) {
        try {
            const tab = await browser.tabs.get(id);
            const tabBase = (tab.url || "").split("#")[0];
            const pendingBase = (tab.pendingUrl || "").split("#")[0];
            if (tabBase === baseUrl || pendingBase === baseUrl) {
                return tab;
            }
        } catch (_) {
            // Tab already gone
        }
    }
    // If no URL match, try the highest ID (most recently created) as a heuristic
    if (capturedTabIds.length > 0) {
        const lastId = capturedTabIds[capturedTabIds.length - 1];
        try {
            return await browser.tabs.get(lastId);
        } catch (_) {}
    }
    return null;
}

async function handleOpenerTab(openerTabId, tabUrl) {
    if (handledTabs.has(openerTabId)) return;
    handledTabs.add(openerTabId);

    const params = parseParamsFromUrl(tabUrl);
    if (!params) {
        handledTabs.delete(openerTabId);
        return;
    }

    const container = await getOrCreateContainer(params.name);

    await browser.tabs.remove(openerTabId);
    handledTabs.delete(openerTabId);

    const newTab = await browser.tabs.create({
        url: params.url,
        cookieStoreId: container.cookieStoreId,
        active: false,
    });

    const { result, capturedTabIds } = await waitForTabSettled(newTab.id);

    if (result === "removed") {
        const replacement = await findReplacement(capturedTabIds, params.url);
        if (replacement) {
            // tabs.update({ active: true }) does NOT trigger Zen's workspace
            // switch — only tab CREATION does. Create a new active tab in the
            // same container first (triggers workspace switch), then clean up
            // Zen's replacement to avoid a brief flash of another tab.
            const finalTab = await browser.tabs.create({
                url: params.url,
                cookieStoreId: replacement.cookieStoreId,
                active: true,
            });
            try {
                await browser.tabs.remove(replacement.id);
            } catch (_) {}
        }
        return;
    }

    // Tab wasn't removed — Zen didn't reassign. Activate it.
    try {
        await browser.tabs.get(newTab.id);
        await browser.tabs.update(newTab.id, { active: true });
    } catch (_) {}
}

// Catch opener tabs as early as possible.
browser.tabs.onCreated.addListener((tab) => {
    if (tab.url && tab.url.includes(OPENER_PATH)) {
        handleOpenerTab(tab.id, tab.url);
    }
});

// Fallback if onCreated didn't have the URL yet.
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url || tab.url;
    if (url && url.includes(OPENER_PATH)) {
        handleOpenerTab(tabId, url);
    }
});
