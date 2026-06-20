import type { StashItem } from './types';

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
  const data = await chrome.storage.local.get(STASH_KEY);
  return (data[STASH_KEY] as StashItem[]) ?? [];
}

async function setStash(items: StashItem[]): Promise<void> {
  await chrome.storage.local.set({ [STASH_KEY]: items });
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
