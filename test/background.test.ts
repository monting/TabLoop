import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStash, setStash, STASH_KEY } from '../src/stash.ts';

// Define chrome mock listeners and storage
const chromeListeners = {
  onInstalled: [] as Function[],
  onStartup: [] as Function[],
  onRemoved: [] as Function[],
  onCreated: [] as Function[],
  onMessage: [] as Function[],
  storageChanged: [] as Function[],
};

const mockStorage = {
  session: {} as Record<string, any>,
  sync: {} as Record<string, any>,
  local: {} as Record<string, any>,
};

const callLog: { method: string; args: any[] }[] = [];
let onUpdateResolve: (() => void) | null = null;
const updatePromise = new Promise<void>((resolve) => {
  onUpdateResolve = resolve;
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
    query: async (queryInfo: any) => {
      // Simulate existing tabs.
      // tab 1 is the oldest, located in window 1.
      // tab 2 is another tab, located in window 1.
      // tab 3 is the new tab, located in window 2.
      return [
        { id: 1, pinned: false, incognito: false, windowId: 1, url: 'https://google.com', lastAccessed: 100 },
        { id: 2, pinned: false, incognito: false, windowId: 1, url: 'https://github.com', lastAccessed: 200 },
        { id: 3, pinned: false, incognito: false, windowId: 2, url: 'chrome://newtab/', lastAccessed: 300 },
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
      if (onUpdateResolve) onUpdateResolve();
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
  excludeIncognito: true,
  stashLocation: 'local',
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
    incognito: false,
    windowId: 2,
    url: 'chrome://newtab/',
    lastAccessed: 300,
  });

  // Wait for the operations to complete (resolved by the update spy)
  await updatePromise;

  // Verify the sequence of calls
  assert.equal(callLog.length, 3, 'Expected exactly 3 tab operations');
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
});

test('getStash and setStash use storage.local when stashLocation is local', async () => {
  mockStorage.sync.settings = {
    maxTabs: 5,
    limitScope: 'global',
    oldestDefinition: 'lru',
    excludePinned: true,
    excludeIncognito: true,
    stashLocation: 'local',
  };

  mockStorage.local[STASH_KEY] = [{ url: 'https://local.com', time: 100 }];
  mockStorage.sync[STASH_KEY] = [{ url: 'https://sync.com', time: 200 }];

  const stash = await getStash();
  assert.deepEqual(stash, [{ url: 'https://local.com', time: 100 }]);

  await setStash([{ url: 'https://local-new.com', time: 300 }]);
  assert.deepEqual(mockStorage.local[STASH_KEY], [{ url: 'https://local-new.com', time: 300 }]);
  assert.deepEqual(mockStorage.sync[STASH_KEY], [{ url: 'https://sync.com', time: 200 }]);
});

test('getStash and setStash use storage.sync when stashLocation is sync', async () => {
  mockStorage.sync.settings = {
    maxTabs: 5,
    limitScope: 'global',
    oldestDefinition: 'lru',
    excludePinned: true,
    excludeIncognito: true,
    stashLocation: 'sync',
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
    excludeIncognito: true,
    stashLocation: 'sync',
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
