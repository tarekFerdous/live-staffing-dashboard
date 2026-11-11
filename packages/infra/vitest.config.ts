import { defineConfig } from 'vitest/config';

// Synth bundles the Lambda with esbuild, which takes a few seconds.
export default defineConfig({ test: { testTimeout: 120_000, hookTimeout: 120_000 } });
