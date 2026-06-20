import type { TabTimes } from './tabs';

// Tab timing lives in session storage: it must survive service-worker restarts
// (which happen constantly under MV3) but tab ids are only meaningful within a
// single browser session, so it should NOT persist to disk across restarts.

const KEY_CREATION = 'creation';
const KEY_LAST_ACTIVE = 'lastActive';

let cache: TabTimes | null = null;
let loading: Promise<TabTimes> | null = null;

function load(): Promise<TabTimes> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = chrome.storage.session.get([KEY_CREATION, KEY_LAST_ACTIVE]).then((data) => {
      cache = {
        creation: (data[KEY_CREATION] as Record<number, number>) ?? {},
        lastActive: (data[KEY_LAST_ACTIVE] as Record<number, number>) ?? {},
      };
      return cache;
    });
  }
  return loading;
}

async function persist(times: TabTimes): Promise<void> {
  cache = times;
  await chrome.storage.session.set({
    [KEY_CREATION]: times.creation,
    [KEY_LAST_ACTIVE]: times.lastActive,
  });
}

export function getTimes(): Promise<TabTimes> {
  return load();
}

export async function recordCreated(tabId: number, active: boolean, now = Date.now()): Promise<void> {
  const times = await load();
  times.creation[tabId] = now;
  times.lastActive[tabId] = active ? now : 0;
  await persist(times);
}

export async function recordActivated(tabId: number, now = Date.now()): Promise<void> {
  const times = await load();
  times.lastActive[tabId] = now;
  await persist(times);
}

export async function forget(tabId: number): Promise<void> {
  const times = await load();
  delete times.creation[tabId];
  delete times.lastActive[tabId];
  await persist(times);
}

/**
 * Stamp every currently-open tab with the same baseline time. Used once at
 * install and on each browser startup (when session storage and tab ids reset);
 * accurate per-tab times then accrue from onCreated/onActivated going forward.
 */
export async function seed(tabs: { id: number; active: boolean }[], now = Date.now()): Promise<void> {
  const creation: Record<number, number> = {};
  const lastActive: Record<number, number> = {};
  for (const t of tabs) {
    creation[t.id] = now;
    lastActive[t.id] = t.active ? now : 0;
  }
  await persist({ creation, lastActive });
}
