import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStash, setStash, STASH_KEY } from '../src/stash.ts';

// Define chrome mock listeners and storage
const chromeListeners = {
  onInstalled: [] as Function[],
  onStartup: [] as Function[],
  onRemoved: [] as Function[],
  onCreated: [] as Function[],
  onUpdated: [] as Function[],
  onMessage: [] as Function[],
  storageChanged: [] as Function[],
};

const mockStorage = {
  session: {} as Record<string, any>,
  sync: {} as Record<string, any>,
  local: {} as Record<string, any>,
};

const callLog: { method: string; args: any[] }[] = [];
let onWindowsUpdateResolve: (() => void) | null = null;
const windowsUpdatePromise = new Promise<void>((resolve) => {
  onWindowsUpdateResolve = resolve;
});

// Set up global.chrome before importing the background module
global.chrome = {
  runtime: {
    onInstalled: {
      addListener(cb: Function) {
        chromeListeners.onInstalled.push(cb);
      },
    },
    onStartup: {
      addListener(cb: Function) {
        chromeListeners.onStartup.push(cb);
      },
    },
    onMessage: {
      addListener(cb: Function) {
        chromeListeners.onMessage.push(cb);
      },
    },
  },
  tabs: {
    onRemoved: {
      addListener(cb: Function) {
        chromeListeners.onRemoved.push(cb);
      },
    },
    onCreated: {
      addListener(cb: Function) {
        chromeListeners.onCreated.push(cb);
      },
    },
    onUpdated: {
      addListener(cb: Function) {
        chromeListeners.onUpdated.push(cb);
      },
    },
    query: async (queryInfo: any) => {
      // Simulate existing tabs.
      // tab 1 is the oldest, located in window 1.
      // tab 2 is another tab, located in window 1.
      // tab 3 is the new tab, located in window 2.
      return [
        { id: 1, pinned: false, windowId: 1, url: 'https://google.com', lastAccessed: 100 },
        { id: 2, pinned: false, windowId: 1, url: 'https://github.com', lastAccessed: 200 },
        { id: 3, pinned: false, windowId: 2, url: 'chrome://newtab/', lastAccessed: 300 },
      ];
    },
    remove: async (tabId: number) => {
      callLog.push({ method: 'remove', args: [tabId] });
    },
    move: async (tabId: number, moveProperties: any) => {
      callLog.push({ method: 'move', args: [tabId, moveProperties] });
    },
    update: async (tabId: number, updateProperties: any) => {
      callLog.push({ method: 'update', args: [tabId, updateProperties] });
    },
    create: async () => ({ id: 99, windowId: 1 }),
  },
  windows: {
    create: async () => {},
    update: async (windowId: number, updateProperties: any) => {
      callLog.push({ method: 'windows.update', args: [windowId, updateProperties] });
      if (onWindowsUpdateResolve) onWindowsUpdateResolve();
    },
  },
  action: {
    setBadgeBackgroundColor: async () => {},
    setBadgeText: async () => {},
  },
  storage: {
    session: {
      get: async (key: string) => {
        return { [key]: mockStorage.session[key] };
      },
      set: async (items: any) => {
        Object.assign(mockStorage.session, items);
      },
    },
    sync: {
      get: async (key: string) => {
        return { [key]: mockStorage.sync[key] };
      },
      set: async (items: any) => {
        Object.assign(mockStorage.sync, items);
      },
    },
    local: {
      get: async (key: string) => {
        return { [key]: mockStorage.local[key] };
      },
      set: async (items: any) => {
        Object.assign(mockStorage.local, items);
      },
    },
    onChanged: {
      addListener(cb: Function) {
        chromeListeners.storageChanged.push(cb);
      },
    },
  },
} as any;

// Populate initial sync storage with settings
mockStorage.sync.settings = {
  maxTabs: 2,
  limitScope: 'global',
  oldestDefinition: 'lru',
  excludePinned: true,
  syncStash: false,
};

// Dynamically import background.ts so it registers listeners against our mock global.chrome
await import('../src/background.ts');

