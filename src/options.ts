import type { Settings, StashItem } from './types.ts';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings.ts';
import { getStash, setStash, STASH_KEY } from './stash.ts';

const maxTabsInput = document.getElementById('maxTabs') as HTMLInputElement;
const limitScopeSelect = document.getElementById('limitScope') as HTMLSelectElement;
const oldestDefinitionSelect = document.getElementById('oldestDefinition') as HTMLSelectElement;
const stashLocationSelect = document.getElementById('stashLocation') as HTMLSelectElement;
const excludePinnedCheckbox = document.getElementById('excludePinned') as HTMLInputElement;
const excludeIncognitoCheckbox = document.getElementById('excludeIncognito') as HTMLInputElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const statusText = document.getElementById('status') as HTMLSpanElement;

// Restore saved settings.
void loadSettings().then((settings) => {
  maxTabsInput.value = settings.maxTabs.toString();
  limitScopeSelect.value = settings.limitScope;
  oldestDefinitionSelect.value = settings.oldestDefinition;
  stashLocationSelect.value = settings.stashLocation || 'local';
  excludePinnedCheckbox.checked = settings.excludePinned;
  excludeIncognitoCheckbox.checked = settings.excludeIncognito;
});

function readMaxTabs(): number {
  const parsed = parseInt(maxTabsInput.value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.maxTabs;
  return Math.min(500, Math.max(1, parsed));
}

saveBtn.addEventListener('click', async () => {
  const oldSettings = await loadSettings();
  const newStashLocation = stashLocationSelect.value as Settings['stashLocation'];

  const settings: Settings = {
    maxTabs: readMaxTabs(),
    limitScope: limitScopeSelect.value as Settings['limitScope'],
    oldestDefinition: oldestDefinitionSelect.value as Settings['oldestDefinition'],
    excludePinned: excludePinnedCheckbox.checked,
    excludeIncognito: excludeIncognitoCheckbox.checked,
    stashLocation: newStashLocation,
  };
  // Reflect any clamping back to the field.
  maxTabsInput.value = settings.maxTabs.toString();

  if (oldSettings.stashLocation !== newStashLocation) {
    // 1. Read stashed items from the current/old location
    const itemsToMigrate = await getStash();

    // 2. Save the settings so getStash/setStash use the new location
    await saveSettings(settings);

    // 3. Read any existing items from the new location to merge
    const existingItems = await getStash();

    // 4. Merge them (newest first, unique by URL)
    const merged = new Map<string, StashItem>();
    for (const item of [...existingItems, ...itemsToMigrate]) {
      const existing = merged.get(item.url);
      if (!existing || item.time > existing.time) {
        merged.set(item.url, item);
      }
    }
    const mergedItems = Array.from(merged.values())
      .sort((a, b) => b.time - a.time);

    // 5. Save the merged list to the new location
    await setStash(mergedItems);

    // 6. Remove the stash from the old storage to clean up
    const oldStorage = oldSettings.stashLocation === 'sync' ? chrome.storage.sync : chrome.storage.local;
    await oldStorage.remove(STASH_KEY);
  } else {
    await saveSettings(settings);
  }

  statusText.style.opacity = '1';
  setTimeout(() => {
    statusText.style.opacity = '0';
  }, 2500);
});
