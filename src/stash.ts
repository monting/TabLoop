import type { Settings, StashItem } from './types.ts';
import { loadSettings } from './settings.ts';

// The stash (tabs parked to free a slot, plus destinations blocked at the limit)
// persists to disk: these are pages the user still wants, so they should outlive
// a restart.

export const STASH_KEY = 'stash';
const STASH_LOCK = 'tabloop:stash';
const MAX_ITEMS = 50;
// chrome.storage.sync caps a single item at QUOTA_BYTES_PER_ITEM (8,192 bytes);
// stay safely under it after accounting for the key and JSON overhead.
const SYNC_ITEM_BUDGET = 8000;

function storageFor(settings: Settings): chrome.storage.StorageArea {
  return settings.syncStash ? chrome.storage.sync : chrome.storage.local;
}

/**
 * Serialize stash read-modify-write across contexts (the popup and the service
 * worker share the chrome-extension origin) so concurrent edits don't clobber each
 * other. Falls back to a direct call where the Web Locks API is unavailable, e.g.
 * the Node-based unit tests.
 */
function withStashLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(STASH_LOCK, fn);
  }
  return fn();
}

/** Pure: insert an item at the front, de-duplicating by url and capping the list. */
export function withUrlAdded(
  items: StashItem[],
  url: string,
  now: number,
  title?: string,
): StashItem[] {
  const deduped = items.filter((i) => i.url !== url);
  deduped.unshift({ url, title, time: now });
  return deduped.slice(0, MAX_ITEMS);
}

async function readStash(storage: chrome.storage.StorageArea): Promise<StashItem[]> {
  const data = await storage.get(STASH_KEY);
  return (data[STASH_KEY] as StashItem[]) ?? [];
}

async function writeStash(
  storage: chrome.storage.StorageArea,
  settings: Settings,
  items: StashItem[],
): Promise<void> {
  if (settings.syncStash) {
    // Prune oldest items until the serialized list fits the per-item quota. Work on
    // a copy so we never mutate the caller's array.
    items = [...items];
    while (items.length > 0 && JSON.stringify(items).length > SYNC_ITEM_BUDGET) {
      items.pop(); // Remove the oldest item (at the end of the list).
    }
  }
  await storage.set({ [STASH_KEY]: items });
}

export async function getStash(): Promise<StashItem[]> {
  return readStash(storageFor(await loadSettings()));
}

export async function setStash(items: StashItem[]): Promise<void> {
  const settings = await loadSettings();
  await writeStash(storageFor(settings), settings, items);
}

/** Atomic read-modify-write of the stash, resolving the storage area only once. */
function mutateStash(transform: (items: StashItem[]) => StashItem[]): Promise<void> {
  return withStashLock(async () => {
    const settings = await loadSettings();
    const storage = storageFor(settings);
    await writeStash(storage, settings, transform(await readStash(storage)));
  });
}

export function addToStash(url: string, title?: string, now = Date.now()): Promise<void> {
  return mutateStash((items) => withUrlAdded(items, url, now, title));
}

export function removeFromStash(url: string): Promise<void> {
  return mutateStash((items) => items.filter((i) => i.url !== url));
}

export async function clearStash(): Promise<void> {
  await setStash([]);
}
