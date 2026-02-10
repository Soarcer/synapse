import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const devPort = Number.parseInt(process.env.VITE_DEV_PORT || '5173', 10);
const apiOrigin = process.env.VITE_API_ORIGIN || 'http://localhost:4000';
const wsOrigin = process.env.VITE_WS_ORIGIN || apiOrigin.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number.isNaN(devPort) ? 5173 : devPort,
    proxy: {
      '/api': apiOrigin,
      '/ws': {
        target: wsOrigin,
        ws: true,
      },
    },
  },
});
