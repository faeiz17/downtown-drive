import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: false },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
  },
});
