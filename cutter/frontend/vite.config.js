import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/remove-bg': 'http://localhost:8001',
      '/add-bleed': 'http://localhost:8001',
      '/health': 'http://localhost:8001',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
  },
});
