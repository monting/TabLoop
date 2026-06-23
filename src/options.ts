import type { Settings, StashItem } from './types.ts';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings.ts';
import { getStash, setStash, STASH_KEY } from './stash.ts';

const maxTabsInput = document.getElementById('maxTabs') as HTMLInputElement;
const limitScopeSelect = document.getElementById('limitScope') as HTMLSelectElement;
const limitBehaviorSelect = document.getElementById('limitBehavior') as HTMLSelectElement;
const oldestDefinitionSelect = document.getElementById('oldestDefinition') as HTMLSelectElement;
const syncStashCheckbox = document.getElementById('syncStash') as HTMLInputElement;
const enableStashCheckbox = document.getElementById('enableStash') as HTMLInputElement;
const excludePinnedCheckbox = document.getElementById('excludePinned') as HTMLInputElement;
const statusContainer = document.getElementById('statusContainer') as HTMLDivElement;
const statusIcon = document.getElementById('statusIcon') as HTMLSpanElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const resurfaceCooldownInput = document.getElementById('resurfaceCooldown') as HTMLInputElement;
const decrementLimitBtn = document.getElementById('decrementLimit') as HTMLButtonElement;
const incrementLimitBtn = document.getElementById('incrementLimit') as HTMLButtonElement;
const decrementCooldownBtn = document.getElementById('decrementCooldown') as HTMLButtonElement;
const incrementCooldownBtn = document.getElementById('incrementCooldown') as HTMLButtonElement;

const skipDomainInput = document.getElementById('skipDomainInput') as HTMLInputElement;
const addSkipDomainBtn = document.getElementById('addSkipDomainBtn') as HTMLButtonElement;
const skipDomainList = document.getElementById('skipDomainList') as HTMLDivElement;
const skipSuggestions = document.getElementById('skipSuggestions') as HTMLDivElement;

const priorityDomainInput = document.getElementById('priorityDomainInput') as HTMLInputElement;
const addPriorityDomainBtn = document.getElementById('addPriorityDomainBtn') as HTMLButtonElement;
const priorityDomainList = document.getElementById('priorityDomainList') as HTMLDivElement;
const prioritySuggestions = document.getElementById('prioritySuggestions') as HTMLDivElement;

let skipDomains: string[] = [];
let priorityDomains: string[] = [];

function getFavicon(item: string): string {
  const isDomain = item.includes('.') && !item.includes(' ');
  if (isDomain) {
    let clean = item.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'https://' + clean;
    }
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', clean);
    url.searchParams.set('size', '32');
    return url.toString();
  }
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
}

function renderDomainList(listEl: HTMLDivElement, domains: string[], onRemove: (index: number) => void) {
  listEl.innerHTML = '';
  if (domains.length === 0) {
    listEl.innerHTML = '<div style="font-size: 13px; color: rgba(255,255,255,0.3); padding: 8px;">No domains added yet.</div>';
    return;
  }
  domains.forEach((item, index) => {
    const entry = document.createElement('div');
    entry.className = 'domain-entry';

    const info = document.createElement('div');
    info.className = 'domain-info';

    const img = document.createElement('img');
    img.className = 'domain-favicon';
    img.src = getFavicon(item);
    img.alt = '';
    img.onerror = () => {
      img.src = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    };

    const text = document.createElement('span');
    text.textContent = item;

    info.appendChild(img);
    info.appendChild(text);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'domain-remove';
    removeBtn.type = 'button';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', () => onRemove(index));

    entry.appendChild(info);
    entry.appendChild(removeBtn);
    listEl.appendChild(entry);
  });
}

