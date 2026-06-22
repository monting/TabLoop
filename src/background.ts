import type { Settings } from "./types.ts";
import type { TabInfo } from "./tabs.ts";
import {
  countRelevantTabs,
  isExemptUrl,
  isOverLimit,
  isStashableUrl,
  selectOldestTab,
} from "./tabs.ts";
import { loadSettings } from "./settings.ts";
import * as state from "./state.ts";
import { addToStash } from "./stash.ts";

function toTabInfo(tab: chrome.tabs.Tab): TabInfo | null {
  if (tab.id == null) return null;
  return {
    id: tab.id,
    pinned: tab.pinned,
    url: tab.url || tab.pendingUrl || undefined,
    windowId: tab.windowId,
    lastAccessed: tab.lastAccessed,
  };
}

function queryScopedTabs(
  settings: Settings,
  windowId: number,
): Promise<chrome.tabs.Tab[]> {
  return chrome.tabs.query(
    settings.limitScope === "per-window" ? { windowId } : {},
  );
}

// ---------------------------------------------------------------------------
// Tab-timing lifecycle
//
// Listeners are registered synchronously at the top level so the worker can be
// woken to handle them. Creation times are seeded on install and on every
// browser startup, because session storage (and tab ids) reset when the browser
// restarts. LRU uses Chrome's native lastAccessed, so it needs no tracking.
// ---------------------------------------------------------------------------

async function seedExistingTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await state.seed(tabs.filter((t) => t.id != null).map((t) => t.id!));
}

chrome.runtime.onInstalled.addListener(() => {
  void seedExistingTabs();

  chrome.contextMenus.create({
    id: "escape-hatch-tab",
    title: "New Escape Hatch Tab",
    contexts: ["action", "page"],
  });

  chrome.contextMenus.create({
    id: "escape-hatch-window",
    title: "New Escape Hatch Window",
    contexts: ["action", "page"],
  });
});
chrome.runtime.onStartup.addListener(() => {
  void seedExistingTabs();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void state.forget(tabId);
});

// ---------------------------------------------------------------------------
// Enforcement
//
// onCreated events are funnelled through a promise queue so bursts (session
// restore, middle-clicking links) are handled one-at-a-time and in order —
// none are dropped or left untracked.
// ---------------------------------------------------------------------------

let queue: Promise<void> = Promise.resolve();

// Tabs opened via the escape hatch must bypass the limit. A tab's id is only known
// once chrome.tabs.create resolves, and its onCreated event may fire first — so we
// track the in-flight creations, have handleCreated await them, then match by the
// concrete tab id. This avoids a one-shot flag being consumed by an unrelated tab
// opened around the same moment (or getting stuck set if a create fails).
const escapeTabIds = new Set<number>();
const escapeCreations = new Set<Promise<void>>();

function noteEscape(idPromise: Promise<number | undefined>): void {
  const p = idPromise
    .then((id) => {
      if (id != null) escapeTabIds.add(id);
    })
    .catch(() => {});
  escapeCreations.add(p);
  void p.finally(() => escapeCreations.delete(p));
}

chrome.tabs.onCreated.addListener((tab) => {
  queue = queue
    .then(() => handleCreated(tab))
    .catch((err) => console.error("TabLoop:", err));
});

chrome.runtime.onMessage.addListener((message) => {
  if (message === 'escape-hatch' || message === 'escape-hatch-tab') {
    noteEscape(chrome.tabs.create({}).then((t) => t.id));
  } else if (message === 'escape-hatch-window') {
    noteEscape(chrome.windows.create({}).then((w) => w?.tabs?.[0]?.id));
  } else if (typeof message === 'object' && message !== null) {
    if (message.type === 'escape-hatch-tab') {
      noteEscape(chrome.tabs.create({ url: message.url }).then((t) => t.id));
    }
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "escape-hatch-tab") {
    noteEscape(chrome.tabs.create({}).then((t) => t.id));
  } else if (info.menuItemId === "escape-hatch-window") {
    noteEscape(chrome.windows.create({}).then((w) => w?.tabs?.[0]?.id));
  }
});

