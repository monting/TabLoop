import type { Settings } from './types';
import type { TabInfo } from './tabs';
import { countRelevantTabs, isExemptUrl, isOverLimit, isStashableUrl, selectOldestTab } from './tabs';
import { loadSettings } from './settings';
import * as state from './state';
import { addToStash } from './stash';

function toTabInfo(tab: chrome.tabs.Tab): TabInfo | null {
  if (tab.id == null) return null;
  return {
    id: tab.id,
    pinned: tab.pinned,
    incognito: tab.incognito,
    url: tab.url || tab.pendingUrl || undefined,
    windowId: tab.windowId,
    lastAccessed: tab.lastAccessed,
  };
}

function queryScopedTabs(settings: Settings, windowId: number): Promise<chrome.tabs.Tab[]> {
  return chrome.tabs.query(settings.limitScope === 'per-window' ? { windowId } : {});
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

chrome.tabs.onCreated.addListener((tab) => {
  queue = queue.then(() => handleCreated(tab)).catch((err) => console.error('TabLoop:', err));
});

async function handleCreated(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id == null) return;
  await state.recordCreated(tab.id);

  // The extension's own settings page and Chrome's internal pages are exempt from
  // the limit — never block them, even when at capacity.
  if (isExemptUrl(tab.url || tab.pendingUrl)) return;

  const settings = await loadSettings();
  const tabs = (await queryScopedTabs(settings, tab.windowId))
    .map(toTabInfo)
    .filter((t): t is TabInfo => t !== null);

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

  await chrome.tabs.remove(tab.id);
  if (oldest.windowId !== tab.windowId) {
    await chrome.tabs.move(oldest.id, { windowId: tab.windowId, index: -1 });
  }
  await chrome.tabs.update(oldest.id, { active: true });
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
  if (settings.limitScope === 'per-window') {
    const byWindow = new Map<number, TabInfo[]>();
    for (const t of allTabs) {
      const list = byWindow.get(t.windowId) ?? [];
      list.push(t);
      byWindow.set(t.windowId, list);
    }
    slotsLeft = Math.min(
      ...Array.from(byWindow.values()).map(
        (wTabs) => settings.maxTabs - countRelevantTabs(wTabs, settings),
      ),
    );
  } else {
    slotsLeft = settings.maxTabs - countRelevantTabs(allTabs, settings);
  }

  slotsLeft = Math.max(slotsLeft, 0);

  const color = slotsLeft <= 3 ? '#ef4444' : '#22c55e'; // red when tight, green otherwise
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text: String(slotsLeft) });
}

// Refresh when tabs come or go.
chrome.tabs.onCreated.addListener(() => void updateBadge());
chrome.tabs.onRemoved.addListener(() => void updateBadge());

// Refresh when settings change (maxTabs, excludePinned, etc.).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes['settings']) {
    void updateBadge();
  }
});

// Reflect the current state whenever the worker spins up.
void updateBadge();
