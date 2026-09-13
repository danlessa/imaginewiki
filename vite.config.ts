import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any subdirectory, e.g. GitHub Pages.
  base: './',
  // MapLibre starts its worker as a module worker.
  worker: { format: 'es' },
});
