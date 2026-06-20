export interface Settings {
  maxTabs: number;
  limitScope: 'global' | 'per-window';
  oldestDefinition: 'creation' | 'lru';
  excludePinned: boolean;
  excludeIncognito: boolean;
}

/** A page saved to the Stash — parked to free a slot, or blocked at the limit. */
export interface StashItem {
  url: string;
  title?: string;
  time: number;
}