test('when a new tab in a new window triggers recycling, the oldest tab is moved to the new window before the empty new tab is closed', async () => {
  // Find the listener registered for chrome.tabs.onCreated
  const onCreatedListener = chromeListeners.onCreated[0];
  assert.ok(onCreatedListener, 'background.ts should register an onCreated listener');

  // Trigger the listener for the new tab (tab 3, in window 2)
  onCreatedListener({
    id: 3,
    pinned: false,
    windowId: 2,
    url: 'chrome://newtab/',
    lastAccessed: 300,
  });

  // Wait for the operations to complete (resolved by the windows.update spy)
  await windowsUpdatePromise;

  // Verify the sequence of calls
  assert.equal(callLog.length, 4, 'Expected exactly 4 tab/window operations');
  assert.deepEqual(callLog[0], {
    method: 'move',
    args: [1, { windowId: 2, index: -1 }],
  }, 'Expected move to be called first to move oldest tab (1) into the new window (2)');
  
  assert.deepEqual(callLog[1], {
    method: 'remove',
    args: [3],
  }, 'Expected remove to be called second to close the new empty tab (3)');

  assert.deepEqual(callLog[2], {
    method: 'update',
    args: [1, { active: true }],
  }, 'Expected update to be called third to activate the moved tab (1)');

  assert.deepEqual(callLog[3], {
    method: 'windows.update',
    args: [2, { focused: true }],
  }, 'Expected windows.update to be called fourth to focus the window (2)');
});

test('getStash and setStash use storage.local when syncStash is false', async () => {
  mockStorage.sync.settings = {
    maxTabs: 5,
    limitScope: 'global',
    oldestDefinition: 'lru',
    excludePinned: true,
    syncStash: false,
  };

  mockStorage.local[STASH_KEY] = [{ url: 'https://local.com', time: 100 }];
  mockStorage.sync[STASH_KEY] = [{ url: 'https://sync.com', time: 200 }];

  const stash = await getStash();
  assert.deepEqual(stash, [{ url: 'https://local.com', time: 100 }]);

  await setStash([{ url: 'https://local-new.com', time: 300 }]);
  assert.deepEqual(mockStorage.local[STASH_KEY], [{ url: 'https://local-new.com', time: 300 }]);
  assert.deepEqual(mockStorage.sync[STASH_KEY], [{ url: 'https://sync.com', time: 200 }]);
});

test('getStash and setStash use storage.sync when syncStash is true', async () => {
  mockStorage.sync.settings = {
    maxTabs: 5,
    limitScope: 'global',
    oldestDefinition: 'lru',
    excludePinned: true,
    syncStash: true,
  };

  mockStorage.local[STASH_KEY] = [{ url: 'https://local.com', time: 100 }];
  mockStorage.sync[STASH_KEY] = [{ url: 'https://sync.com', time: 200 }];

  const stash = await getStash();
  assert.deepEqual(stash, [{ url: 'https://sync.com', time: 200 }]);

  await setStash([{ url: 'https://sync-new.com', time: 300 }]);
  assert.deepEqual(mockStorage.sync[STASH_KEY], [{ url: 'https://sync-new.com', time: 300 }]);
  assert.deepEqual(mockStorage.local[STASH_KEY], [{ url: 'https://local.com', time: 100 }]);
});

test('setStash prunes oldest items to stay under 8KB limit when using sync storage', async () => {
  mockStorage.sync.settings = {
    maxTabs: 5,
    limitScope: 'global',
    oldestDefinition: 'lru',
    excludePinned: true,
    syncStash: true,
  };

  // Create a list of 50 items with extremely long URLs to exceed 8KB
  const longItems: any[] = [];
  const longUrl = 'https://example.com/' + 'a'.repeat(400); // ~400 char URL
  for (let i = 0; i < 50; i++) {
    longItems.unshift({
      url: `${longUrl}/${i}`,
      title: `Long Title ${i}`,
      time: i,
    });
  }

  // Ensure JSON representation is over 8000 characters
  const originalJson = JSON.stringify(longItems);
  assert.ok(originalJson.length > 8000, `Expected original JSON length (${originalJson.length}) to be > 8000`);

  await setStash(longItems);

  // The stored items in sync should be pruned
  const stored = mockStorage.sync[STASH_KEY];
  const storedJson = JSON.stringify(stored);
  assert.ok(storedJson.length <= 8000, `Expected pruned JSON length (${storedJson.length}) to be <= 8000`);
  assert.ok(stored.length < 50, `Expected item count (${stored.length}) to be pruned below 50`);
  assert.equal(stored[0].time, 49); // Newest should still be there
});

