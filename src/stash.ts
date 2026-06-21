import type { StashItem } from './types.ts';
import { loadSettings } from './settings.ts';

// The stash (tabs parked to free a slot, plus destinations blocked at the limit)
// persists to disk: these are pages the user still wants, so they should outlive
// a restart.

export const STASH_KEY = 'stash';
const MAX_ITEMS = 50;

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

export async function getStash(): Promise<StashItem[]> {
  const settings = await loadSettings();
  const storage = settings.syncStash ? chrome.storage.sync : chrome.storage.local;
  const data = await storage.get(STASH_KEY);
  return (data[STASH_KEY] as StashItem[]) ?? [];
}

export async function setStash(items: StashItem[]): Promise<void> {
  const settings = await loadSettings();
  const storage = settings.syncStash ? chrome.storage.sync : chrome.storage.local;

  if (settings.syncStash) {
    // chrome.storage.sync has a QUOTA_BYTES_PER_ITEM limit of 8,192 bytes.
    // If the JSON length is close to 8KB, prune the oldest items until it fits.
    let serialized = JSON.stringify(items);
    while (serialized.length > 8000 && items.length > 0) {
      items.pop(); // Remove the oldest item (at the end of the list)
      serialized = JSON.stringify(items);
    }
  }

  await storage.set({ [STASH_KEY]: items });
}

export async function addToStash(url: string, title?: string, now = Date.now()): Promise<void> {
  await setStash(withUrlAdded(await getStash(), url, now, title));
}

export async function removeFromStash(url: string): Promise<void> {
  await setStash((await getStash()).filter((i) => i.url !== url));
}

export async function clearStash(): Promise<void> {
  await setStash([]);
}
