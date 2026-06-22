export interface Settings {
  maxTabs: number;
  limitScope: 'global' | 'per-window';
  limitBehavior: 'move' | 'focus';
  oldestDefinition: 'creation' | 'lru';
  excludePinned: boolean;
  syncStash: boolean;
  skipResurfaceDomains: string[];
  priorityResurfaceDomains: string[];
  resurfaceCooldown: number;
}

/** A page saved to the Stash — parked to free a slot, or blocked at the limit. */
export interface StashItem {
  url: string;
  title?: string;
  time: number;
}
