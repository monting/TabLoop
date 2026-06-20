import type { Settings } from './types';

/** The minimal subset of chrome.tabs.Tab this logic needs (kept chrome-free so it is unit-testable). */
export interface TabInfo {
  id: number;
  pinned: boolean;
  url?: string;
  windowId: number;
  /** Chrome's native "last became active" time (ms since epoch); drives LRU selection. */
  lastAccessed?: number;
}

/** Per-tab creation timestamps tracked across the service-worker lifetime. */
export interface TabTimes {
  creation: Record<number, number>;
}

/** The extension's own settings page, matched within its chrome-extension:// URL. */
const OPTIONS_PAGE = 'options.html';

/** Chrome's new-tab page stays enforced — it's the vehicle for opening new web tabs. */
const NEW_TAB_PAGE = /^chrome:\/\/(newtab|new-tab-page)\b/i;

/**
 * URLs exempt from the tab limit entirely: the extension's own settings page and
 * Chrome's internal pages (chrome://…), excluding the new-tab page. Exempt tabs
 * never count toward the limit and are never recycled.
 */
export function isExemptUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.includes(OPTIONS_PAGE)) return true;
  return /^chrome:\/\//i.test(url) && !NEW_TAB_PAGE.test(url);
}

/** Tabs that count toward the limit (exempt tabs, and pinned tabs when configured, are excluded). */
export function relevantTabs(tabs: TabInfo[], settings: Settings): TabInfo[] {
  return tabs.filter((t) => !isExemptUrl(t.url) && !(settings.excludePinned && t.pinned));
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
 *
 * - 'lru'      => the tab you viewed longest ago (Chrome's lastAccessed).
 * - 'creation' => the tab opened longest ago (our own tracked time).
 */
export function selectOldestTab(
  tabs: TabInfo[],
  newTabId: number,
  times: TabTimes,
  settings: Settings,
): TabInfo | null {
  // Recyclable tabs are exactly those that count toward the limit, minus the new one.
  const candidates = relevantTabs(tabs, settings).filter((t) => t.id !== newTabId);
  if (candidates.length === 0) return null;

  const keyOf = (t: TabInfo): number =>
    settings.oldestDefinition === 'lru' ? t.lastAccessed ?? 0 : times.creation[t.id] ?? 0;

  // Smallest timestamp wins; ties keep the earlier tab (stable, leftmost-by-index).
  return candidates.reduce((oldest, t) => (keyOf(t) < keyOf(oldest) ? t : oldest));
}

/** Only real web destinations are worth stashing when a tab is blocked. */
export function isStashableUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}
