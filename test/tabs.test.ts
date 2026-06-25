import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countRelevantTabs,
  isExemptUrl,
  isOverLimit,
  isStashableUrl,
  selectOldestTab,
  sortTabsForResurfacing,
  type TabInfo,
  type TabTimes,
} from '../src/tabs.ts';
import { withUrlAdded } from '../src/stash.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import type { Settings } from '../src/types.ts';

const baseSettings: Settings = {
  maxTabs: 3,
  limitScope: 'global',
  limitBehavior: 'focus',
  oldestDefinition: 'creation',
  excludePinned: true,
  enableStash: true,
  syncStash: false,
  skipResurfaceDomains: [],
  priorityResurfaceDomains: [],
  resurfaceCooldown: 0,
};

function tab(id: number, extra: Partial<TabInfo> = {}): TabInfo {
  return { id, pinned: false, windowId: 1, ...extra };
}

function times(creation: Record<number, number> = {}): TabTimes {
  return { creation, resurfaced: {}, lastAccessed: {} };
}

test('the default configuration recycles the least-recently-used tab', () => {
  assert.equal(DEFAULT_SETTINGS.oldestDefinition, 'lru');
});

test('enableStash defaults to true in DEFAULT_SETTINGS', () => {
  assert.equal(DEFAULT_SETTINGS.enableStash, true);
});

test('countRelevantTabs counts every tab when excludePinned is off', () => {
  const tabs = [tab(1), tab(2, { pinned: true }), tab(3)];
  assert.equal(countRelevantTabs(tabs, { ...baseSettings, excludePinned: false }), 3);
});

test('countRelevantTabs excludes pinned tabs when configured', () => {
  const tabs = [tab(1), tab(2, { pinned: true }), tab(3)];
  assert.equal(countRelevantTabs(tabs, { ...baseSettings, excludePinned: true }), 2);
});

test('isOverLimit compares the relevant count to maxTabs (equal is not over)', () => {
  const s = { ...baseSettings, maxTabs: 2, excludePinned: false };
  assert.equal(isOverLimit([tab(1), tab(2)], s), false);
  assert.equal(isOverLimit([tab(1), tab(2), tab(3)], s), true);
});

test('pinned tabs do not push the count over the limit when excluded', () => {
  const s = { ...baseSettings, maxTabs: 2, excludePinned: true };
  const tabs = [tab(1), tab(2), tab(3, { pinned: true }), tab(4, { pinned: true })];
  assert.equal(isOverLimit(tabs, s), false);
});



test('isExemptUrl exempts the settings page, dashboard, and chrome:// pages, but not the new-tab page', () => {
  assert.equal(isExemptUrl('chrome-extension://abc/src/options.html'), true);
  assert.equal(isExemptUrl('chrome-extension://abc/dashboard.html'), true);
  assert.equal(isExemptUrl('moz-extension://abc/dashboard.html'), true);
  assert.equal(isExemptUrl('chrome://settings/'), true);
  assert.equal(isExemptUrl('chrome://extensions/'), true);
  assert.equal(isExemptUrl('chrome://newtab/'), false);
  assert.equal(isExemptUrl('chrome://new-tab-page/'), false);
  assert.equal(isExemptUrl('https://example.com'), false);
  // A web page whose path merely contains "options.html" or "dashboard.html" must NOT be exempted.
  assert.equal(isExemptUrl('https://example.com/options.html'), false);
  assert.equal(isExemptUrl('https://example.com/dashboard.html'), false);
  assert.equal(isExemptUrl('about:blank'), false);
  assert.equal(isExemptUrl(undefined), false);
});

test('exempt tabs do not count toward the limit', () => {
  const tabs = [
    tab(1),
    tab(2, { url: 'chrome://settings/' }),
    tab(3, { url: 'chrome-extension://abc/src/options.html' }),
  ];
  assert.equal(countRelevantTabs(tabs, baseSettings), 1);
});

test('exempt tabs never push the count over the limit', () => {
  const s = { ...baseSettings, maxTabs: 2 };
  const tabs = [tab(1), tab(2), tab(3, { url: 'chrome://extensions/' })];
  assert.equal(isOverLimit(tabs, s), false);
});

test('the new-tab page still counts toward the limit', () => {
  const s = { ...baseSettings, maxTabs: 2 };
  const tabs = [tab(1), tab(2), tab(3, { url: 'chrome://newtab/' })];
  assert.equal(isOverLimit(tabs, s), true);
});

test('selectOldestTab picks the earliest creation time, ignoring the new tab', () => {
  const tabs = [tab(1), tab(2), tab(3)];
  const oldest = selectOldestTab(tabs, 3, times({ 1: 100, 2: 50, 3: 200 }), {
    ...baseSettings,
    oldestDefinition: 'creation',
  });
  assert.equal(oldest?.id, 2);
});

