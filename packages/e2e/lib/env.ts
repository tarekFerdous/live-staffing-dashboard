import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
export const SHIFT_ID = process.env.SHIFT_ID ?? 'harbourfront-gala';

/** Anything that isn't localhost is the deployed stage (reset needs the `staffing` AWS profile). */
export const IS_STAGE = !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Puts the shift back to the seed: three Uninvited, Not started workers and an empty log.
 * It also bumps the shift's epoch, so open pages reset themselves, and events from before the
 * reset that the stream delivers late are dropped by the pages (they carry the old epoch).
 */
export async function resetShift(): Promise<void> {
  execFileSync('pnpm', ['reset', ...(IS_STAGE ? ['--stage'] : [])], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}
