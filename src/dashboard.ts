import './style.css';
import type { Settings, StashItem } from './types';
import type { TabInfo, TabTimes } from './tabs';
import { countRelevantTabs, isStashableUrl, sortTabsForResurfacing } from './tabs';
import { loadSettings } from './settings';
import { addToStash, clearStash, getStash, removeFromStash, isSyncingActive } from './stash';

const app = document.querySelector<HTMLDivElement>('#app')!;

interface ActiveTab {
  id: number;
  url?: string;
  title?: string;
}

interface DashboardState {
  settings: Settings;
  count: number;
  stash: StashItem[];
  activeTab: ActiveTab | null;
  upcomingTabs: chrome.tabs.Tab[];
  times: TabTimes;
  syncActive: boolean;
}

let currentState: DashboardState | null = null;
let escapeHatchClicked = false;

const FALLBACK_FAVICON =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

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

async function readState(): Promise<DashboardState> {
  const settings = await loadSettings();
  const [rawTabs, [active], sessionData, stash] = await Promise.all([
    chrome.tabs.query(settings.limitScope === 'per-window' ? { currentWindow: true } : {}),
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.session.get(['creation', 'resurfaced', 'lastAccessed']),
    getStash(),
  ]);

  const tabs = rawTabs.map(toTabInfo).filter((t): t is TabInfo => t !== null);
  const times = {
    creation: (sessionData['creation'] as Record<number, number>) ?? {},
    resurfaced: (sessionData['resurfaced'] as Record<number, number>) ?? {},
    lastAccessed: (sessionData['lastAccessed'] as Record<number, number>) ?? {},
  };

  const rawTabById = new Map(rawTabs.filter(rt => rt.id != null).map(rt => [rt.id!, rt]));
  const upcomingTabs = sortTabsForResurfacing(tabs, times, settings)
    .map(info => rawTabById.get(info.id))
    .filter((rt): rt is chrome.tabs.Tab => rt != null);

  return {
    settings,
    count: countRelevantTabs(tabs, settings),
    stash,
    activeTab: active?.id != null ? { id: active.id, url: active.url, title: active.title } : null,
    upcomingTabs,
    times,
    syncActive: await isSyncingActive(settings),
  };
}

function formatUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return u.hostname.replace(/^www\./, '') + path;
  } catch {
    return url;
  }
}

function formatElapsed(timestamp: number): string {
  if (timestamp <= 0) return 'never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getFaviconUrl(pageUrl: string): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '16');
  return url.toString();
}

function renderItem(item: StashItem, atLimit: boolean, escapeHatchActive: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'stash-item';

  const restore = document.createElement('button');
  restore.className = 'restore';
  restore.textContent = 'Restore';
  restore.dataset.url = item.url;
  restore.dataset.act = 'restore';
  if (atLimit && !escapeHatchActive) {
    restore.disabled = true;
    restore.title = 'Stash or close a tab to make room first';
  }

  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  favicon.src = item.favIconUrl || getFaviconUrl(item.url);
  favicon.alt = '';
  favicon.onerror = () => {
    favicon.src = FALLBACK_FAVICON;
  };

  const label = document.createElement('span');
  label.className = 'url';
  label.textContent = item.title?.trim() || formatUrl(item.url);
  label.title = item.url;

  const remove = document.createElement('button');
  remove.className = 'remove';
  remove.textContent = '×';
  remove.dataset.url = item.url;
  remove.dataset.act = 'remove';
  remove.title = 'Remove from stash';

  li.append(restore, favicon, label, remove);
  return li;
}

function renderUpcomingItem(tab: chrome.tabs.Tab, times: TabTimes): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'resurface-item';

  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  favicon.src = tab.favIconUrl || FALLBACK_FAVICON;
  favicon.alt = '';
  favicon.onerror = () => {
    favicon.src = FALLBACK_FAVICON;
  };

  const label = document.createElement('a');
  label.className = 'title';
  label.href = '#';
  label.textContent = tab.title?.trim() || (tab.url ? formatUrl(tab.url) : 'Untitled');
  label.title = 'Click to go to tab';
  label.dataset.act = 'focus-tab';
  label.dataset.id = tab.id?.toString();
  label.dataset.windowId = tab.windowId?.toString();

  const manualTime = tab.id != null ? times.lastAccessed?.[tab.id] : undefined;
  const nativeTime = tab.lastAccessed;
  const resolvedTime = nativeTime ?? manualTime ?? 0;

  const timeBadge = document.createElement('button');
  timeBadge.type = 'button';
  timeBadge.className = 'time-badge';
  timeBadge.title = 'Stash and close tab';
  timeBadge.dataset.act = 'stash-tab';
  if (tab.id != null) {
    timeBadge.dataset.id = tab.id.toString();
  }

  const timeText = document.createElement('span');
  timeText.className = 'time-text';
  timeText.textContent = formatElapsed(resolvedTime);

  const stashText = document.createElement('span');
  stashText.className = 'stash-text';
  stashText.textContent = 'Stash';

  timeBadge.append(timeText, stashText);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'remove';
  closeBtn.textContent = '×';
  if (tab.id != null) {
    closeBtn.dataset.id = tab.id.toString();
  }
  closeBtn.dataset.act = 'close-tab';
  closeBtn.title = 'Close tab';

  li.append(favicon, label, timeBadge, closeBtn);
  return li;
}

