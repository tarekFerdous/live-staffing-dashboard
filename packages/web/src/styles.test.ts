// @vitest-environment node
// The stylesheet's contract: every token used is defined, light and dark define the same tokens,
// the violet accent is gone, and fonts come from the bundle, never from Google.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

/** Each custom property's value inside the block that starts at `selector`. */
function values(selector: string): Map<string, string> {
  const open = css.indexOf('{', css.indexOf(selector));
  const body = css.slice(open, css.indexOf('}', open)).replace(/\/\*[\s\S]*?\*\//g, '');
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('dark palette (Hark dusk)', () => {
  const dark = values(":root[data-theme='dark']");
  const hex = (token: string) => {
    const v = dark.get(token);
    expect(v, token).toMatch(/^#[0-9a-f]{6}$/i);
    return v!;
  };

  it('has a mid-tone backdrop, not near-black', () => {
    for (const t of ['--bg-from', '--bg-to', '--bg']) {
      expect(luminance(hex(t)), t).toBeGreaterThan(0.06);
      expect(luminance(hex(t)), t).toBeLessThan(0.3);
    }
  });

  it('draws cards as translucent glass, darker than the backdrop', () => {
    expect(dark.get('--card')).toMatch(/^rgb\(\d+ \d+ \d+ \/ 0\.\d+\)$/);
    const [r, g, b] = dark.get('--card')!.match(/\d+/g)!.map(Number);
    const card = `#${[r, g, b].map((c) => c!.toString(16).padStart(2, '0')).join('')}`;
    for (const c of [card, hex('--card-solid')]) expect(luminance(c)).toBeLessThan(luminance(hex('--bg-to')));
  });

  it('keeps text at WCAG AA (4.5:1)', () => {
    const pairs: [string, string][] = [
      ['--fg', '--card-solid'],
      ['--muted', '--card-solid'],
      ['--fg', '--surface'],
      ['--muted', '--surface'],
      ['--bad-fg', '--card-solid'],
      ['--fg', '--bg-from'],
      ['--muted-on-bg', '--bg-from'],
      ['--primary-fg', '--primary'],
      ['--bad-solid-fg', '--bad'],
      ['--warn-fg', '--warn-bg'],
      ['--toast-fg', '--toast-bg'],
      ['--toast-fg', '--toast-error-bg'],
    ];
    for (const [fg, bg] of pairs)
      expect(contrast(hex(fg), hex(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the Live dot and the reconnecting amber apart', () => {
    const [live, warn] = [hex('--live'), hex('--warn')];
    const hue = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [
        number,
        number,
        number,
      ];
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      const deg = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (deg * 60 + 360) % 360;
    };
    expect(Math.abs(hue(live) - hue(warn))).toBeGreaterThan(60);
  });
});

/** HSL hue (degrees) and saturation (0–1) of a `#rrggbb` colour. */
function hsl(hex: string): { hue: number; sat: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  const deg = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const l = (max + min) / 2;
  return { hue: (deg * 60 + 360) % 360, sat: d / (1 - Math.abs(2 * l - 1)) };
}

describe('light palette (Hark day)', () => {
  const light = values(':root {');
  const hex = (token: string) => {
    const v = light.get(token);
    expect(v, token).toMatch(/^#[0-9a-f]{6}$/i);
    return v!;
  };

  it('has a light backdrop', () => {
    for (const t of ['--bg-from', '--bg-to', '--bg']) expect(luminance(hex(t)), t).toBeGreaterThan(0.6);
  });

  it('tints the backdrop, text and primary toward periwinkle, not neutral grey', () => {
    for (const t of [
      '--bg-from',
      '--bg-to',
      '--bg',
      '--fg',
      '--muted',
      '--primary',
      '--focus',
      '--toast-bg',
    ]) {
      const { hue, sat } = hsl(hex(t));
      expect(hue, t).toBeGreaterThanOrEqual(220);
      expect(hue, t).toBeLessThanOrEqual(255);
      expect(sat, t).toBeGreaterThan(0.12);
    }
  });

  it('has no neutral near-black ink left', () => {
    for (const [t, v] of light) {
      expect(v.toLowerCase(), t).not.toMatch(/#0f1115|#000000\b|#000\b|rgb\(15 23 42/);
      if (/^#[0-9a-f]{6}$/i.test(v) && luminance(v) < 0.06) expect(hsl(v).sat, t).toBeGreaterThan(0.12);
    }
  });

  it('keeps text at WCAG AA (4.5:1)', () => {
    const pairs: [string, string][] = [
      ['--fg', '--card-solid'],
      ['--muted', '--card-solid'],
      ['--fg', '--bg-from'],
      ['--fg', '--bg-to'],
      ['--muted-on-bg', '--bg-to'],
      ['--primary-fg', '--primary'],
      ['--toast-fg', '--toast-bg'],
      ['--toast-fg', '--toast-error-bg'],
      ['--bad-fg', '--card-solid'],
      ['--warn-fg', '--warn-bg'],
    ];
    for (const [fg, bg] of pairs)
      expect(contrast(hex(fg), hex(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});

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

  it('gives both dark sets identical values', () => {
    expect(values(":root:not([data-theme='light'])")).toEqual(values(":root[data-theme='dark']"));
  });

  it('has no violet accent left', () => {
    expect(css).not.toMatch(/--accent/);
    expect(css.toLowerCase()).not.toMatch(/#6d28d9|#7c3aed|#a78bfa|#5b21b6|#c4b5fd/);
  });

  it('turns transitions off for reduced motion and has a solid fallback without backdrop blur', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0s/);
    expect(css).toMatch(/@supports not \(\(backdrop-filter[\s\S]*var\(--card-solid\)/);
  });

  it('fades a card status tint in about 300 ms (which reduced motion turns off)', () => {
    expect(css).toMatch(/\.card\[data-tone\] \{[^}]*transition: box-shadow 300ms/);
    for (const tone of ['good', 'bad', 'warn']) {
      expect(css).toMatch(
        new RegExp(
          `\\.card\\[data-tone='${tone}'\\] \\{[^}]*var\\(--${tone}-tint\\)[^}]*var\\(--${tone}-ring\\)`,
        ),
      );
    }
  });
});

describe('font', () => {
  it('bundles Geist instead of requesting it from Google', () => {
    const main = read('./main.tsx');
    expect(main).toContain("import '@fontsource-variable/geist'");
    expect(main).not.toMatch(/inter/i);
    const pkg = JSON.parse(read('../package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies).toHaveProperty('@fontsource-variable/geist');
    expect(Object.keys(pkg.dependencies).join()).not.toMatch(/inter/i);
    for (const file of [css, read('../index.html')])
      expect(file).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('puts Geist first in the sans token, then the system fallback stack', () => {
    const token = /--font-sans:\s*([^;]+);/
      .exec(css)?.[1]
      ?.split(',')
      .map((s) => s.trim());
    expect(token?.[0]).toBe("'Geist Variable'");
    expect(token?.slice(1, 3)).toEqual(['ui-sans-serif', 'system-ui']);
    expect(token?.at(-1)).toBe('sans-serif');
    expect(css).not.toMatch(/Inter/);
  });

  it("drops Inter's alternate glyphs", () => {
    expect(css).not.toMatch(/font-feature-settings|cv11|ss01/);
  });
});

describe('font weights', () => {
  // Every stylesheet and component (tests aside): only Regular (400) and Medium (500) are used.
  const sources = readdirSync(fileURLToPath(new URL('.', import.meta.url)), { recursive: true })
    .map(String)
    .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$|[\\/]test[\\/]/.test(f))
    .map((f) => [f, read(`./${f.replace(/\\/g, '/')}`)] as const);

  it('reads the web source', () => {
    expect(sources.map(([f]) => f.replace(/\\/g, '/'))).toEqual(
      expect.arrayContaining(['index.css', 'components/Card.tsx']),
    );
  });

  it('has no semibold or bold anywhere', () => {
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/\bfont-(semibold|bold|extrabold|black)\b/);
      expect(text, file).not.toMatch(/font-weight:\s*(6|7|8|9)00|font-weight:\s*bold|fontWeight/);
    }
  });

  it('gives the shared button and pill classes Medium', () => {
    for (const cls of ['.btn', '.pill']) expect(css).toMatch(new RegExp(`\\${cls} \\{[^}]*font-weight: 500`));
  });
});
