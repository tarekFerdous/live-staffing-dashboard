/// <reference types="vitest/config" />
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Text formats worth compressing. Images and fonts are compressed already. */
const COMPRESSIBLE = /\.(js|css|html|svg|json)$/;
/** Below this, the encoding headers cost about what compression saves. */
const MIN_COMPRESS_BYTES = 1024;

/**
 * #88: writes `.br` and `.gz` copies next to every text file in the build, at maximum quality,
 * so the Site Lambda serves compressed bytes without spending CPU per request.
 */
function precompress(): Plugin {
  let outDir = 'dist';
  return {
    name: 'precompress',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const files = await readdir(outDir, { recursive: true });
      for (const name of files.filter((f) => COMPRESSIBLE.test(f))) {
        const path = join(outDir, name);
        const raw = await readFile(path);
        if (raw.length < MIN_COMPRESS_BYTES) continue;
        await writeFile(`${path}.gz`, gzipSync(raw, { level: 9 }));
        await writeFile(
          `${path}.br`,
          brotliCompressSync(raw, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
          }),
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), precompress()],
  build: {
    // Images stay files: base64 inside JS costs a third more and can't be cached on its own.
    assetsInlineLimit: 0,
    // Folds sub-kilobyte shared chunks into a neighbour: a separate request for a few hundred
    // bytes costs more than it saves. (Larger values start merging manager code into shared chunks.)
    rollupOptions: { output: { experimentalMinChunkSize: 1_000 } },
  },
  server: {
    port: 5173,
    // docker compose sets VITE_HOST=0.0.0.0 so the dev server is reachable from the host.
    host: process.env.VITE_HOST || undefined,
    // Bind mounts on Windows/macOS don't deliver file events into the container.
    watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
    // Same origin for `/api` and the live channel locally, just like CloudFront in the cloud.
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT ?? 3001}`,
      '/event/realtime': { target: `ws://localhost:${process.env.API_PORT ?? 3001}`, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
