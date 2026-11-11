import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeSnapshot } from '../test/render';
import { ShiftDetails } from './ShiftDetails';

const { shift } = makeSnapshot();

describe('ShiftDetails', () => {
  it('is a region named by the shift title, with the time, date, timezone and places', () => {
    render(<ShiftDetails shift={shift} />);
    const card = screen.getByRole('region', { name: 'Winter Gala — Bar & Floor Staff' });
    expect(
      within(card).getByRole('heading', { name: 'Winter Gala — Bar & Floor Staff' }),
    ).toBeInTheDocument();
    expect(within(card).getByTestId('shift-time')).toHaveTextContent(/5:00\sp\.m\..*11:00\sp\.m\./);
    expect(within(card).getByTestId('shift-date')).toHaveTextContent(/Dec(ember)?\s12/);
    expect(within(card).getByTestId('shift-timezone')).toHaveTextContent('America/Toronto');
    expect(within(card).getByText('Places').nextElementSibling).toHaveTextContent('3');
  });

  it('shows a decorative photo that assistive tech never sees', () => {
    const { container } = render(<ShiftDetails shift={shift} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('src', expect.stringMatching(/shift-winter-gala.*\.webp/));
    expect(img!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
