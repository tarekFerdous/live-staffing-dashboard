import type { Counts } from '@staffing/domain';

const places = (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`;

/**
 * The shift's staffing state in one or two short sentences, built from the derived counts:
 * "2 of 3 places filled. 1 checked in, nobody out yet."
 */
export function staffingSentence({ filled, required, checkedIn, checkedOut }: Counts): string {
  if (filled === 0) return `No places filled yet. ${places(required)} to go.`;
  const first =
    filled < required
      ? `${filled} of ${places(required)} filled.`
      : required === 1
        ? 'The place is filled.'
        : `All ${places(required)} filled.`;

  let second: string;
  if (checkedIn === 0 && checkedOut === 0) second = 'Nobody checked in yet.';
  else if (checkedOut === 0) second = `${checkedIn} checked in, nobody out yet.`;
  else if (checkedIn === 0 && checkedOut === filled) second = 'Everyone has checked out.';
  else if (checkedIn === 0) second = `${checkedOut} checked out, nobody else checked in.`;
  else second = `${checkedIn} checked in, ${checkedOut} checked out.`;

  return `${first} ${second}`;
}
