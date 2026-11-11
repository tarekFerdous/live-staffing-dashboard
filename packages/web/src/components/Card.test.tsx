import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';
import { StaffingIcon } from './icons';

describe('Card', () => {
  it('is a region named by its title, with the subtitle, summary, body and footer inside', () => {
    render(
      <Card
        icon={<StaffingIcon />}
        title="Staffing"
        subtitle="Live"
        summary="2 of 3 places filled."
        footer={<button type="button">Invite</button>}
      >
        <p>Body</p>
      </Card>,
    );
    const card = screen.getByRole('region', { name: 'Staffing' });
    expect(within(card).getByRole('heading', { name: 'Staffing' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Staffing•Live');
    expect(within(card).getByText('2 of 3 places filled.')).toBeInTheDocument();
    expect(within(card).getByText('Body')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });

  it('hides its icon from assistive tech', () => {
    const { container } = render(<Card icon={<StaffingIcon />} title="Staffing" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
