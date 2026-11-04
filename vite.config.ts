import fs from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The browser only ever talks to this origin. /api is forwarded to the local service.
const backend = `http://127.0.0.1:${process.env.THIS_IS_YOU_PORT ?? 8000}`;
// changeOrigin stays off: the service compares Host with Origin, and needs to see the address the browser really used.
const server = { host: '127.0.0.1', port: 5180, strictPort: true, proxy: { '/api': { target: backend, changeOrigin: false } } };

// pdf.js fetches these by name at run time. The service serves only /assets, so they go there, never to any other host.
const pdfAssets = {
  name: 'pdfjs-assets',
  apply: 'build' as const,
  generateBundle(this: { emitFile(file: { type: 'asset'; fileName: string; source: Uint8Array }): string }) {
    for (const folder of ['standard_fonts', 'cmaps', 'wasm']) {
      const from = `node_modules/pdfjs-dist/${folder}`;
      for (const name of fs.readdirSync(from)) {
        if (!name.startsWith('quickjs')) this.emitFile({ type: 'asset', fileName: `assets/pdfjs/${folder}/${name}`, source: fs.readFileSync(`${from}/${name}`) });
      }
    }
  },
};

export default defineConfig({
  plugins: [react(), pdfAssets],
  server,
  preview: server,
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.ts' },
});
