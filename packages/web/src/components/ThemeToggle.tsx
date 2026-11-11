import { useEffect, useState } from 'react';
import {
  applyThemePreference,
  readThemePreference,
  saveThemePreference,
  type ThemePreference,
} from '../lib/theme';

/** System / Light / Dark. The choice is remembered when storage allows it. */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>(readThemePreference);
  // index.html applies the stored theme before the first paint; this keeps them in step.
  useEffect(() => applyThemePreference(pref), [pref]);

  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <span>Theme</span>
      <select
        value={pref}
        onChange={(e) => {
          const next = e.target.value as ThemePreference;
          setPref(next);
          saveThemePreference(next);
        }}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-fg"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
