// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { HTTP_FALLBACK_PORT, DEV_PORT } from '@synapse-ai/core/config';

// Always proxy to the HTTP fallback port (SYNAPSE_PORT + 2, default 27248).
// This port is always plain HTTP regardless of TLS config, so the proxy
// works identically whether the main server uses HTTP or HTTPS.
const proxyTarget = `http://127.0.0.1:${HTTP_FALLBACK_PORT}`;
const wsTarget = `ws://127.0.0.1:${HTTP_FALLBACK_PORT}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  define: {
    // @synapse-ai/core/config.ts uses process.env at module scope.
    // Only the vite.config.ts import runs in Node; the browser bundle
    // needs these shimmed to avoid "process is not defined".
    'process.env.SYNAPSE_PORT': JSON.stringify(process.env.SYNAPSE_PORT || '27246'),
    'process.env.VITE_DEV_PORT': JSON.stringify(process.env.VITE_DEV_PORT || '5173'),
    'process.env.SYNAPSE_TLS_CERT': JSON.stringify(process.env.SYNAPSE_TLS_CERT || ''),
    'process.env.SYNAPSE_TLS_KEY': JSON.stringify(process.env.SYNAPSE_TLS_KEY || ''),
  },
  server: {
    port: DEV_PORT,
    host: true,
    proxy: {
      '/api': { target: proxyTarget, secure: false },
      '/ws': {
        target: wsTarget,
        ws: true,
        secure: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-xyflow': ['@xyflow/react'],
          'vendor-recharts': ['recharts'],
        },
      },
    },
  },
});