test('selectOldestTab uses Chrome lastAccessed in LRU mode (oldest touch wins)', () => {
  const tabs = [
    tab(1, { lastAccessed: 300 }),
    tab(2, { lastAccessed: 100 }),
    tab(3, { lastAccessed: 200 }),
  ];
  const oldest = selectOldestTab(tabs, 3, times(), { ...baseSettings, oldestDefinition: 'lru' });
  assert.equal(oldest?.id, 2);
});

test('LRU treats a never-accessed tab as the oldest touch', () => {
  const tabs = [tab(1, { lastAccessed: 500 }), tab(2)];
  const oldest = selectOldestTab(tabs, 99, times(), { ...baseSettings, oldestDefinition: 'lru' });
  assert.equal(oldest?.id, 2);
});

test('selectOldestTab never returns a pinned tab when excludePinned is set', () => {
  const tabs = [tab(1, { pinned: true }), tab(2), tab(3)];
  const oldest = selectOldestTab(tabs, 3, times({ 1: 1, 2: 100, 3: 200 }), baseSettings);
  assert.equal(oldest?.id, 2);
});



test('selectOldestTab never returns the options page', () => {
  const tabs = [tab(1, { url: 'chrome-extension://abc/src/options.html' }), tab(2), tab(3)];
  const oldest = selectOldestTab(tabs, 3, times({ 1: 1, 2: 100, 3: 200 }), baseSettings);
  assert.equal(oldest?.id, 2);
});

test('selectOldestTab never returns a chrome:// page', () => {
  const tabs = [tab(1, { url: 'chrome://settings/' }), tab(2), tab(3)];
  const oldest = selectOldestTab(tabs, 3, times({ 1: 1, 2: 100, 3: 200 }), baseSettings);
  assert.equal(oldest?.id, 2);
});

test('selectOldestTab may recycle the new-tab page', () => {
  const tabs = [tab(1, { url: 'chrome://newtab/' }), tab(2), tab(3)];
  const oldest = selectOldestTab(tabs, 3, times({ 1: 1, 2: 100, 3: 200 }), baseSettings);
  assert.equal(oldest?.id, 1);
});

test('selectOldestTab returns null when nothing is recyclable', () => {
  const tabs = [tab(1, { pinned: true }), tab(2, { pinned: true }), tab(3)];
  assert.equal(selectOldestTab(tabs, 3, times(), baseSettings), null);
});

test('selectOldestTab breaks ties by tab order (leftmost)', () => {
  const tabs = [tab(1), tab(2), tab(3)];
  const oldest = selectOldestTab(tabs, 3, times({ 1: 50, 2: 50, 3: 999 }), baseSettings);
  assert.equal(oldest?.id, 1);
});

test('selectOldestTab treats untracked tabs as oldest', () => {
  const tabs = [tab(1), tab(2)];
  const oldest = selectOldestTab(tabs, 99, times({ 2: 500 }), baseSettings);
  assert.equal(oldest?.id, 1);
});

test('selectOldestTab skips domains listed in skipResurfaceDomains', () => {
  const tabs = [
    tab(1, { url: 'https://youtube.com/watch?v=123' }),
    tab(2, { url: 'https://github.com' }),
    tab(3, { url: 'https://google.com' }),
  ];
  const oldest = selectOldestTab(tabs, 99, times({ 1: 50, 2: 100, 3: 200 }), {
    ...baseSettings,
    skipResurfaceDomains: ['youtube.com'],
  });
  assert.equal(oldest?.id, 2);
});

test('selectOldestTab prioritizes priority domains/keywords in priorityResurfaceDomains', () => {
  const tabs = [
    tab(1, { url: 'https://google.com' }),
    tab(2, { url: 'https://github.com/pulls' }),
    tab(3, { url: 'https://issues.apache.org' }),
  ];
  const oldest = selectOldestTab(tabs, 99, times({ 1: 50, 2: 100, 3: 200 }), {
    ...baseSettings,
    priorityResurfaceDomains: ['github.com', 'issue'],
  });
  assert.equal(oldest?.id, 2);
});

test('selectOldestTab filters out tabs resurfaced within the cooldown period', () => {
  const tabs = [
    tab(1, { lastAccessed: 100 }), // oldest but inside cooldown
    tab(2, { lastAccessed: 200 }), // second oldest, outside cooldown
  ];
  const now = Date.now();
  const oldest = selectOldestTab(
    tabs,
    99,
    {
      creation: {},
      resurfaced: {
        1: now - 2 * 60 * 1000, // resurfaced 2 mins ago (cooldown is 5 mins)
        2: now - 10 * 60 * 1000, // resurfaced 10 mins ago (outside cooldown)
      },
    },
    {
      ...baseSettings,
      oldestDefinition: 'lru',
      resurfaceCooldown: 5,
    }
  );
  assert.equal(oldest?.id, 2);
});

