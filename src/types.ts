export interface Settings {
  maxTabs: number;
  limitScope: 'global' | 'per-window';
  oldestDefinition: 'creation' | 'lru';
  excludePinned: boolean;
}

/** A destination that was blocked because the tab limit was reached. */
export interface BacklogItem {
  url: string;
  time: number;
}
