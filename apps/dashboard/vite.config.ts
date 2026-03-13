// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Synapse Contributors

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readServerPort, synapsePortWatcher } from './vite-plugins/synapsePort';

const devPort = Number.parseInt(process.env.VITE_DEV_PORT || '5173', 10);

// Read the initial server port at startup. The synapsePortWatcher plugin will
// call server.restart() if this changes while the dev server is running.
const serverPort = readServerPort();
const proxyTarget = `http://127.0.0.1:${serverPort}`;
const wsTarget = `ws://127.0.0.1:${serverPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss(), synapsePortWatcher()],
  server: {
    port: Number.isNaN(devPort) ? 5173 : devPort,
    host: true,
    proxy: {
      '/api': proxyTarget,
      '/ws': {
        target: wsTarget,
        ws: true,
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
