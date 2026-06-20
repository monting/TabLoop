import './style.css';
import type { BacklogItem, Settings } from './types';
import type { TabInfo } from './tabs';
import { countRelevantTabs } from './tabs';
import { loadSettings } from './settings';
import { clearBacklog, getBacklog, removeFromBacklog } from './backlog';

const app = document.querySelector<HTMLDivElement>('#app')!;

interface PopupState {
  settings: Settings;
  count: number;
  backlog: BacklogItem[];
}

function toTabInfo(tab: chrome.tabs.Tab): TabInfo | null {
  if (tab.id == null) return null;
  return { id: tab.id, pinned: tab.pinned, incognito: tab.incognito, url: tab.url, windowId: tab.windowId };
}

async function readState(): Promise<PopupState> {
  const settings = await loadSettings();
  const rawTabs = await chrome.tabs.query(
    settings.limitScope === 'per-window' ? { currentWindow: true } : {},
  );
  const tabs = rawTabs.map(toTabInfo).filter((t): t is TabInfo => t !== null);
  return {
    settings,
    count: countRelevantTabs(tabs, settings),
    backlog: await getBacklog(),
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
  const { settings, count, backlog } = state;
  const max = settings.maxTabs;
  const atLimit = count >= max;
  const ratio = max > 0 ? count / max : 0;
  const level = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'high' : 'ok';
  const remaining = Math.max(0, max - count);

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
          ? 'At limit &mdash; new tabs go to the backlog'
          : `${remaining} slot${remaining === 1 ? '' : 's'} remaining`
      }</p>
    </div>

    <div class="card backlog">
      <div class="backlog-head">
        <span class="backlog-title">Backlog${backlog.length ? ` <span class="pill">${backlog.length}</span>` : ''}</span>
        ${backlog.length ? '<button class="link" data-act="clear">Clear all</button>' : ''}
      </div>
      <ul class="backlog-list"></ul>
    </div>

    <button class="link settings" data-act="settings">Settings</button>
  `;

  const list = app.querySelector<HTMLUListElement>('.backlog-list')!;
  if (backlog.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = "No blocked tabs. You're all caught up.";
    list.append(empty);
  } else {
    for (const item of backlog) {
      list.append(renderItem(item, atLimit));
    }
  }
}

function renderItem(item: BacklogItem, atLimit: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'backlog-item';

  const open = document.createElement('button');
  open.className = 'reopen';
  open.textContent = 'Open';
  open.dataset.url = item.url;
  open.dataset.act = 'reopen';
  if (atLimit) {
    open.disabled = true;
    open.title = 'Close a tab to make room first';
  }

  const label = document.createElement('span');
  label.className = 'url';
  label.textContent = formatUrl(item.url);
  label.title = item.url;

  const remove = document.createElement('button');
  remove.className = 'remove';
  remove.textContent = '×';
  remove.dataset.url = item.url;
  remove.dataset.act = 'remove';
  remove.title = 'Remove from backlog';

  li.append(open, label, remove);
  return li;
}

async function refresh(): Promise<void> {
  render(await readState());
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
    case 'clear':
      await clearBacklog();
      await refresh();
      break;
    case 'remove':
      if (url) await removeFromBacklog(url);
      await refresh();
      break;
    case 'reopen':
      if (url && !(target as HTMLButtonElement).disabled) {
        await chrome.tabs.create({ url });
        await removeFromBacklog(url);
        window.close();
      }
      break;
  }
});

void refresh();
