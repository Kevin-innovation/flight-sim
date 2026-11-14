import { defineConfig } from 'vite';

// base './' so the build runs from any folder (Patch serves the release as-is).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    license: { fileName: 'THIRD-PARTY-NOTICES.md' },
  },
  server: { host: '127.0.0.1' },
});
