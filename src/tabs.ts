import type { Settings } from './types';

/** The minimal subset of chrome.tabs.Tab this logic needs (kept chrome-free so it is unit-testable). */
export interface TabInfo {
  id: number;
  pinned: boolean;
  url?: string;
  windowId: number;
}

/** Per-tab timestamps tracked across the service-worker lifetime. */
export interface TabTimes {
  creation: Record<number, number>;
  lastActive: Record<number, number>;
}

/** The extension's own options page must never be recycled. */
const OPTIONS_PAGE = 'options.html';

/** Tabs that count toward the limit (pinned tabs are excluded when configured). */
export function relevantTabs(tabs: TabInfo[], settings: Settings): TabInfo[] {
  return settings.excludePinned ? tabs.filter((t) => !t.pinned) : tabs;
}

export function countRelevantTabs(tabs: TabInfo[], settings: Settings): number {
  return relevantTabs(tabs, settings).length;
}

export function isOverLimit(tabs: TabInfo[], settings: Settings): boolean {
  return countRelevantTabs(tabs, settings) > settings.maxTabs;
}

/**
 * Pick the tab to recycle when the limit is exceeded, or null if nothing may be
 * touched (everything is pinned/protected, so the new tab should be allowed).
 */
export function selectOldestTab(
  tabs: TabInfo[],
  newTabId: number,
  times: TabTimes,
  settings: Settings,
): TabInfo | null {
  let candidates = tabs.filter((t) => t.id !== newTabId);
  if (settings.excludePinned) {
    candidates = candidates.filter((t) => !t.pinned);
  }
  candidates = candidates.filter((t) => !t.url?.includes(OPTIONS_PAGE));
  if (candidates.length === 0) return null;

  const keyOf = (t: TabInfo): number =>
    settings.oldestDefinition === 'lru'
      ? times.lastActive[t.id] ?? 0
      : times.creation[t.id] ?? 0;

  // Smallest timestamp wins; ties keep the earlier tab (stable, leftmost-by-index).
  return candidates.reduce((oldest, t) => (keyOf(t) < keyOf(oldest) ? t : oldest));
}

/** Only real web destinations are worth stashing when a tab is blocked. */
export function isStashableUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}
