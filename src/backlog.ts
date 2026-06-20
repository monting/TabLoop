import type { BacklogItem } from './types';

// The backlog (destinations blocked because the limit was reached) persists to
// disk: these are links the user still wants, so they should outlive a restart.

export const BACKLOG_KEY = 'backlog';
const MAX_ITEMS = 50;

/** Pure: insert a url at the front, de-duplicating and capping the list. */
export function withUrlAdded(items: BacklogItem[], url: string, now: number): BacklogItem[] {
  const deduped = items.filter((i) => i.url !== url);
  deduped.unshift({ url, time: now });
  return deduped.slice(0, MAX_ITEMS);
}

export async function getBacklog(): Promise<BacklogItem[]> {
  const data = await chrome.storage.local.get(BACKLOG_KEY);
  return (data[BACKLOG_KEY] as BacklogItem[]) ?? [];
}

async function setBacklog(items: BacklogItem[]): Promise<void> {
  await chrome.storage.local.set({ [BACKLOG_KEY]: items });
}

export async function addToBacklog(url: string, now = Date.now()): Promise<void> {
  await setBacklog(withUrlAdded(await getBacklog(), url, now));
}

export async function removeFromBacklog(url: string): Promise<void> {
  await setBacklog((await getBacklog()).filter((i) => i.url !== url));
}

export async function clearBacklog(): Promise<void> {
  await setBacklog([]);
}
