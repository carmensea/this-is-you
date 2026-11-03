import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The browser only ever talks to this origin. /api is forwarded to the local service.
const backend = `http://127.0.0.1:${process.env.THIS_IS_YOU_PORT ?? 8000}`;
// changeOrigin stays off: the service compares Host with Origin, and needs to see the address the browser really used.
const server = { host: '127.0.0.1', port: 5180, strictPort: true, proxy: { '/api': { target: backend, changeOrigin: false } } };

export default defineConfig({
  plugins: [react()],
  server,
  preview: server,
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.ts' },
});
