export interface Settings {
  maxTabs: number;
  limitScope: 'global' | 'per-window';
  oldestDefinition: 'creation' | 'lru';
  excludePinned: boolean;
}