test('selectOldestTab allows tabs resurfaced outside the cooldown period', () => {
  const tabs = [
    tab(1, { lastAccessed: 100 }),
    tab(2, { lastAccessed: 200 }),
  ];
  const now = Date.now();
  const oldest = selectOldestTab(
    tabs,
    99,
    {
      creation: {},
      resurfaced: {
        1: now - 10 * 60 * 1000, // resurfaced 10 mins ago
        2: now - 15 * 60 * 1000, // resurfaced 15 mins ago
      },
    },
    {
      ...baseSettings,
      oldestDefinition: 'lru',
      resurfaceCooldown: 5,
    }
  );
  assert.equal(oldest?.id, 1);
});

test('selectOldestTab returns null if all candidates are within the cooldown period', () => {
  const tabs = [
    tab(1, { lastAccessed: 100 }),
    tab(2, { lastAccessed: 200 }),
  ];
  const now = Date.now();
  const oldest = selectOldestTab(
    tabs,
    99,
    {
      creation: {},
      resurfaced: {
        1: now - 2 * 60 * 1000,
        2: now - 3 * 60 * 1000,
      },
    },
    {
      ...baseSettings,
      oldestDefinition: 'lru',
      resurfaceCooldown: 5,
    }
  );
  assert.equal(oldest, null);
});

test('selectOldestTab ignores cooldown period skip if count of tabs in cooldown is >= limit', () => {
  const tabs = [
    tab(1, { lastAccessed: 100 }),
    tab(2, { lastAccessed: 200 }),
  ];
  const now = Date.now();
  const oldest = selectOldestTab(
    tabs,
    99,
    {
      creation: {},
      resurfaced: {
        1: now - 2 * 60 * 1000,
        2: now - 3 * 60 * 1000,
      },
    },
    {
      ...baseSettings,
      maxTabs: 2, // limit is 2, and we have 2 tabs in cooldown (so cooldownCount >= maxTabs)
      oldestDefinition: 'lru',
      resurfaceCooldown: 5,
    }
  );
  assert.equal(oldest?.id, 1); // should not be null, returns oldest
});


test('isStashableUrl accepts only http(s) destinations', () => {
  assert.equal(isStashableUrl('https://example.com'), true);
  assert.equal(isStashableUrl('http://example.com/path'), true);
  assert.equal(isStashableUrl('chrome://newtab'), false);
  assert.equal(isStashableUrl('about:blank'), false);
  assert.equal(isStashableUrl(undefined), false);
  assert.equal(isStashableUrl(''), false);
});

test('withUrlAdded inserts newest-first and de-duplicates by url', () => {
  let items = withUrlAdded([], 'https://a.com', 1);
  items = withUrlAdded(items, 'https://b.com', 2);
  items = withUrlAdded(items, 'https://a.com', 3);
  assert.deepEqual(items.map((i) => i.url), ['https://a.com', 'https://b.com']);
  assert.equal(items[0].time, 3);
});

test('withUrlAdded keeps an optional title', () => {
  const items = withUrlAdded([], 'https://a.com', 1, 'Example Site');
  assert.equal(items[0].title, 'Example Site');
});

test('withUrlAdded caps the list at 50 entries, keeping the newest', () => {
  let items = withUrlAdded([], 'https://seed.com', 0);
  for (let i = 0; i < 60; i++) {
    items = withUrlAdded(items, `https://site${i}.com`, i + 1);
  }
  assert.equal(items.length, 50);
  assert.equal(items[0].url, 'https://site59.com');
});

test('sortTabsForResurfacing sorts tabs oldest-first', () => {
  const tabs = [
    tab(1, { lastAccessed: 300 }),
    tab(2, { lastAccessed: 100 }),
    tab(3, { lastAccessed: 200 }),
  ];
  const sorted = sortTabsForResurfacing(tabs, times(), { ...baseSettings, oldestDefinition: 'lru' });
  assert.deepEqual(sorted.map((t) => t.id), [2, 3, 1]);
});

test('sortTabsForResurfacing prioritizes priority domains', () => {
  const tabs = [
    tab(1, { url: 'https://google.com', lastAccessed: 100 }),
    tab(2, { url: 'https://github.com', lastAccessed: 300 }),
    tab(3, { url: 'https://github.com', lastAccessed: 200 }),
  ];
  const sorted = sortTabsForResurfacing(tabs, times(), {
    ...baseSettings,
    oldestDefinition: 'lru',
    priorityResurfaceDomains: ['github.com'],
  });
  assert.deepEqual(sorted.map((t) => t.id), [3, 2, 1]);
});

test('sortTabsForResurfacing falls back to times.lastAccessed if tab.lastAccessed is missing', () => {
  const tabs = [
    tab(1),
    tab(2),
    tab(3),
  ];
  const sorted = sortTabsForResurfacing(
    tabs,
    {
      creation: {},
      lastAccessed: { 1: 300, 2: 100, 3: 200 },
    },
    { ...baseSettings, oldestDefinition: 'lru' }
  );
  assert.deepEqual(sorted.map((t) => t.id), [2, 3, 1]);
});
