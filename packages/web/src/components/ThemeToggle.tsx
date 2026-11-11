import { useEffect, useState } from 'react';
import {
  applyThemePreference,
  readThemePreference,
  saveThemePreference,
  type ThemePreference,
} from '../lib/theme';

const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** One pill: each click moves System → Light → Dark → System. Remembered when storage allows it. */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>(readThemePreference);
  // index.html applies the stored theme before the first paint; this keeps them in step.
  useEffect(() => applyThemePreference(pref), [pref]);
  const next = NEXT[pref];

  return (
    <button
      type="button"
      aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[next]}.`}
      onClick={() => {
        setPref(next);
        saveThemePreference(next);
      }}
      className="rounded-full bg-secondary px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--secondary-hover)]"
    >
      Theme <span aria-hidden="true">·</span> <span>{LABEL[pref]}</span>
    </button>
  );
}
