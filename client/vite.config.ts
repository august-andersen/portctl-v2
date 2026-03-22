import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: currentDirectory,
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(currentDirectory, '..', 'shared'),
      '@client': path.resolve(currentDirectory, 'src'),
    },
  },
  build: {
    outDir: path.resolve(currentDirectory, '..', 'dist', 'client'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:47777',
        changeOrigin: true,
      },
    },
  },
});
