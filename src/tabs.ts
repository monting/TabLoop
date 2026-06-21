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
  resurfaced?: Record<number, number>;
}

/**
 * The extension's own settings page. Anchored to the chrome-extension:// origin so
 * arbitrary web pages whose path merely contains "options.html" are NOT exempted.
 */
const OPTIONS_PAGE = /^chrome-extension:\/\/[^/]+\/.*options\.html/i;

/** Chrome's new-tab page stays enforced — it's the vehicle for opening new web tabs. */
const NEW_TAB_PAGE = /^chrome:\/\/(newtab|new-tab-page)/i;

/**
 * URLs exempt from the tab limit entirely: the extension's own settings page and
 * Chrome's internal pages (chrome://…), excluding the new-tab page. Exempt tabs
 * never count toward the limit and are never recycled.
 */
export function isExemptUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (OPTIONS_PAGE.test(url)) return true;
  return /^chrome:\/\//i.test(url) && !NEW_TAB_PAGE.test(url);
}

/** Tabs that count toward the limit (exempt URLs, and pinned tabs when configured, are excluded). */
export function relevantTabs(tabs: TabInfo[], settings: Settings): TabInfo[] {
  return tabs.filter(
    (t) =>
      !isExemptUrl(t.url) &&
      !(settings.excludePinned && t.pinned),
  );
}

export function countRelevantTabs(tabs: TabInfo[], settings: Settings): number {
  return relevantTabs(tabs, settings).length;
}

export function isOverLimit(tabs: TabInfo[], settings: Settings): boolean {
  return countRelevantTabs(tabs, settings) > settings.maxTabs;
}

export function matchesDomain(urlStr: string | undefined, domainList: string[] | undefined): boolean {
  if (!urlStr || !domainList || domainList.length === 0) return false;
  try {
    let parsedUrl: URL;
    if (/^[a-z]+:\/\//i.test(urlStr)) {
      parsedUrl = new URL(urlStr);
    } else {
      parsedUrl = new URL('http://' + urlStr);
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    return domainList.some((domain) => {
      const d = domain.trim().toLowerCase();
      if (!d) return false;
      return hostname === d || hostname.endsWith('.' + d);
    });
  } catch {
    return false;
  }
}

export function matchesDomainOrKeyword(urlStr: string | undefined, list: string[] | undefined): boolean {
  if (!urlStr || !list || list.length === 0) return false;
  try {
    let parsedUrl: URL;
    if (/^[a-z]+:\/\//i.test(urlStr)) {
      parsedUrl = new URL(urlStr);
    } else {
      parsedUrl = new URL('http://' + urlStr);
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    return list.some((item) => {
      const trimmed = item.trim().toLowerCase();
      if (!trimmed) return false;
      if (trimmed.includes('.') && !trimmed.includes(' ')) {
        if (hostname === trimmed || hostname.endsWith('.' + trimmed)) return true;
      }
      return urlStr.toLowerCase().includes(trimmed);
    });
  } catch {
    const lowerUrl = urlStr.toLowerCase();
    return list.some((item) => {
      const trimmed = item.trim().toLowerCase();
      return trimmed && lowerUrl.includes(trimmed);
    });
  }
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
  let candidates = relevantTabs(tabs, settings).filter((t) => t.id !== newTabId);

  // 1. Skip domains when resurfacing
  if (settings.skipResurfaceDomains && settings.skipResurfaceDomains.length > 0) {
    candidates = candidates.filter((t) => !matchesDomain(t.url, settings.skipResurfaceDomains));
  }

  if (settings.resurfaceCooldown > 0 && times.resurfaced) {
    const cooldownMs = settings.resurfaceCooldown * 60 * 1000;
    const now = Date.now();
    candidates = candidates.filter((t) => {
      const lastResurfaced = times.resurfaced?.[t.id];
      if (lastResurfaced !== undefined) {
        return (now - lastResurfaced) >= cooldownMs;
      }
      return true;
    });
  }

  if (candidates.length === 0) return null;

  const keyOf = (t: TabInfo): number =>
    settings.oldestDefinition === 'lru' ? t.lastAccessed ?? 0 : times.creation[t.id] ?? 0;

  // 2. Prioritize priority domains/keywords when resurfacing
  if (settings.priorityResurfaceDomains && settings.priorityResurfaceDomains.length > 0) {
    const prioritized = candidates.filter((t) => matchesDomainOrKeyword(t.url, settings.priorityResurfaceDomains));
    if (prioritized.length > 0) {
      return prioritized.reduce((oldest, t) => (keyOf(t) < keyOf(oldest) ? t : oldest));
    }
  }

  // Smallest timestamp wins; ties keep the earlier tab (stable, leftmost-by-index).
  return candidates.reduce((oldest, t) => (keyOf(t) < keyOf(oldest) ? t : oldest));
}

/** Only real web destinations are worth stashing when a tab is blocked. */
export function isStashableUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}
