// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { SYNAPSE_PORT, DEV_PORT, PROTOCOL, WS_PROTOCOL } from '@synapse-ai/core/config';

const proxyTarget = `${PROTOCOL}://127.0.0.1:${SYNAPSE_PORT}`;
const wsTarget = `${WS_PROTOCOL}://127.0.0.1:${SYNAPSE_PORT}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
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
