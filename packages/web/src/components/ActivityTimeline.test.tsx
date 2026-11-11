import type { ShiftEventMessage } from '@staffing/domain';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { worker } from '../test/render';
import { firstMissing, mergeEvents, TIMELINE_LIMIT } from '../lib/useTimeline';
import { ActivityTimeline } from './ActivityTimeline';

const ev = (seq: number, type: ShiftEventMessage['type'], name: string, at: string): ShiftEventMessage => ({
  seq,
  type,
  workerId: name.toLowerCase(),
  row: worker(name.toLowerCase(), name),
  at,
});

const items = () => within(screen.getByTestId('timeline')).getAllByRole('listitem');

describe('ActivityTimeline', () => {
  it('lists events newest first with actor, action, worker and time in the shift timezone', () => {
    render(
      <ActivityTimeline
        timeZone="America/Toronto"
        events={[
          ev(1, 'invite', 'Amara Okafor', '2026-12-12T20:01:00.000Z'),
          ev(2, 'accept', 'Amara Okafor', '2026-12-12T20:05:00.000Z'),
          ev(3, 'decline', 'Liam Chen', '2026-12-12T20:07:00.000Z'),
          ev(4, 'check_in', 'Amara Okafor', '2026-12-12T22:02:00.000Z'),
          ev(5, 'check_out', 'Amara Okafor', '2026-12-13T04:01:00.000Z'),
          ev(6, 'cancel', 'Sofia Rossi', '2026-12-13T04:30:00.000Z'),
        ]}
      />,
    );
    const text = items().map((li) => li.textContent);
    expect(text).toEqual([
      expect.stringMatching(/^11:30\sp\.m\.Sofia Rossi cancelledWorker$/),
      expect.stringMatching(/^11:01\sp\.m\.Amara Okafor checked outWorker$/),
      expect.stringMatching(/^5:02\sp\.m\.Amara Okafor checked inWorker$/),
      expect.stringMatching(/^3:07\sp\.m\.Liam Chen declinedWorker$/),
      expect.stringMatching(/^3:05\sp\.m\.Amara Okafor acceptedWorker$/),
      expect.stringMatching(/^3:01\sp\.m\.Manager invited Amara OkaforManager$/),
    ]);
    expect(within(items()[5]!).getByText(/3:01/).closest('time')).toHaveAttribute(
      'datetime',
      '2026-12-12T20:01:00.000Z',
    );
  });

  it('orders by seq even when given out of order, and says when there is nothing yet', () => {
    const { rerender } = render(<ActivityTimeline timeZone="UTC" events={[]} />);
    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    rerender(
      <ActivityTimeline
        timeZone="UTC"
        events={[
          ev(2, 'accept', 'Ana', '2026-12-12T20:02:00Z'),
          ev(1, 'invite', 'Ana', '2026-12-12T20:01:00Z'),
        ]}
      />,
    );
    expect(items().map((li) => li.textContent)).toEqual([
      expect.stringContaining('Ana accepted'),
      expect.stringContaining('Manager invited Ana'),
    ]);
  });
});

describe('mergeEvents', () => {
  it('dedupes by seq, sorts oldest first and keeps only the newest entries', () => {
    const at = '2026-12-12T20:00:00Z';
    const many = Array.from({ length: TIMELINE_LIMIT + 5 }, (_, i) => ev(i + 1, 'invite', 'Ana', at));
    const merged = mergeEvents(many.slice(0, 10), [...many.slice(5).reverse(), many[0]!]);
    expect(merged).toHaveLength(TIMELINE_LIMIT);
    expect(merged[0]!.seq).toBe(6);
    expect(merged.at(-1)!.seq).toBe(TIMELINE_LIMIT + 5);
  });
});

describe('firstMissing', () => {
  const at = '2026-12-12T20:00:00Z';
  const seqs = (...n: number[]) => n.map((s) => ev(s, 'invite', 'Ana', at));

  it('finds a hole before the newest entry, not only past it', () => {
    expect(firstMissing(seqs(3, 4), 4)).toBe(1); // a live event landed before the first read returned
    expect(firstMissing(seqs(1, 2, 4), 4)).toBe(3);
    expect(firstMissing(seqs(1, 2), 3)).toBe(3);
    expect(firstMissing(seqs(1, 2, 3), 3)).toBeNull();
    expect(firstMissing([], 0)).toBeNull();
  });

  it('only looks at the window the timeline keeps', () => {
    const latest = TIMELINE_LIMIT + 10;
    const window = Array.from({ length: TIMELINE_LIMIT }, (_, i) => latest - i);
    expect(firstMissing(seqs(...window), latest)).toBeNull();
  });
});
