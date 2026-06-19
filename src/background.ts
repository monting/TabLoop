import type { Settings } from './types';

// State management
let tabCreationTimes: Record<number, number> = {};
let tabLastActiveTimes: Record<number, number> = {};

const defaultSettings: Settings = {
  maxTabs: 10,
  limitScope: 'global',
  oldestDefinition: 'creation',
  excludePinned: true
};

let currentSettings = { ...defaultSettings };

// Load settings
chrome.storage.sync.get('settings', (data) => {
  if (data.settings) {
    currentSettings = { ...defaultSettings, ...data.settings };
  }
});

// Listen for settings updates
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    const newSettings = changes.settings.newValue as Partial<Settings> | undefined;
    if (newSettings) {
      currentSettings = { ...currentSettings, ...newSettings };
    }
  }
});

// Initialize state for existing tabs
chrome.tabs.query({}, (tabs) => {
  const now = Date.now();
  tabs.forEach(tab => {
    if (tab.id) {
      tabCreationTimes[tab.id] = now;
      tabLastActiveTimes[tab.id] = tab.active ? now : 0;
    }
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  tabLastActiveTimes[activeInfo.tabId] = Date.now();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabCreationTimes[tabId];
  delete tabLastActiveTimes[tabId];
});

let isProcessing = false;

chrome.tabs.onCreated.addListener(async (newTab) => {
  if (isProcessing || !newTab.id) return;
  
  tabCreationTimes[newTab.id] = Date.now();
  tabLastActiveTimes[newTab.id] = newTab.active ? Date.now() : 0;

  try {
    isProcessing = true;
    
    // Evaluate limits
    const tabs = await chrome.tabs.query(
      currentSettings.limitScope === 'per-window' ? { windowId: newTab.windowId } : {}
    );
    
    if (tabs.length > currentSettings.maxTabs) {
      // Find oldest tab candidates
      let candidates = tabs.filter(t => t.id !== newTab.id);
      
      if (currentSettings.excludePinned) {
        candidates = candidates.filter(t => !t.pinned);
      }
      
      // Protect the options page from being closed if it's the oldest
      candidates = candidates.filter(t => !t.url?.includes('options.html'));

      // If no tabs can be moved, allow creation
      if (candidates.length === 0) {
          return;
      }
      
      candidates.sort((a, b) => {
        if (currentSettings.oldestDefinition === 'lru') {
          return (tabLastActiveTimes[a.id!] || 0) - (tabLastActiveTimes[b.id!] || 0);
        } else {
          return (tabCreationTimes[a.id!] || 0) - (tabCreationTimes[b.id!] || 0);
        }
      });
      
      const oldestTab = candidates[0];
      
      // Action: Close new tab, move oldest to current window, and focus it
      await chrome.tabs.remove(newTab.id);
      
      if (oldestTab.windowId !== newTab.windowId) {
        await chrome.tabs.move(oldestTab.id!, { windowId: newTab.windowId, index: -1 });
      }
      await chrome.tabs.update(oldestTab.id!, { active: true });
    }
  } catch (error) {
    console.error("Error processing new tab:", error);
  } finally {
    isProcessing = false;
  }
});
