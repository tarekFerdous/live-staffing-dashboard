/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
