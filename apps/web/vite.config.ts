import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(['/api', '/feed.xml', '/feed.json', '/feeds'].map((path) => [path, { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: true }])),
  },
});