function appendEmptyItem(list: HTMLUListElement, text: string): void {
  const empty = document.createElement('li');
  empty.className = 'empty';
  empty.textContent = text;
  list.append(empty);
}

function initSkeleton(): void {
  app.innerHTML = `
    <div class="escape-hatch-container"></div>
    <div class="header">
      <h1>TabLoop Dashboard</h1>
      <div style="display: flex; gap: 12px; align-items: center;">
        <button class="link settings" data-act="settings" title="Settings" aria-label="Settings" style="padding-left: 0; display: flex; align-items: center; justify-content: center;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.3s ease-out;">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="main-column">
        <div class="card resurface-queue">
          <div class="resurface-head">
            <span class="resurface-title">Stale Queue</span>
          </div>
          <ul class="resurface-list"></ul>
        </div>
      </div>

      <div class="sidebar-column">
        <div class="card meter">
          <div class="count"></div>
          <div class="bar"><div class="bar-fill"></div></div>
          <p class="hint"></p>
        </div>

        <div class="card stash">
          <div class="stash-head">
            <span class="stash-title">Stash</span>
            <div class="stash-clear-container"></div>
          </div>
          <ul class="stash-list"></ul>
        </div>

        <div class="card escape-hatch-card">
          <span class="section-title">Escape Hatch</span>
          <div class="escape-container"></div>
        </div>
      </div>
    </div>
  `;
}

function render(state: DashboardState): void {
  const { settings, count, stash, upcomingTabs, times } = state;
  const max = settings.maxTabs;
  const atLimit = count >= max;
  const ratio = max > 0 ? count / max : 0;
  const level = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'high' : 'ok';
  const remaining = Math.max(0, max - count);

  if (!app.querySelector('.header')) {
    initSkeleton();
  }

  const params = new URLSearchParams(window.location.search);
  const escapeType = params.get('escape');
  const bannerContainer = app.querySelector<HTMLDivElement>('.escape-hatch-container')!;
  
  if (escapeType === 'tab' || escapeType === 'window') {
    bannerContainer.innerHTML = `
      <div class="escape-hatch-banner">
        <h2>Escape Hatch New ${escapeType === 'tab' ? 'Tab' : 'Window'}</h2>
        <p>This page bypasses your tab limit. You can navigate freely to any URL.</p>
      </div>
    `;
    bannerContainer.style.display = 'block';
  } else {
    bannerContainer.innerHTML = '';
    bannerContainer.style.display = 'none';
  }

  const meterCard = app.querySelector<HTMLDivElement>('.meter')!;
  meterCard.className = `card meter ${level}`;

  const countEl = meterCard.querySelector<HTMLDivElement>('.count')!;
  countEl.innerHTML = `<span class="cur">${count}</span><span class="slash">/</span><span class="max">${max}</span>`;

  const barFill = meterCard.querySelector<HTMLDivElement>('.bar-fill')!;
  barFill.style.width = `${Math.min(100, ratio * 100)}%`;

  const hintEl = meterCard.querySelector<HTMLParagraphElement>('.hint')!;
  hintEl.innerHTML = atLimit
    ? (settings.enableStash ? 'At limit &mdash; stash a tab to free a slot' : 'At limit &mdash; close a tab to free a slot')
    : `${remaining} slot${remaining === 1 ? '' : 's'} remaining`;

  const stashCard = app.querySelector<HTMLDivElement>('.card.stash')!;
  if (settings.enableStash) {
    stashCard.style.display = '';
  } else {
    stashCard.style.display = 'none';
  }

  const stashTitle = app.querySelector<HTMLSpanElement>('.stash-title')!;
  const titleText = state.syncActive ? '🟢 Stash' : '🔴 Local Stash';
  stashTitle.innerHTML = `${titleText}${stash.length ? ` <span class="pill">${stash.length}</span>` : ''}`;
  if (state.syncActive) {
    stashTitle.title = 'Cloud sync enabled';
  } else {
    stashTitle.title = 'Cloud sync disabled';
  }

  const stashClearContainer = app.querySelector<HTMLDivElement>('.stash-clear-container')!;
  stashClearContainer.innerHTML = stash.length ? '<button class="link" data-act="clear">Clear all</button>' : '';

  const resurfaceTitle = app.querySelector<HTMLSpanElement>('.resurface-title')!;
  resurfaceTitle.textContent = `Stale Queue (${upcomingTabs.length})`;

  const resurfaceList = app.querySelector<HTMLUListElement>('.resurface-list')!;
  resurfaceList.innerHTML = '';
  if (upcomingTabs.length === 0) {
    appendEmptyItem(resurfaceList, 'No stale tabs in queue.');
  } else {
    upcomingTabs.forEach((tab) => {
      resurfaceList.append(renderUpcomingItem(tab, times));
    });
  }

  const isEscapeMode = escapeType === 'tab' || escapeType === 'window';
  const escapeHatchActive = escapeHatchClicked || isEscapeMode;

  const list = app.querySelector<HTMLUListElement>('.stash-list')!;
  list.innerHTML = '';
  if (stash.length === 0) {
    appendEmptyItem(list, 'Nothing stashed yet.');
  } else {
    for (const item of stash) {
      list.append(renderItem(item, atLimit, escapeHatchActive));
    }
  }

  const escapeContainer = app.querySelector<HTMLDivElement>('.escape-container')!;
  if (escapeHatchClicked) {
    escapeContainer.innerHTML = `
      <div style="display: flex; gap: 6px;">
        <button class="escape-btn" data-act="escape-tab" title="Open a new tab outside the limit"${atLimit ? '' : ' disabled'}>+ Tab</button>
        <button class="escape-btn" data-act="escape-window" title="Open a new window outside the limit"${atLimit ? '' : ' disabled'}>+ Window</button>
      </div>
    `;
  } else {
    escapeContainer.innerHTML = `
      <button class="link" data-act="click-escape-hatch" title="Click to show escape actions" style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); cursor: pointer; padding: 0;">Escape Hatch</button>
    `;
  }
}

