import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  maxTabs: 100,
  limitScope: 'global',
  limitBehavior: 'focus',
  oldestDefinition: 'lru',
  excludePinned: true,
  syncStash: false,
  skipResurfaceDomains: [],
  priorityResurfaceDomains: [],
  resurfaceCooldown: 5,
};

/** Load settings from sync storage, falling back to defaults for missing keys. */
export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(data.settings as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}