test('when a new tab triggers recycling but is missing from query results (race condition), it is still correctly recycled', async () => {
  // Save original settings
  const originalSettings = { ...mockStorage.sync.settings };
  mockStorage.sync.settings.maxTabs = 2;

  // Clear call log
  callLog.length = 0;
  
  // Set up a custom resolve promise for the windows.update call
  let resolveWindowsUpdate: (() => void) | null = null;
  const windowsUpdatePromise = new Promise<void>((resolve) => {
    resolveWindowsUpdate = resolve;
  });
  
  // Temporarily override windows.update to resolve our promise
  const originalWindowsUpdate = global.chrome.windows.update;
  global.chrome.windows.update = async (windowId: number, updateProperties: any) => {
    callLog.push({ method: 'windows.update', args: [windowId, updateProperties] });
    if (resolveWindowsUpdate) resolveWindowsUpdate();
  };

  // Temporarily override query to NOT include the new tab (tab 4)
  const originalQuery = global.chrome.tabs.query;
  global.chrome.tabs.query = async (queryInfo: any) => {
    return [
      { id: 1, pinned: false, windowId: 1, url: 'https://google.com', lastAccessed: 100 },
      { id: 2, pinned: false, windowId: 1, url: 'https://github.com', lastAccessed: 200 },
    ];
  };

  const onCreatedListener = chromeListeners.onCreated[0];
  
  // Trigger the listener for a new tab (tab 4, in window 1)
  onCreatedListener({
    id: 4,
    pinned: false,
    windowId: 1,
    url: 'chrome://newtab/',
    lastAccessed: 400,
  });

  await windowsUpdatePromise;

  // Restore overrides and settings
  global.chrome.tabs.query = originalQuery;
  global.chrome.windows.update = originalWindowsUpdate;
  mockStorage.sync.settings = originalSettings;

  // Verify the sequence of calls: it should still have recycled
  assert.equal(callLog.length, 3, 'Expected exactly 3 operations (no move needed since windowId is same)');
  assert.deepEqual(callLog[0], {
    method: 'remove',
    args: [4],
  }, 'Expected remove to be called to close the new empty tab (4)');
  assert.deepEqual(callLog[1], {
    method: 'update',
    args: [1, { active: true }],
  }, 'Expected update to be called to activate the oldest tab (1)');
  assert.deepEqual(callLog[2], {
    method: 'windows.update',
    args: [1, { focused: true }],
  }, 'Expected windows.update to focus the window (1)');
});

test('when chrome.tabs.move throws an error (e.g. cross-profile movement), the new tab is still closed and the oldest tab is updated', async () => {
  // Save original settings
  const originalSettings = { ...mockStorage.sync.settings };
  mockStorage.sync.settings.maxTabs = 2;

  // Clear call log
  callLog.length = 0;
  
  // Set up a custom resolve promise for the windows.update call
  let resolveWindowsUpdate: (() => void) | null = null;
  const windowsUpdatePromise = new Promise<void>((resolve) => {
    resolveWindowsUpdate = resolve;
  });
  
  // The catch-path logs via console.warn; capture it so it doesn't print as a scary
  // "Error:" line during an otherwise-passing run (and assert it actually fires).
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(' '));
  };

  // Temporarily override move to throw an error
  const originalMove = global.chrome.tabs.move;
  global.chrome.tabs.move = async (tabId: number, moveProperties: any) => {
    callLog.push({ method: 'move', args: [tabId, moveProperties] });
    throw new Error('Tabs can only be moved between windows in the same profile.');
  };

  // Temporarily override windows.update to resolve our promise
  const originalWindowsUpdate = global.chrome.windows.update;
  global.chrome.windows.update = async (windowId: number, updateProperties: any) => {
    callLog.push({ method: 'windows.update', args: [windowId, updateProperties] });
    if (resolveWindowsUpdate) resolveWindowsUpdate();
  };

  // Override query to return a tab in window 1, while the new tab is in window 2 (so a move is attempted)
  const originalQuery = global.chrome.tabs.query;
  global.chrome.tabs.query = async (queryInfo: any) => {
    return [
      { id: 1, pinned: false, windowId: 1, url: 'https://google.com', lastAccessed: 100 },
      { id: 2, pinned: false, windowId: 1, url: 'https://github.com', lastAccessed: 200 },
      { id: 3, pinned: false, windowId: 2, url: 'chrome://newtab/', lastAccessed: 300 },
    ];
  };

  const onCreatedListener = chromeListeners.onCreated[0];
  
  // Trigger the listener for the new tab (tab 3, in window 2)
  onCreatedListener({
    id: 3,
    pinned: false,
    windowId: 2,
    url: 'chrome://newtab/',
    lastAccessed: 300,
  });

  await windowsUpdatePromise;

  // Restore overrides and settings
  global.chrome.tabs.move = originalMove;
  global.chrome.windows.update = originalWindowsUpdate;
  global.chrome.tabs.query = originalQuery;
  console.warn = originalWarn;
  mockStorage.sync.settings = originalSettings;

  // Verify the sequence of calls
  assert.equal(callLog.length, 4, 'Expected exactly 4 tab operations');
  assert.deepEqual(callLog[0], {
    method: 'move',
    args: [1, { windowId: 2, index: -1 }],
  }, 'Expected move to be called first and fail');
  assert.deepEqual(callLog[1], {
    method: 'remove',
    args: [3],
  }, 'Expected remove to still be called second to close the new empty tab (3)');
  assert.deepEqual(callLog[2], {
    method: 'update',
    args: [1, { active: true }],
  }, 'Expected update to still be called third to activate the oldest tab (1)');
  assert.deepEqual(callLog[3], {
    method: 'windows.update',
    args: [1, { focused: true }],
  }, 'Expected windows.update to focus the original window (1)');

  assert.ok(
    warnings.some((w) => w.includes('Could not move oldest tab to new window')),
    'Expected a warning to be logged when the cross-profile move fails',
  );
});

