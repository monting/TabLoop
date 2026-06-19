import type { Settings } from './types';

const defaultSettings: Settings = {
  maxTabs: 10,
  limitScope: 'global',
  oldestDefinition: 'creation',
  excludePinned: true
};

const maxTabsInput = document.getElementById('maxTabs') as HTMLInputElement;
const limitScopeSelect = document.getElementById('limitScope') as HTMLSelectElement;
const oldestDefinitionSelect = document.getElementById('oldestDefinition') as HTMLSelectElement;
const excludePinnedCheckbox = document.getElementById('excludePinned') as HTMLInputElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const statusText = document.getElementById('status') as HTMLSpanElement;

// Restore settings
chrome.storage.sync.get('settings', (data) => {
  const settings: Settings = data.settings ? { ...defaultSettings, ...data.settings } : defaultSettings;
  maxTabsInput.value = settings.maxTabs.toString();
  limitScopeSelect.value = settings.limitScope;
  oldestDefinitionSelect.value = settings.oldestDefinition;
  excludePinnedCheckbox.checked = settings.excludePinned;
});

// Save settings
saveBtn.addEventListener('click', () => {
  const settings: Settings = {
    maxTabs: parseInt(maxTabsInput.value, 10) || 10,
    limitScope: limitScopeSelect.value as Settings['limitScope'],
    oldestDefinition: oldestDefinitionSelect.value as Settings['oldestDefinition'],
    excludePinned: excludePinnedCheckbox.checked
  };

  chrome.storage.sync.set({ settings }, () => {
    statusText.style.opacity = '1';
    setTimeout(() => {
      statusText.style.opacity = '0';
    }, 2500);
  });
});
