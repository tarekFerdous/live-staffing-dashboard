import { describe, expect, it } from 'vitest';
import { yTicks } from './ticks';

describe('yTicks', () => {
  it('labels every whole number up to 10', () => {
    expect(yTicks(1)).toEqual([0, 1]);
    expect(yTicks(3)).toEqual([0, 1, 2, 3]);
    expect(yTicks(10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('switches to a readable step above 10, with at most six labels', () => {
    expect(yTicks(20)).toEqual([0, 5, 10, 15, 20]);
    expect(yTicks(12)).toEqual([0, 5, 10]);
    expect(yTicks(23)).toEqual([0, 5, 10, 15, 20]);
    expect(yTicks(250)).toEqual([0, 50, 100, 150, 200, 250]);
    for (const top of [11, 17, 33, 99, 101, 999, 12345]) {
      const ticks = yTicks(top);
      expect(ticks.length, String(top)).toBeLessThanOrEqual(6);
      expect(ticks.length, String(top)).toBeGreaterThanOrEqual(2);
      expect(ticks.at(-1)!, String(top)).toBeLessThanOrEqual(top);
    }
  });
});