test('updateBadge sets negative badge text when over limit', async () => {
  // Save original settings
  const originalSettings = { ...mockStorage.sync.settings };
  mockStorage.sync.settings.maxTabs = 2; // set limit to 2
  mockStorage.sync.settings.excludePinned = true;
  
  let badgeText = '';
  let resolveBadge: (() => void) | null = null;
  const badgePromise = new Promise<void>((resolve) => {
    resolveBadge = resolve;
  });

  const originalSetBadgeText = global.chrome.action.setBadgeText;
  global.chrome.action.setBadgeText = async (details: any) => {
    badgeText = details.text;
    if (resolveBadge) resolveBadge();
  };

  // Mock chrome.tabs.query to return 3 tabs (which is 1 over the limit of 2)
  const originalQuery = global.chrome.tabs.query;
  global.chrome.tabs.query = async (queryInfo: any) => {
    return [
      { id: 1, pinned: false, windowId: 1, url: 'https://google.com', lastAccessed: 100 },
      { id: 2, pinned: false, windowId: 1, url: 'https://github.com', lastAccessed: 200 },
      { id: 3, pinned: false, windowId: 1, url: 'https://yahoo.com', lastAccessed: 300 },
    ];
  };

  // Trigger updateBadge indirectly via storage onChanged listener
  const storageListener = chromeListeners.storageChanged[0];
  if (storageListener) {
    storageListener({ settings: {} }, 'sync');
  }

  // Wait for the badge text to be set
  await badgePromise;

  // Restore
  global.chrome.action.setBadgeText = originalSetBadgeText;
  global.chrome.tabs.query = originalQuery;
  mockStorage.sync.settings = originalSettings;

  assert.equal(badgeText, '-1', 'Badge text should reflect exceeded tabs as a negative count');
});

test('updateBadge clears badge text when remaining slots are plenty', async () => {
  const originalSettings = { ...mockStorage.sync.settings };
  mockStorage.sync.settings.maxTabs = 10; // set limit to 10
  mockStorage.sync.settings.excludePinned = true;
  
  let badgeText = 'initial';
  let resolveBadge: (() => void) | null = null;
  const badgePromise = new Promise<void>((resolve) => {
    resolveBadge = resolve;
  });

  const originalSetBadgeText = global.chrome.action.setBadgeText;
  global.chrome.action.setBadgeText = async (details: any) => {
    badgeText = details.text;
    if (resolveBadge) resolveBadge();
  };

  const originalQuery = global.chrome.tabs.query;
  global.chrome.tabs.query = async () => {
    return [
      { id: 1, pinned: false, windowId: 1, url: 'https://google.com', lastAccessed: 100 },
      { id: 2, pinned: false, windowId: 1, url: 'https://github.com', lastAccessed: 200 },
      { id: 3, pinned: false, windowId: 1, url: 'https://yahoo.com', lastAccessed: 300 },
    ];
  };

  const storageListener = chromeListeners.storageChanged[0];
  if (storageListener) {
    storageListener({ settings: {} }, 'sync');
  }

  await badgePromise;

  global.chrome.action.setBadgeText = originalSetBadgeText;
  global.chrome.tabs.query = originalQuery;
  mockStorage.sync.settings = originalSettings;

  assert.equal(badgeText, '', 'Badge text should be cleared when remaining slots are plenty');
});

