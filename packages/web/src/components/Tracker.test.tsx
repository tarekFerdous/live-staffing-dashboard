import type { Attendance, Participation } from '@staffing/domain';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tracker } from './Tracker';

const show = (participation: Participation, attendance: Attendance = 'not_started') =>
  render(<Tracker worker={{ participation, attendance }} />);
const fill = () => screen.getByTestId('tracker-fill');
const knob = () => screen.queryByTestId('tracker-knob');

describe('Tracker', () => {
  it('has no fill and no knob before an invite', () => {
    show('uninvited');
    expect(screen.queryByTestId('tracker-fill')).toBeNull();
    expect(knob()).toBeNull();
  });

  it.each([
    ['invited', 'not_started', '12.5%'],
    ['accepted', 'not_started', '37.5%'],
    ['accepted', 'checked_in', '62.5%'],
    ['accepted', 'checked_out', '100%'],
  ] as const)('%s + %s: fills to %s and always shows a primary knob there', (p, a, width) => {
    show(p, a);
    expect(fill()).toHaveStyle({ width });
    expect(knob()).not.toBeNull();
    expect(knob()).not.toHaveAttribute('data-stopped');
    // Sits at the fill's end (kept inside the bar: checked in the e2e layout spec).
    expect(knob()).toHaveAttribute('data-at', width.replace('%', ''));
  });

  it.each(['declined', 'cancelled'] as const)('%s: stops at the Accepted step with a red knob', (p) => {
    show(p);
    expect(fill()).toHaveStyle({ width: '37.5%' });
    expect(knob()).toHaveAttribute('data-stopped', 'true');
    expect(knob()!.className).toContain('bg-bad');
  });

  it('keeps the step labels hidden from assistive tech and the text readable', () => {
    show('accepted', 'checked_in');
    expect(screen.getByTestId('tracker')).toHaveTextContent('Step 3 of 4: Checked in');
    expect(screen.queryByRole('list')).toBeNull();
  });
});