function showToast(message: string): void {
  const toast = document.querySelector<HTMLDivElement>('#toast');
  if (!toast) return;

  toast.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
    <span>${message}</span>
  `;

  toast.classList.add('visible');

  setTimeout(() => {
    toast.classList.remove('visible');
  }, 4000);
}

async function refresh(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('alert') === 'limit') {
    showToast('Tab limit reached!');
    // Clean up the URL in the address bar without reloading
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  try {
    currentState = await readState();
    render(currentState);
    document.body.classList.add('ready');
  } catch (err) {
    console.error("Dashboard error:", err);
    document.body.classList.add('ready');
    app.innerHTML = `
      <div class="card error" style="border: 1px solid var(--over); padding: 20px; background: rgba(239, 68, 68, 0.1); margin: 20px;">
        <h2 style="color: var(--over); margin-top: 0;">Dashboard Loading Error</h2>
        <pre style="color: var(--text-primary); white-space: pre-wrap; font-family: monospace;">${err instanceof Error ? err.stack || err.message : String(err)}</pre>
      </div>
    `;
  }
}

app.addEventListener('click', async (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!target) return;
  const { act, url } = target.dataset;

  switch (act) {
    case 'settings':
      chrome.runtime.openOptionsPage();
      break;

    case 'clear':
      await clearStash();
      await refresh();
      break;

    case 'remove':
      if (url) {
        await removeFromStash(url);
        await refresh();
      }
      break;

    case 'focus-tab': {
      e.preventDefault();
      const tabIdStr = target.dataset.id;
      const windowIdStr = target.dataset.windowId;
      if (tabIdStr) {
        const tabId = parseInt(tabIdStr, 10);
        await chrome.tabs.update(tabId, { active: true });
        if (windowIdStr) {
          const windowId = parseInt(windowIdStr, 10);
          await chrome.windows.update(windowId, { focused: true });
        }
      }
      break;
    }

    case 'close-tab': {
      const tabIdStr = target.dataset.id;
      if (tabIdStr) {
        const tabId = parseInt(tabIdStr, 10);
        await chrome.tabs.remove(tabId);
        await refresh();
      }
      break;
    }

    case 'stash-tab': {
      const tabIdStr = target.dataset.id;
      if (tabIdStr) {
        const tabId = parseInt(tabIdStr, 10);
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab && tab.url && isStashableUrl(tab.url)) {
            await addToStash(tab.url, tab.title, tab.favIconUrl);
            await chrome.tabs.remove(tabId);
            await refresh();
          }
        } catch (err) {
          console.error('Failed to stash tab', err);
        }
      }
      break;
    }

    case 'escape-tab':
      if ((target as HTMLButtonElement).disabled) break;
      chrome.runtime.sendMessage('escape-hatch-tab');
      break;

    case 'escape-window':
      if ((target as HTMLButtonElement).disabled) break;
      chrome.runtime.sendMessage('escape-hatch-window');
      break;

    case 'click-escape-hatch':
      escapeHatchClicked = true;
      await refresh();
      break;

    case 'restore':
      if (url && !(target as HTMLButtonElement).disabled) {
        await removeFromStash(url);
        const params = new URLSearchParams(window.location.search);
        const escapeType = params.get('escape');
        const isEscapeMode = escapeType === 'tab' || escapeType === 'window';

        if (isEscapeMode) {
          await chrome.tabs.update(undefined, { url });
        } else if (escapeHatchClicked) {
          await chrome.runtime.sendMessage({ type: 'escape-hatch-tab', url });
        } else {
          await chrome.tabs.create({ url });
        }
        await refresh();
      }
      break;
  }
});

// Watch for tab additions/removals/updates to keep the dashboard live
chrome.tabs.onCreated.addListener(() => void refresh());
chrome.tabs.onRemoved.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.title !== undefined) {
    void refresh();
  }
});

refresh();
