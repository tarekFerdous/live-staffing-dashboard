import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';

const OPTIONS = [
  { value: 'a', label: 'Amara' },
  { value: 'l', label: 'Liam' },
  { value: 's', label: 'Sofia' },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Select
        label="Who are you?"
        placeholder="Choose your name…"
        value={value}
        options={OPTIONS}
        onChange={setValue}
      />
      <button type="button">Outside</button>
    </>
  );
}

const trigger = () => screen.getByRole('combobox', { name: 'Who are you?' });
const listbox = () => screen.queryByRole('listbox');
const activeOption = () => document.getElementById(trigger().getAttribute('aria-activedescendant') ?? '');

describe('Select', () => {
  it('shows the placeholder until a choice is made', () => {
    render(<Harness />);
    expect(trigger()).toHaveTextContent('Choose your name…');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(listbox()).toBeNull();
  });

  it('opens on click, chooses with a click and returns focus to the trigger', async () => {
    render(<Harness />);
    await userEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Amara', 'Liam', 'Sofia']);
    await userEvent.click(screen.getByRole('option', { name: 'Liam' }));
    expect(trigger()).toHaveTextContent('Liam');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveFocus();

    await userEvent.click(trigger());
    expect(screen.getByRole('option', { name: 'Liam' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Amara' })).toHaveAttribute('aria-selected', 'false');
  });

  it.each(['{Enter}', ' ', '{ArrowDown}'])('opens with %s from the keyboard', async (key) => {
    render(<Harness />);
    trigger().focus();
    await userEvent.keyboard(key);
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(activeOption()).toHaveTextContent('Amara');
  });

  it('moves with arrows, Home and End, chooses with Enter', async () => {
    render(<Harness initial="l" />);
    trigger().focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(activeOption()).toHaveTextContent('Liam'); // starts on the current choice
    await userEvent.keyboard('{ArrowDown}');
    expect(activeOption()).toHaveTextContent('Sofia');
    await userEvent.keyboard('{ArrowDown}');
    expect(activeOption()).toHaveTextContent('Sofia'); // stays at the end
    await userEvent.keyboard('{Home}');
    expect(activeOption()).toHaveTextContent('Amara');
    await userEvent.keyboard('{End}');
    expect(activeOption()).toHaveTextContent('Sofia');
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(trigger()).toHaveTextContent('Liam');
    expect(listbox()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('Esc closes without changing the choice', async () => {
    render(<Harness initial="a" />);
    trigger().focus();
    await userEvent.keyboard('{Enter}{ArrowDown}{Escape}');
    expect(listbox()).toBeNull();
    expect(trigger()).toHaveTextContent('Amara');
    expect(trigger()).toHaveFocus();
  });

  it('a click outside closes the menu', async () => {
    render(<Harness />);
    await userEvent.click(trigger());
    expect(listbox()).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Outside' }));
    expect(listbox()).toBeNull();
    expect(trigger()).toHaveTextContent('Choose your name…');
  });
});
