import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakeApi';
import { fakeTransport } from '../test/fakeTransport';
import { findWorkerCard, makeSnapshot, pickWorker, renderApp, workerCard } from '../test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const tone = (name: string) => workerCard(name).getAttribute('data-tone');

async function liveManager() {
  const api = fakeApi(makeSnapshot());
  const t = fakeTransport();
  renderApp('/manager', { transport: t.transport });
  await findWorkerCard('Amara Okafor');
  await act(async () => t.last.subscribed());
  /** Applies an action on the "server" and pushes the event live. */
  const live = async (id: string, action: Parameters<typeof api.act>[1]) =>
    act(async () => t.last.send(api.act(id, action)));
  return { live };
}

describe('worker card tints on the manager dashboard', () => {
  it('follow the lifecycle live: default, green, yellow, default', async () => {
    const { live } = await liveManager();
    expect(tone('Amara Okafor')).toBe('none');
    await live('amara', 'invite');
    await vi.waitFor(() => expect(tone('Amara Okafor')).toBe('none'));
    await live('amara', 'accept');
    await vi.waitFor(() => expect(tone('Amara Okafor')).toBe('good'));
    await live('amara', 'check_in');
    await vi.waitFor(() => expect(tone('Amara Okafor')).toBe('warn'));
    await live('amara', 'check_out');
    await vi.waitFor(() => expect(tone('Amara Okafor')).toBe('none'));
  });

  it('turn red on decline and on cancel', async () => {
    const { live } = await liveManager();
    await live('liam', 'invite');
    await live('liam', 'decline');
    await vi.waitFor(() => expect(tone('Liam Chen')).toBe('bad'));

    await live('sofia', 'invite');
    await live('sofia', 'accept');
    await vi.waitFor(() => expect(tone('Sofia Rossi')).toBe('good'));
    await live('sofia', 'cancel');
    await vi.waitFor(() => expect(tone('Sofia Rossi')).toBe('bad'));
  });

  it("never tint the worker's own card on the worker page", async () => {
    fakeApi(
      makeSnapshot([
        { ...makeSnapshot().workers[0]!, participation: 'accepted', attendance: 'checked_in', version: 3 },
      ]),
    );
    renderApp('/worker');
    await pickWorker('Amara Okafor');
    const own = await screen.findByRole('region', { name: 'Amara Okafor, your status' });
    expect(own).not.toHaveAttribute('data-tone');
  });
});
