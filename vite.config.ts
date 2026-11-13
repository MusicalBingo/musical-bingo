import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const API = `http://localhost:${process.env.PORT || 3000}`;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': API,
      '/uploads': API,
      '/socket.io': { target: API, ws: true },
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'client/index.html'),
        play: resolve(__dirname, 'client/play.html'),
        display: resolve(__dirname, 'client/display.html'),
        presenter: resolve(__dirname, 'client/presenter.html'),
      },
    },
  },
});
