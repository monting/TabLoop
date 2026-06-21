import { test } from 'node:test';
import assert from 'node:assert/strict';

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
