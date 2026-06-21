import type { TabTimes } from './tabs';

// Tab creation times live in session storage: they must survive service-worker
// restarts (constant under MV3) but tab ids are only meaningful within a single
// browser session, so they should NOT persist to disk across restarts.
//
// LRU ordering uses Chrome's native Tab.lastAccessed instead, so it needs no
// tracking here and stays accurate even right after a browser restart.

const KEY_CREATION = 'creation';
const KEY_RESURFACED = 'resurfaced';

let cache: TabTimes | null = null;
let loading: Promise<TabTimes> | null = null;

function load(): Promise<TabTimes> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = chrome.storage.session.get([KEY_CREATION, KEY_RESURFACED]).then((data) => {
      cache = {
        creation: (data[KEY_CREATION] as Record<number, number>) ?? {},
        resurfaced: (data[KEY_RESURFACED] as Record<number, number>) ?? {},
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
    [KEY_RESURFACED]: times.resurfaced ?? {},
  });
}

export function getTimes(): Promise<TabTimes> {
  return load();
}

export async function recordCreated(tabId: number, now = Date.now()): Promise<void> {
  const times = await load();
  times.creation[tabId] = now;
  await persist(times);
}

export async function recordResurfaced(tabId: number, now = Date.now()): Promise<void> {
  const times = await load();
  if (!times.resurfaced) {
    times.resurfaced = {};
  }
  times.resurfaced[tabId] = now;
  await persist(times);
}

export async function forget(tabId: number): Promise<void> {
  const times = await load();
  delete times.creation[tabId];
  if (times.resurfaced) {
    delete times.resurfaced[tabId];
  }
  await persist(times);
}

/**
 * Stamp every currently-open tab with the same baseline creation time. Used once
 * at install and on each browser startup (when session storage and tab ids
 * reset); accurate per-tab times then accrue from onCreated going forward.
 */
export async function seed(ids: number[], now = Date.now()): Promise<void> {
  const creation: Record<number, number> = {};
  for (const id of ids) creation[id] = now;
  await persist({ creation, resurfaced: {} });
}
