// The stylesheet's contract: every token used is defined, light and dark define the same tokens,
// the violet accent is gone, and fonts come from the bundle, never from Google.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./index.css');

/** The custom properties declared directly inside the block that starts at `selector`. */
function declared(selector: string): Set<string> {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return new Set([...css.slice(open, close).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
}

describe('design tokens', () => {
  const light = declared(':root {');
  const systemDark = declared(":root:not([data-theme='light'])");
  const forcedDark = declared(":root[data-theme='dark']");

  it('defines every token it uses (light set)', () => {
    const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
    const tailwind = new Set([...css.matchAll(/(--(?:color|font)-[\w-]+)\s*:/g)].map((m) => m[1]!));
    // `--dot` is set per pill variant with a fallback.
    for (const t of used) if (t !== '--dot' && !tailwind.has(t)) expect(light, t).toContain(t);
  });

  it('gives both dark sets exactly the colour tokens of the light set', () => {
    const themed = [...light].filter((t) => !['--card-radius', '--card-blur'].includes(t)).sort();
    expect([...systemDark].sort()).toEqual(themed);
    expect([...forcedDark].sort()).toEqual(themed);
  });

  it('has no violet accent left', () => {
    expect(css).not.toMatch(/--accent/);
    expect(css.toLowerCase()).not.toMatch(/#6d28d9|#7c3aed|#a78bfa|#5b21b6|#c4b5fd/);
  });

  it('turns transitions off for reduced motion and has a solid fallback without backdrop blur', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0s/);
    expect(css).toMatch(/@supports not \(\(backdrop-filter[\s\S]*var\(--card-solid\)/);
  });
});

describe('font', () => {
  it('bundles Inter instead of requesting it from Google', () => {
    expect(read('./main.tsx')).toContain("import '@fontsource-variable/inter'");
    expect(css).toContain("'Inter Variable'");
    for (const file of [css, read('../index.html')])
      expect(file).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});
