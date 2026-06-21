import './style.css';
import type { Settings, StashItem } from './types';
import type { TabInfo } from './tabs';
import { countRelevantTabs, isStashableUrl } from './tabs';
import { loadSettings } from './settings';
import { addToStash, clearStash, getStash, removeFromStash } from './stash';

const app = document.querySelector<HTMLDivElement>('#app')!;

interface ActiveTab {
  id: number;
  url?: string;
  title?: string;
}

interface PopupState {
  settings: Settings;
  count: number;
  stash: StashItem[];
  activeTab: ActiveTab | null;
}

let currentState: PopupState | null = null;

function toTabInfo(tab: chrome.tabs.Tab): TabInfo | null {
  if (tab.id == null) return null;
  return { id: tab.id, pinned: tab.pinned, url: tab.url, windowId: tab.windowId };
}

async function readState(): Promise<PopupState> {
  const settings = await loadSettings();
  const rawTabs = await chrome.tabs.query(
    settings.limitScope === 'per-window' ? { currentWindow: true } : {},
  );
  const tabs = rawTabs.map(toTabInfo).filter((t): t is TabInfo => t !== null);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return {
    settings,
    count: countRelevantTabs(tabs, settings),
    stash: await getStash(),
    activeTab: active?.id != null ? { id: active.id, url: active.url, title: active.title } : null,
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

function render(state: PopupState): void {
  const { settings, count, stash, activeTab } = state;
  const max = settings.maxTabs;
  const atLimit = count >= max;
  const ratio = max > 0 ? count / max : 0;
  const level = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'high' : 'ok';
  const remaining = Math.max(0, max - count);
  const canStash = !!activeTab && isStashableUrl(activeTab.url);

  app.innerHTML = `
    <div class="header">
      <h1>TabLoop</h1>
      <span class="scope">${settings.limitScope === 'per-window' ? 'This window' : 'All windows'}</span>
    </div>

    <div class="card meter ${level}">
      <div class="count"><span class="cur">${count}</span><span class="slash">/</span><span class="max">${max}</span></div>
      <div class="bar"><div class="bar-fill" style="width:${Math.min(100, ratio * 100)}%"></div></div>
      <p class="hint">${
        atLimit
          ? 'At limit &mdash; stash a tab to free a slot'
          : `${remaining} slot${remaining === 1 ? '' : 's'} remaining`
      }</p>
    </div>

    <button class="stash-btn" data-act="stash-current"${canStash ? '' : ' disabled'} title="${
      canStash ? 'Close this tab and save it to your Stash' : "This page can't be stashed"
    }">Stash this tab</button>

    <div class="card stash">
      <div class="stash-head">
        <span class="stash-title">Stash${stash.length ? ` <span class="pill">${stash.length}</span>` : ''}</span>
        ${stash.length ? '<button class="link" data-act="clear">Clear all</button>' : ''}
      </div>
      <ul class="stash-list"></ul>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px;">
      <button class="link settings" data-act="settings" title="Settings" aria-label="Settings" style="padding-left: 0;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.3s ease-out;">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);">Escape Hatch</span>
        <div style="display: flex; gap: 6px;">
          <button class="escape-btn" data-act="escape-tab" title="Open a new tab outside the limit"${atLimit ? '' : ' disabled'}>+ Tab</button>
          <button class="escape-btn" data-act="escape-window" title="Open a new window outside the limit"${atLimit ? '' : ' disabled'}>+ Window</button>
        </div>
      </div>
    </div>
  `;

  const list = app.querySelector<HTMLUListElement>('.stash-list')!;
  if (stash.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Nothing stashed yet.';
    list.append(empty);
  } else {
    for (const item of stash) {
      list.append(renderItem(item, atLimit));
    }
  }
}

function getFaviconUrl(pageUrl: string): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '16');
  return url.toString();
}

function renderItem(item: StashItem, atLimit: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'stash-item';

  const restore = document.createElement('button');
  restore.className = 'restore';
  restore.textContent = 'Restore';
  restore.dataset.url = item.url;
  restore.dataset.act = 'restore';
  if (atLimit) {
    restore.disabled = true;
    restore.title = 'Stash or close a tab to make room first';
  }

  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  favicon.src = getFaviconUrl(item.url);
  favicon.alt = '';

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

async function refresh(): Promise<void> {
  currentState = await readState();
  render(currentState);
}

app.addEventListener('click', async (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!target) return;
  const { act, url } = target.dataset;

  switch (act) {
    case 'settings':
      chrome.runtime.openOptionsPage();
      window.close();
      break;
    case 'escape-tab':
      if ((target as HTMLButtonElement).disabled) break;
      chrome.runtime.sendMessage('escape-hatch-tab');
      window.close();
      break;
    case 'escape-window':
      if ((target as HTMLButtonElement).disabled) break;
      chrome.runtime.sendMessage('escape-hatch-window');
      window.close();
      break;
    case 'stash-current': {
      const active = currentState?.activeTab;
      if (active && isStashableUrl(active.url)) {
        await addToStash(active.url, active.title);
        await chrome.tabs.remove(active.id);
        await refresh();
      }
      break;
    }
    case 'clear':
      await clearStash();
      await refresh();
      break;
    case 'remove':
      if (url) await removeFromStash(url);
      await refresh();
      break;
    case 'restore':
      if (url && !(target as HTMLButtonElement).disabled) {
        await removeFromStash(url);
        await chrome.tabs.create({ url });
        window.close();
      }
      break;
  }
});

void refresh();
