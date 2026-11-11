import { readStorage, writeStorage } from './storage';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'live-staffing.theme';

/** The stored choice, or `system` when there is none (or storage is unavailable). */
export function readThemePreference(): ThemePreference {
  const v = readStorage(THEME_STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** `system` removes the override, so the stylesheet follows prefers-color-scheme. */
export function applyThemePreference(pref: ThemePreference, root: HTMLElement = document.documentElement) {
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function saveThemePreference(pref: ThemePreference) {
  applyThemePreference(pref);
  writeStorage(THEME_STORAGE_KEY, pref);
}
