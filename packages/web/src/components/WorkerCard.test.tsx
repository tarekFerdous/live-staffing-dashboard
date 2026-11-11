import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { worker } from '../test/render';
import { WorkerCard } from './WorkerCard';

const header = (name: string) =>
  screen.getByRole('heading', { name: new RegExp(`^${name}`) }).closest('header')!;

describe('WorkerCard header photo', () => {
  it.each([
    ['amara', 'Amara Okafor'],
    ['liam', 'Liam Chen'],
    ['sofia', 'Sofia Rossi'],
  ])("shows %s's own round, decorative photo instead of the person icon", (id, name) => {
    render(<WorkerCard worker={worker(id, name)} timeZone="America/Toronto" />);
    const img = header(name).querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('src', expect.stringMatching(new RegExp(`${id}.*\\.webp`)));
    expect(img).toHaveClass('rounded-full', 'object-cover');
    expect(header(name).querySelector('svg')).toBeNull();
    // Decorative: nothing for assistive tech to announce twice.
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('gives each worker a different photo', () => {
    const srcs = ['amara', 'liam', 'sofia'].map((id) => {
      const { container, unmount } = render(<WorkerCard worker={worker(id, id)} timeZone="UTC" />);
      const src = container.querySelector('header img')!.getAttribute('src');
      unmount();
      return src;
    });
    expect(new Set(srcs).size).toBe(3);
  });

  it('falls back to the person icon for a worker without a photo', () => {
    render(<WorkerCard worker={worker('ghost', 'Gus Ghost')} timeZone="UTC" />);
    expect(header('Gus Ghost').querySelector('img')).toBeNull();
    expect(header('Gus Ghost').querySelector('svg')).not.toBeNull();
  });
});
