import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const devPort = Number.parseInt(process.env.VITE_DEV_PORT || '5173', 10);

// Proxy target for the dev server — always hits the local Synapse server.
// Separate from VITE_API_ORIGIN (which is for production client-side builds only).
const serverPort = process.env.SYNAPSE_PORT || process.env.PORT || '4000';
const proxyTarget = `http://localhost:${serverPort}`;
const wsTarget = `ws://localhost:${serverPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number.isNaN(devPort) ? 5173 : devPort,
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