async function handleCreated(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id == null) return;
  await state.recordCreated(tab.id);

  // Wait for any in-flight escape-hatch creations to register their tab id, then
  // let the matching tab through untouched.
  if (escapeCreations.size) await Promise.allSettled(escapeCreations);
  if (escapeTabIds.delete(tab.id)) return;

  // The extension's own settings page and Chrome's internal pages are exempt from
  // the limit — never block them, even when at capacity.
  if (isExemptUrl(tab.url || tab.pendingUrl)) return;

  const settings = await loadSettings();
  const tabs = (await queryScopedTabs(settings, tab.windowId))
    .map(toTabInfo)
    .filter((t): t is TabInfo => t !== null);

  // Ensure the newly created tab is counted, in case chrome.tabs.query missed it due to a race condition
  if (!tabs.some((t) => t.id === tab.id)) {
    const newTabInfo = toTabInfo(tab);
    if (newTabInfo) {
      tabs.push(newTabInfo);
    }
  }

  if (!isOverLimit(tabs, settings)) return;

  const times = await state.getTimes();
  const oldest = selectOldestTab(tabs, tab.id, times, settings);
  // Nothing is recyclable (all pinned/protected) — let the new tab through.
  if (!oldest) return;

  // Save the blocked destination to the stash so it isn't lost, then close the
  // new tab and surface the oldest one to be dealt with.
  const blockedUrl = tab.pendingUrl || tab.url;
  if (isStashableUrl(blockedUrl)) {
    await addToStash(blockedUrl);
  }

  let targetWindowId = tab.windowId;
  if (settings.limitBehavior === "focus") {
    targetWindowId = oldest.windowId;
  } else {
    if (oldest.windowId !== tab.windowId) {
      try {
        await chrome.tabs.move(oldest.id, { windowId: tab.windowId, index: -1 });
      } catch (err) {
        console.warn("TabLoop: Could not move oldest tab to new window:", err);
        targetWindowId = oldest.windowId;
      }
    }
  }

  await chrome.tabs.remove(tab.id);

  // Delay to let the browser process the tab closure and update focus states
  await new Promise((resolve) => setTimeout(resolve, 50));

  try {
    await chrome.tabs.update(oldest.id, { active: true });
    await chrome.windows.update(targetWindowId, { focused: true });
    await state.recordResurfaced(oldest.id);
  } catch (err) {
    console.warn("TabLoop: Could not activate oldest tab:", err);
  }
}

// ---------------------------------------------------------------------------
// Action badge: surfaces how many tab slots are still available.
// ---------------------------------------------------------------------------

async function updateBadge(): Promise<void> {
  const settings = await loadSettings();

  // When scoped per-window we show the *lowest* remaining across all windows,
  // giving the user a conservative (worst-case) number.
  const allTabs = (await chrome.tabs.query({}))
    .map(toTabInfo)
    .filter((t): t is TabInfo => t !== null);

  let slotsLeft: number;
  if (settings.limitScope === "per-window") {
    const byWindow = new Map<number, TabInfo[]>();
    for (const t of allTabs) {
      const list = byWindow.get(t.windowId) ?? [];
      list.push(t);
      byWindow.set(t.windowId, list);
    }
    const perWindowSlots = Array.from(byWindow.values()).map(
      (wTabs) => settings.maxTabs - countRelevantTabs(wTabs, settings),
    );
    // With no windows open, Math.min() would yield Infinity; fall back to a full limit.
    slotsLeft = perWindowSlots.length ? Math.min(...perWindowSlots) : settings.maxTabs;
  } else {
    slotsLeft = settings.maxTabs - countRelevantTabs(allTabs, settings);
  }

  if (slotsLeft <= 5) {
    const color = slotsLeft <= 3 ? "#ef4444" : "#22c55e"; // red when tight, green warning otherwise
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text: String(slotsLeft) });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

// Refresh when tabs come or go.
chrome.tabs.onCreated.addListener(() => void updateBadge());
chrome.tabs.onRemoved.addListener(() => void updateBadge());
// A tab navigating to/from an exempt page, or being (un)pinned, changes the relevant
// count without a create/remove — refresh on those too. Other onUpdated noise
// (loading state, favicon, title) is ignored to avoid needless work.
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.pinned !== undefined) {
    void updateBadge();
  }
});

// Refresh when settings change (maxTabs, excludePinned, etc.).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes["settings"]) {
    void updateBadge();
  }
});

// Reflect the current state whenever the worker spins up.
void updateBadge();
