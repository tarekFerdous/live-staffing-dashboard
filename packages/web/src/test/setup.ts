import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// jsdom has <dialog> but not its modal behaviour. Enough of it for the tests: showModal/close
// toggle `open`, close fires `close`, and Escape fires a cancelable `cancel` and then closes.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  const opener = new WeakMap<HTMLDialogElement, Element | null>();
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    opener.set(this, document.activeElement);
    this.setAttribute('open', '');
    (this.querySelector<HTMLElement>('[autofocus]') ?? this).focus();
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement, value?: string) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    if (value !== undefined) this.returnValue = value;
    (opener.get(this) as HTMLElement | null)?.focus?.();
    this.dispatchEvent(new Event('close'));
  };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (!dialog) return;
    if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
  });
}
