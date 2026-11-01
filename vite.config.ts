import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': r('./src/shared'),
      '@client': r('./src/client'),
    },
  },
  build: {
    outDir: r('./dist/client'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Dev only: accept proxied preview hosts (sandbox / container previews).
    allowedHosts: true,
    // Development convenience only: `npm run dev:client` serves HMR assets and
    // proxies API calls to the local Worker (wrangler dev on 8787).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        // The worker sees the proxy's origin. Rewrite only requests that were
        // same-origin at the browser; never make cross-origin requests trusted.
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            const origin = req.headers.origin;
            if (!origin || !req.headers.host) return;
            try {
              if (new URL(origin).host === req.headers.host) proxyReq.setHeader('origin', 'http://127.0.0.1:8787');
            } catch { /* Leave malformed origins for the worker to reject. */ }
          });
        },
      },
    },
  },
});
