import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '../lib/theme';
import { fakeApi } from '../test/fakeApi';
import { fakeTransport } from '../test/fakeTransport';
import { makeSnapshot, renderApp, findWorkerCard } from '../test/render';

const html = document.documentElement;

beforeEach(() => {
  fakeApi(makeSnapshot());
  localStorage.clear();
  delete html.dataset.theme;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const themeButton = () => screen.getByRole('button', { name: /^Theme:/ });

describe('theme', () => {
  it('follows the system setting until the user picks one', async () => {
    renderApp('/manager');
    await findWorkerCard('Amara Okafor');
    expect(themeButton()).toHaveAccessibleName('Theme: System. Switch to Light.');
    expect(themeButton()).toHaveTextContent('Theme · System');
    expect(html.dataset.theme).toBeUndefined();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('cycles System → Light → Dark → System, applying and saving each', async () => {
    renderApp('/manager');
    await findWorkerCard('Amara Okafor');
    const steps = [
      ['light', 'Theme: Light. Switch to Dark.'],
      ['dark', 'Theme: Dark. Switch to System.'],
      ['system', 'Theme: System. Switch to Light.'],
    ] as const;
    for (const [pref, name] of steps) {
      await userEvent.click(themeButton());
      expect(themeButton()).toHaveAccessibleName(name);
      expect(html.dataset.theme).toBe(pref === 'system' ? undefined : pref);
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(pref);
    }
  });

  it('works from the keyboard', async () => {
    renderApp('/manager');
    await findWorkerCard('Amara Okafor');
    themeButton().focus();
    await userEvent.keyboard('{Enter}');
    expect(html.dataset.theme).toBe('light');
    await userEvent.keyboard(' ');
    expect(html.dataset.theme).toBe('dark');
  });

  it('overrides the system setting and survives a refresh', async () => {
    const first = renderApp('/manager');
    await findWorkerCard('Amara Okafor');
    await userEvent.click(themeButton());
    await userEvent.click(themeButton());
    expect(html.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    first.unmount();
    delete html.dataset.theme; // a fresh page load starts without the attribute
    renderApp('/manager');
    await findWorkerCard('Amara Okafor');
    expect(themeButton()).toHaveAccessibleName('Theme: Dark. Switch to System.');
    expect(html.dataset.theme).toBe('dark');

    await userEvent.click(themeButton());
    expect(html.dataset.theme).toBeUndefined();
  });

  it('still switches when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    renderApp('/manager');
    await findWorkerCard('Amara Okafor');
    expect(themeButton()).toHaveAccessibleName('Theme: System. Switch to Light.');
    await userEvent.click(themeButton());
    expect(html.dataset.theme).toBe('light');
  });
});

describe('accessibility', () => {
  it('gives every control a name and reaches each of them with the keyboard', async () => {
    const t = fakeTransport();
    renderApp('/manager', { transport: t.transport });
    await findWorkerCard('Amara Okafor');
    await act(async () => t.last.subscribed());
    const controls = [
      ...screen.getAllByRole('link'),
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('switch'),
      ...screen.queryAllByRole('combobox'),
    ];
    for (const c of controls) expect(c).toHaveAccessibleName();

    const reached = new Set<Element>();
    for (let i = 0; i < controls.length + 5; i++) {
      await userEvent.tab();
      if (document.activeElement) reached.add(document.activeElement);
    }
    for (const c of controls) expect(reached.has(c), c.outerHTML).toBe(true);
  });
});
