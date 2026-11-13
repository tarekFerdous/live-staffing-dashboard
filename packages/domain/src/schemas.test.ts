import { describe, expect, it } from 'vitest';
import { ActionRequestSchema, apiErrorMap, registerEnglishMessages, WorkerSchema } from './schemas';

/** The first issue as the action endpoint words it in its 422 body. */
function message(body: unknown): string {
  const r = ActionRequestSchema.safeParse(body, { error: apiErrorMap });
  if (r.success) return 'ok';
  const issue = r.error.issues[0]!;
  return `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`;
}

describe('#79 validation messages are worded as before the zod 4 upgrade', () => {
  it.each([
    [
      { action: 'promote' },
      "action: Invalid enum value. Expected 'invite' | 'accept' | 'decline' | 'cancel' | 'check_in' | 'check_out', received 'promote'",
    ],
    [{ action: 'invite', extra: 1 }, "Unrecognized key(s) in object: 'extra'"],
    [{ action: 'invite', expectedVersion: -1 }, 'expectedVersion: Number must be greater than or equal to 0'],
    [{ action: 'invite', expectedVersion: 1.5 }, 'expectedVersion: Expected integer, received float'],
    [{}, 'action: Required'],
    [{ action: 'invite', expectedVersion: '1' }, 'expectedVersion: Expected number, received string'],
    [5, 'Expected object, received number'],
    [null, 'Expected object, received null'],
    [{ action: 'invite', expectedVersion: 2 }, 'ok'],
  ])('%j → %s', (body, expected) => {
    expect(message(body)).toBe(expected);
  });
});

describe('WorkerSchema', () => {
  it('defaults the profile fields of rows stored before they existed', () => {
    const w = WorkerSchema.parse({
      id: 'a',
      name: 'A',
      participation: 'invited',
      attendance: 'not_started',
      invitedAt: '2026-01-01T00:00:00.000Z',
      respondedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      version: 1,
    });
    expect(w).toMatchObject({ role: '', phone: '', email: '', address: '' });
  });
});

describe('#89 zod/mini messages', () => {
  // Last in this file: the locale is process-wide once registered.
  it('are generic until the server registers English, then readable', () => {
    const issue = () => WorkerSchema.safeParse({ id: '' }).error!.issues[0]!.message;
    expect(issue()).toBe('Invalid input');
    registerEnglishMessages();
    expect(issue()).toMatch(/^Too small: expected string to have >=1 character/);
  });
});
