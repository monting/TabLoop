import type { BacklogItem, Settings } from './types';
import type { TabInfo } from './tabs';
import { isOverLimit, isStashableUrl, selectOldestTab } from './tabs';
import { loadSettings } from './settings';
import * as state from './state';
import { addToBacklog, BACKLOG_KEY, getBacklog } from './backlog';

function toTabInfo(tab: chrome.tabs.Tab): TabInfo | null {
  if (tab.id == null) return null;
  return {
    id: tab.id,
    pinned: tab.pinned,
    url: tab.url || tab.pendingUrl || undefined,
    windowId: tab.windowId,
  };
}

function queryScopedTabs(settings: Settings, windowId: number): Promise<chrome.tabs.Tab[]> {
  return chrome.tabs.query(settings.limitScope === 'per-window' ? { windowId } : {});
}

// ---------------------------------------------------------------------------
// Tab-timing lifecycle
//
// Listeners are registered synchronously at the top level so the worker can be
// woken to handle them. Seeding runs on install and on every browser startup,
// because session storage (and tab ids) reset when the browser restarts.
// ---------------------------------------------------------------------------

async function seedExistingTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await state.seed(
    tabs.filter((t): t is chrome.tabs.Tab & { id: number } => t.id != null).map((t) => ({
      id: t.id,
      active: t.active,
    })),
  );
}

chrome.runtime.onInstalled.addListener(() => {
  void seedExistingTabs();
});
chrome.runtime.onStartup.addListener(() => {
  void seedExistingTabs();
});

chrome.tabs.onActivated.addListener((info) => {
  void state.recordActivated(info.tabId);
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
  await state.recordCreated(tab.id, tab.active ?? false);

  const settings = await loadSettings();
  const tabs = (await queryScopedTabs(settings, tab.windowId))
    .map(toTabInfo)
    .filter((t): t is TabInfo => t !== null);

  if (!isOverLimit(tabs, settings)) return;

  const times = await state.getTimes();
  const oldest = selectOldestTab(tabs, tab.id, times, settings);
  // Nothing is recyclable (all pinned/protected) — let the new tab through.
  if (!oldest) return;

  // Save the blocked destination so it isn't lost, then close the new tab and
  // surface the oldest one to be dealt with.
  const blockedUrl = tab.pendingUrl || tab.url;
  if (isStashableUrl(blockedUrl)) {
    await addToBacklog(blockedUrl);
  }

  await chrome.tabs.remove(tab.id);
  if (oldest.windowId !== tab.windowId) {
    await chrome.tabs.move(oldest.id, { windowId: tab.windowId, index: -1 });
  }
  await chrome.tabs.update(oldest.id, { active: true });
}

// ---------------------------------------------------------------------------
// Action badge: surfaces how many blocked destinations are waiting.
// ---------------------------------------------------------------------------

async function updateBadge(count: number): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[BACKLOG_KEY]) {
    const items = (changes[BACKLOG_KEY].newValue as BacklogItem[] | undefined) ?? [];
    void updateBadge(items.length);
  }
});

// Reflect current backlog whenever the worker spins up.
void getBacklog().then((items) => updateBadge(items.length));