async function updateSuggestions(
  skipPillsEl: HTMLDivElement,
  priorityPillsEl: HTMLDivElement,
  currentSkip: string[],
  currentPriority: string[],
  onAddSkip: (domain: string) => void,
  onAddPriority: (domain: string) => void
) {
  let domainsList: string[] = [];
  try {
    const tabs = await chrome.tabs.query({});
    const activeDomains = new Set<string>();
    for (const tab of tabs) {
      if (tab.url) {
        try {
          const url = new URL(tab.url);
          if (url.protocol.startsWith('http')) {
            const domain = url.hostname.replace(/^www\./i, '');
            if (domain) {
              activeDomains.add(domain);
            }
          }
        } catch {}
      }
    }
    domainsList = Array.from(activeDomains).sort();
  } catch (e) {
    console.warn("Could not query active tabs for suggestions:", e);
  }

  const renderPills = (
    container: HTMLDivElement,
    currentList: string[],
    onAdd: (d: string) => void
  ) => {
    container.innerHTML = '';
    const candidates = domainsList.filter(d => !currentList.includes(d));
    if (candidates.length === 0) {
      container.innerHTML = '<span style="font-size: 12px; color: rgba(255,255,255,0.3);">No suggestions available (already added or no active tabs).</span>';
      return;
    }

    candidates.forEach(d => {
      const pill = document.createElement('span');
      pill.className = 'pill';
      
      const img = document.createElement('img');
      img.className = 'domain-favicon';
      img.src = getFavicon(d);
      img.alt = '';
      img.onerror = () => {
        img.src = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
      };

      const text = document.createTextNode(`${d} +`);

      pill.appendChild(img);
      pill.appendChild(text);

      pill.addEventListener('click', () => onAdd(d));
      container.appendChild(pill);
    });
  };

  renderPills(skipPillsEl, currentSkip, onAddSkip);
  renderPills(priorityPillsEl, currentPriority, onAddPriority);
}

function renderAll() {
  renderDomainList(skipDomainList, skipDomains, (idx) => {
    skipDomains.splice(idx, 1);
    renderAll();
    triggerSave();
  });
  renderDomainList(priorityDomainList, priorityDomains, (idx) => {
    priorityDomains.splice(idx, 1);
    renderAll();
    triggerSave();
  });
  void updateSuggestions(
    skipSuggestions,
    prioritySuggestions,
    skipDomains,
    priorityDomains,
    (d) => {
      skipDomains.push(d);
      renderAll();
      triggerSave();
    },
    (d) => {
      priorityDomains.push(d);
      renderAll();
      triggerSave();
    }
  );
}

addSkipDomainBtn.addEventListener('click', () => {
  const domain = skipDomainInput.value.trim();
  if (domain && !skipDomains.includes(domain)) {
    skipDomains.push(domain);
    skipDomainInput.value = '';
    renderAll();
    triggerSave();
  }
});
skipDomainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addSkipDomainBtn.click();
  }
});

addPriorityDomainBtn.addEventListener('click', () => {
  const item = priorityDomainInput.value.trim();
  if (item && !priorityDomains.includes(item)) {
    priorityDomains.push(item);
    priorityDomainInput.value = '';
    renderAll();
    triggerSave();
  }
});
priorityDomainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addPriorityDomainBtn.click();
  }
});

decrementLimitBtn.addEventListener('click', () => {
  const current = parseInt(maxTabsInput.value, 10) || 10;
  maxTabsInput.value = Math.max(1, current - 1).toString();
  triggerSave();
});

incrementLimitBtn.addEventListener('click', () => {
  const current = parseInt(maxTabsInput.value, 10) || 10;
  maxTabsInput.value = Math.min(500, current + 1).toString();
  triggerSave();
});

decrementCooldownBtn.addEventListener('click', () => {
  const current = parseInt(resurfaceCooldownInput.value, 10) || 0;
  resurfaceCooldownInput.value = Math.max(0, current - 1).toString();
  triggerSave();
});

incrementCooldownBtn.addEventListener('click', () => {
  const current = parseInt(resurfaceCooldownInput.value, 10) || 0;
  resurfaceCooldownInput.value = Math.min(1440, current + 1).toString();
  triggerSave();
});

// Restore saved settings.
void loadSettings().then((settings) => {
  maxTabsInput.value = settings.maxTabs.toString();
  limitScopeSelect.value = settings.limitScope;
  limitBehaviorSelect.value = settings.limitBehavior || 'focus';
  oldestDefinitionSelect.value = settings.oldestDefinition;
  enableStashCheckbox.checked = !!settings.enableStash;
  syncStashCheckbox.checked = !!settings.syncStash;
  syncStashCheckbox.disabled = !settings.enableStash;
  excludePinnedCheckbox.checked = settings.excludePinned;
  resurfaceCooldownInput.value = settings.resurfaceCooldown.toString();
  skipDomains = settings.skipResurfaceDomains || [];
  priorityDomains = settings.priorityResurfaceDomains || [];
  renderAll();
});

