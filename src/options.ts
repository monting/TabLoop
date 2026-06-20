import type { Settings } from './types';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

const maxTabsInput = document.getElementById('maxTabs') as HTMLInputElement;
const limitScopeSelect = document.getElementById('limitScope') as HTMLSelectElement;
const oldestDefinitionSelect = document.getElementById('oldestDefinition') as HTMLSelectElement;
const excludePinnedCheckbox = document.getElementById('excludePinned') as HTMLInputElement;
const excludeIncognitoCheckbox = document.getElementById('excludeIncognito') as HTMLInputElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const statusText = document.getElementById('status') as HTMLSpanElement;

// Restore saved settings.
void loadSettings().then((settings) => {
  maxTabsInput.value = settings.maxTabs.toString();
  limitScopeSelect.value = settings.limitScope;
  oldestDefinitionSelect.value = settings.oldestDefinition;
  excludePinnedCheckbox.checked = settings.excludePinned;
  excludeIncognitoCheckbox.checked = settings.excludeIncognito;
});

function readMaxTabs(): number {
  const parsed = parseInt(maxTabsInput.value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.maxTabs;
  return Math.min(500, Math.max(1, parsed));
}

saveBtn.addEventListener('click', async () => {
  const settings: Settings = {
    maxTabs: readMaxTabs(),
    limitScope: limitScopeSelect.value as Settings['limitScope'],
    oldestDefinition: oldestDefinitionSelect.value as Settings['oldestDefinition'],
    excludePinned: excludePinnedCheckbox.checked,
    excludeIncognito: excludeIncognitoCheckbox.checked,
  };
  // Reflect any clamping back to the field.
  maxTabsInput.value = settings.maxTabs.toString();

  await saveSettings(settings);
  statusText.style.opacity = '1';
  setTimeout(() => {
    statusText.style.opacity = '0';
  }, 2500);
});
