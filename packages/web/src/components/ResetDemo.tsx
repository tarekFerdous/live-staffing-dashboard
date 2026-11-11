import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { resetDemo, SHIFT_ID } from '../lib/api';
import { useLive } from '../lib/live';
import { snapshotKey } from '../lib/useSnapshot';
import { useToast } from './Toast';

export const RESET_WARNING =
  'This puts the shift back to its starting state: all three workers become Uninvited and Not started, ' +
  'every invitation, check-in and check-out is cleared, and the activity history is deleted. ' +
  'Everyone with the page open will see the reset. This can’t be undone.';

/**
 * "Reset demo" in the manager's header, with a confirmation modal on the native <dialog>.
 * The reset itself reaches this page the same way it reaches every other open page: through
 * the new epoch on the live channel (no separate refresh here).
 */
export function ResetDemo() {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const live = useLive();
  const toast = useToast();
  const queryClient = useQueryClient();

  function open() {
    setError(null);
    dialog.current?.showModal();
    // Cancel has the default focus, so Enter by reflex never resets. (React's autoFocus
    // focuses on mount, not when the dialog opens, so this is done here.)
    cancel.current?.focus();
  }

  function close() {
    if (inFlight.current) return;
    dialog.current?.close();
  }

  async function confirm() {
    if (inFlight.current) return; // a double click sends one request
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await resetDemo();
      inFlight.current = false;
      setBusy(false);
      dialog.current?.close();
      live.setOutage(false);
      // Without a live channel there is no reset message to wait for: read the snapshot again.
      if (!live.enabled) await queryClient.invalidateQueries({ queryKey: snapshotKey(SHIFT_ID) });
      toast.show('Demo reset', 'info');
    } catch (err) {
      inFlight.current = false;
      setBusy(false);
      setError(err instanceof Error ? err.message : 'The reset failed. Please try again.');
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={open}
        className="rounded-full bg-secondary px-3 py-1 text-xs font-medium hover:bg-[var(--secondary-hover)]"
      >
        Reset demo
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="card m-auto w-[calc(100%-2rem)] max-w-md p-6 text-fg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
        // Escape: not while the request runs.
        onCancel={(e) => {
          if (inFlight.current) e.preventDefault();
        }}
        onClose={() => {
          setError(null);
          trigger.current?.focus();
        }}
        // A click on the backdrop lands on the <dialog> itself, outside its content.
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
      >
        <h2 id={titleId} className="text-lg tracking-tight">
          Reset demo?
        </h2>
        <p id={bodyId} className="mt-2 text-sm text-muted">
          {RESET_WARNING}
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-2xl bg-bad-bg px-4 py-2 text-sm font-medium text-bad-fg">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancel} type="button" onClick={close} disabled={busy} className="btn btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            aria-busy={busy || undefined}
            className="btn btn-destructive"
          >
            {busy ? 'Resetting…' : 'Reset demo'}
          </button>
        </div>
      </dialog>
    </>
  );
}