function readMaxTabs(): number {
  const parsed = parseInt(maxTabsInput.value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.maxTabs;
  return Math.min(500, Math.max(1, parsed));
}

function readResurfaceCooldown(): number {
  const parsed = parseInt(resurfaceCooldownInput.value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.resurfaceCooldown;
  return Math.min(1440, Math.max(0, parsed));
}

let hideTimer: ReturnType<typeof setTimeout> | undefined;

function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function showSavingStatus() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
  statusContainer.className = 'visible saving';
  statusIcon.innerHTML = `
    <svg class="spinner" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="2" x2="12" y2="6"></line>
      <line x1="12" y1="18" x2="12" y2="22"></line>
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
      <line x1="2" y1="12" x2="6" y2="12"></line>
      <line x1="18" y1="12" x2="22" y2="12"></line>
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
    </svg>
  `;
  statusText.textContent = 'Saving...';
}

async function saveCurrentSettings() {
  const oldSettings = await loadSettings();
  const newSyncStash = syncStashCheckbox.checked;

  const settings: Settings = {
    maxTabs: readMaxTabs(),
    limitScope: limitScopeSelect.value as Settings['limitScope'],
    limitBehavior: limitBehaviorSelect.value as Settings['limitBehavior'],
    oldestDefinition: oldestDefinitionSelect.value as Settings['oldestDefinition'],
    excludePinned: excludePinnedCheckbox.checked,
    enableStash: enableStashCheckbox.checked,
    syncStash: newSyncStash,
    skipResurfaceDomains: skipDomains,
    priorityResurfaceDomains: priorityDomains,
    resurfaceCooldown: readResurfaceCooldown(),
  };

  // Clamp input values back to field limits if focus is lost or if changed by adjust buttons.
  if (document.activeElement !== maxTabsInput) {
    maxTabsInput.value = settings.maxTabs.toString();
  }
  if (document.activeElement !== resurfaceCooldownInput) {
    resurfaceCooldownInput.value = settings.resurfaceCooldown.toString();
  }

  if (oldSettings.syncStash !== newSyncStash) {
    const itemsToMigrate = await getStash();
    await saveSettings(settings);
    const existingItems = await getStash();
    const merged = new Map<string, StashItem>();
    for (const item of [...existingItems, ...itemsToMigrate]) {
      const existing = merged.get(item.url);
      if (!existing || item.time > existing.time) {
        merged.set(item.url, item);
      }
    }
    const mergedItems = Array.from(merged.values())
      .sort((a, b) => b.time - a.time);

    await setStash(mergedItems);

    const oldStorage = oldSettings.syncStash ? chrome.storage.sync : chrome.storage.local;
    await oldStorage.remove(STASH_KEY);
  } else {
    await saveSettings(settings);
  }

  statusContainer.className = 'visible saved';
  statusIcon.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `;
  statusText.textContent = 'Settings saved automatically!';

  hideTimer = setTimeout(() => {
    statusContainer.classList.remove('visible');
  }, 2000);
}

const debouncedSave = debounce(saveCurrentSettings, 300);

function triggerSave() {
  showSavingStatus();
  debouncedSave();
}

// Add event listeners for inputs
maxTabsInput.addEventListener('input', triggerSave);
resurfaceCooldownInput.addEventListener('input', triggerSave);
limitScopeSelect.addEventListener('change', triggerSave);
limitBehaviorSelect.addEventListener('change', triggerSave);
oldestDefinitionSelect.addEventListener('change', triggerSave);
enableStashCheckbox.addEventListener('change', () => {
  syncStashCheckbox.disabled = !enableStashCheckbox.checked;
  triggerSave();
});
syncStashCheckbox.addEventListener('change', triggerSave);
excludePinnedCheckbox.addEventListener('change', triggerSave);