test('updateBadge sets badge text when remaining slots are <= 5', async () => {
  const originalSettings = { ...mockStorage.sync.settings };
  mockStorage.sync.settings.maxTabs = 6; // set limit to 6 (6 - 3 = 3 slots left)
  mockStorage.sync.settings.excludePinned = true;
  
  let badgeText = '';
  let resolveBadge: (() => void) | null = null;
  const badgePromise = new Promise<void>((resolve) => {
    resolveBadge = resolve;
  });

  const originalSetBadgeText = global.chrome.action.setBadgeText;
  global.chrome.action.setBadgeText = async (details: any) => {
    badgeText = details.text;
    if (resolveBadge) resolveBadge();
  };

  const originalQuery = global.chrome.tabs.query;
  global.chrome.tabs.query = async () => {
    return [
      { id: 1, pinned: false, windowId: 1, url: 'https://google.com', lastAccessed: 100 },
      { id: 2, pinned: false, windowId: 1, url: 'https://github.com', lastAccessed: 200 },
      { id: 3, pinned: false, windowId: 1, url: 'https://yahoo.com', lastAccessed: 300 },
    ];
  };

  const storageListener = chromeListeners.storageChanged[0];
  if (storageListener) {
    storageListener({ settings: {} }, 'sync');
  }

  await badgePromise;

  global.chrome.action.setBadgeText = originalSetBadgeText;
  global.chrome.tabs.query = originalQuery;
  mockStorage.sync.settings = originalSettings;

  assert.equal(badgeText, '3', 'Badge text should show remaining slots when remaining slots are <= 5');
});

test('updateBadge sets badge text and green color when remaining slots are exactly 5', async () => {
  const originalSettings = { ...mockStorage.sync.settings };
  mockStorage.sync.settings.maxTabs = 8; // set limit to 8 (8 - 3 = 5 slots left)
  mockStorage.sync.settings.excludePinned = true;
  
  let badgeText = '';
  let badgeColor = '';
  let resolveBadge: (() => void) | null = null;
  const badgePromise = new Promise<void>((resolve) => {
    resolveBadge = resolve;
  });

  const originalSetBadgeText = global.chrome.action.setBadgeText;
  global.chrome.action.setBadgeText = async (details: any) => {
    badgeText = details.text;
    if (resolveBadge) resolveBadge();
  };

  const originalSetBadgeColor = global.chrome.action.setBadgeBackgroundColor;
  global.chrome.action.setBadgeBackgroundColor = async (details: any) => {
    badgeColor = details.color;
  };

  const originalQuery = global.chrome.tabs.query;
  global.chrome.tabs.query = async () => {
    return [
      { id: 1, pinned: false, windowId: 1, url: 'https://google.com', lastAccessed: 100 },
      { id: 2, pinned: false, windowId: 1, url: 'https://github.com', lastAccessed: 200 },
      { id: 3, pinned: false, windowId: 1, url: 'https://yahoo.com', lastAccessed: 300 },
    ];
  };

  const storageListener = chromeListeners.storageChanged[0];
  if (storageListener) {
    storageListener({ settings: {} }, 'sync');
  }

  await badgePromise;

  global.chrome.action.setBadgeText = originalSetBadgeText;
  global.chrome.action.setBadgeBackgroundColor = originalSetBadgeColor;
  global.chrome.tabs.query = originalQuery;
  mockStorage.sync.settings = originalSettings;

  assert.equal(badgeText, '5', 'Badge text should show remaining slots when remaining slots are 5');
  assert.equal(badgeColor, '#22c55e', 'Badge color should be green when remaining slots is 5');
});

