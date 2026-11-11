import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type SelectOption = { value: string; label: string };

/**
 * A themed, select-only combobox (WAI-ARIA APG pattern): a pill trigger that keeps focus, and a
 * floating listbox below it. Enter/Space/arrows open it; arrows, Home and End move; Enter or Space
 * chooses; Esc closes; a click outside closes. Focus never leaves the trigger.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  function show(index = selectedIndex >= 0 ? selectedIndex : 0) {
    setActive(index);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }
  function choose(i: number) {
    const o = options[i];
    if (o) onChange(o.value);
    close();
  }

  // A press anywhere outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function onKeyDown(e: KeyboardEvent) {
    const last = options.length - 1;
    const keys: Record<string, () => void> = open
      ? {
          ArrowDown: () => setActive((i) => Math.min(i + 1, last)),
          ArrowUp: () => setActive((i) => Math.max(i - 1, 0)),
          Home: () => setActive(0),
          End: () => setActive(last),
          Enter: () => choose(active),
          ' ': () => choose(active),
          Escape: close,
        }
      : {
          ArrowDown: () => show(),
          ArrowUp: () => show(),
          Enter: () => show(),
          ' ': () => show(),
          Home: () => show(0),
          End: () => show(last),
        };
    if (open && e.key === 'Tab') setOpen(false);
    const run = keys[e.key];
    if (run) {
      e.preventDefault();
      run();
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <span id={labelId} className="mb-2 block text-sm">
        {label}
      </span>
      <div
        ref={triggerRef}
        role="combobox"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-full bg-surface px-4 py-2.5 font-medium text-fg shadow-sm select-none"
      >
        <span className={selected ? '' : 'text-muted'}>{selected ? selected.label : placeholder}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-labelledby={labelId}
        hidden={!open}
        className="absolute inset-x-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-2xl bg-surface p-1.5 text-fg shadow-lg"
      >
        {options.map((o, i) => (
          <li
            key={o.value}
            id={optionId(i)}
            role="option"
            aria-selected={o.value === value}
            // Keep focus on the trigger while clicking an option.
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onPointerEnter={() => setActive(i)}
            onClick={() => choose(i)}
            className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm ${
              i === active ? 'bg-secondary' : ''
            } ${o.value === value ? 'font-medium' : ''}`}
          >
            {o.label}
            {o.value === value && (
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0">
                <path
                  d="M3.5 8.5l3 3 6-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
