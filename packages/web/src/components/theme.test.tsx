import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '../lib/theme';
import { fakeApi } from '../test/fakeApi';
import { fakeTransport } from '../test/fakeTransport';
import { makeSnapshot, renderApp } from '../test/render';

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

const themeSelect = () => screen.getByRole('combobox', { name: 'Theme' });

describe('theme', () => {
  it('follows the system setting until the user picks one', async () => {
    renderApp('/manager');
    await screen.findByRole('table');
    expect(themeSelect()).toHaveValue('system');
    expect(html.dataset.theme).toBeUndefined();
  });

  it('overrides the system setting and survives a refresh', async () => {
    const first = renderApp('/manager');
    await screen.findByRole('table');
    await userEvent.selectOptions(themeSelect(), 'dark');
    expect(html.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    first.unmount();
    delete html.dataset.theme; // a fresh page load starts without the attribute
    renderApp('/manager');
    await screen.findByRole('table');
    expect(themeSelect()).toHaveValue('dark');
    expect(html.dataset.theme).toBe('dark');

    await userEvent.selectOptions(themeSelect(), 'system');
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
    await screen.findByRole('table');
    expect(themeSelect()).toHaveValue('system');
    await userEvent.selectOptions(themeSelect(), 'light');
    expect(html.dataset.theme).toBe('light');
  });
});

describe('accessibility', () => {
  it('gives every control a name and reaches each of them with the keyboard', async () => {
    const t = fakeTransport();
    renderApp('/manager', { transport: t.transport });
    await screen.findByRole('table');
    await act(async () => t.last.subscribed());
    const controls = [
      ...screen.getAllByRole('link'),
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('switch'),
      ...screen.getAllByRole('combobox'),
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