test('updateBadge sets badge text and red color when remaining slots are exactly 3', async () => {
  const originalSettings = { ...mockStorage.sync.settings };
  mockStorage.sync.settings.maxTabs = 6; // set limit to 6 (6 - 3 = 3 slots left)
  mockStorage.sync.settings.excludePinned = true;
  
  let badgeText = '';
  let badgeColor = '';
  let resolveBadge: (() => void) | null = null;
  const badgePromise = new Promise<void>((resolve) => {
    resolveBadge = resolve;
  });

  const originalSetBadgeText = global.chrome.action.setBadgeText;
  global.chrome.action.setBadgeText = async (details: any) => {
    badgeText = details.text;
    if (resolveBadge) resolveBadge();
  };

  const originalSetBadgeColor = global.chrome.action.setBadgeBackgroundColor;
  global.chrome.action.setBadgeBackgroundColor = async (details: any) => {
    badgeColor = details.color;
  };

  const originalQuery = global.chrome.tabs.query;
  global.chrome.tabs.query = async () => {
    return [
      { id: 1, pinned: false, windowId: 1, url: 'https://google.com', lastAccessed: 100 },
      { id: 2, pinned: false, windowId: 1, url: 'https://github.com', lastAccessed: 200 },
      { id: 3, pinned: false, windowId: 1, url: 'https://yahoo.com', lastAccessed: 300 },
    ];
  };

  const storageListener = chromeListeners.storageChanged[0];
  if (storageListener) {
    storageListener({ settings: {} }, 'sync');
  }

  await badgePromise;

  global.chrome.action.setBadgeText = originalSetBadgeText;
  global.chrome.action.setBadgeBackgroundColor = originalSetBadgeColor;
  global.chrome.tabs.query = originalQuery;
  mockStorage.sync.settings = originalSettings;

  assert.equal(badgeText, '3', 'Badge text should show remaining slots when remaining slots are 3');
  assert.equal(badgeColor, '#ef4444', 'Badge color should be red when remaining slots is 3');
});

test('a tab opened via the escape hatch bypasses the limit and is not recycled', async () => {
  const originalSettings = { ...mockStorage.sync.settings };
  mockStorage.sync.settings.maxTabs = 2; // query returns 3 tabs => over limit
  callLog.length = 0;

  // The escape message creates a tab (mock returns id 99); register the intent.
  const onMessage = chromeListeners.onMessage[0];
  onMessage('escape-hatch-tab');
  // Let chrome.tabs.create resolve so id 99 is recorded as an escape tab.
  await new Promise((r) => setTimeout(r, 0));

  // Its onCreated then fires; handleCreated must let it through untouched.
  const onCreated = chromeListeners.onCreated[0];
  onCreated({ id: 99, pinned: false, windowId: 1, url: '' });
  await new Promise((r) => setTimeout(r, 10));

  mockStorage.sync.settings = originalSettings;

  const recycling = callLog.filter((c) => ['move', 'remove', 'update'].includes(c.method));
  assert.deepEqual(recycling, [], 'Escape tab must not trigger any recycling');
});

test('an unrelated tab created while an escape is in-flight is still enforced', async () => {
  const originalSettings = { ...mockStorage.sync.settings };
  mockStorage.sync.settings.maxTabs = 2;
  callLog.length = 0;

  // Hold the escape creation open so it is still in-flight when the other tab arrives.
  let resolveCreate: ((v: any) => void) | null = null;
  const originalCreate = global.chrome.tabs.create;
  global.chrome.tabs.create = () =>
    new Promise((res) => {
      resolveCreate = res;
    }) as any;

  let resolveWindowsUpdate: (() => void) | null = null;
  const windowsUpdatePromise = new Promise<void>((resolve) => {
    resolveWindowsUpdate = resolve;
  });
  const originalWindowsUpdate = global.chrome.windows.update;
  global.chrome.windows.update = async (windowId: number, updateProperties: any) => {
    callLog.push({ method: 'windows.update', args: [windowId, updateProperties] });
    if (resolveWindowsUpdate) resolveWindowsUpdate();
  };

  const onMessage = chromeListeners.onMessage[0];
  onMessage('escape-hatch-tab'); // create stays pending (resolveCreate not called yet)

  // An unrelated, over-limit tab is created before the escape resolves.
  const onCreated = chromeListeners.onCreated[0];
  onCreated({ id: 7, pinned: false, windowId: 1, url: '' });
  await new Promise((r) => setTimeout(r, 0)); // let handleCreated(7) reach its await

  // Now the escape creation finishes (id 88), but tab 7 must still be recycled.
  if (resolveCreate) resolveCreate({ id: 88, windowId: 1 });
  await windowsUpdatePromise;

  global.chrome.tabs.create = originalCreate;
  global.chrome.windows.update = originalWindowsUpdate;
  mockStorage.sync.settings = originalSettings;

  assert.ok(
    callLog.some((c) => c.method === 'remove' && c.args[0] === 7),
    'The unrelated tab (7) should be recycled, not exempted by the pending escape',
  );
});



