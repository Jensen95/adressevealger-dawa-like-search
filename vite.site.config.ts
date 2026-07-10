import { resolve } from 'node:path'

import { defineConfig } from 'vite'

// Site / demo build config. Multi-page Vite build of the demo landing page,
// the benchmark dashboard and the docs page. Output goes to dist-site/, which
// the Pages workflow uploads. `base` matches the GitHub Pages project path;
// override with VITE_BASE=/ for local `vite preview` at the root.
const base = process.env.VITE_BASE ?? '/adressevaelger-enhanced/'

export default defineConfig({
  root: resolve(import.meta.dirname, 'demo'),
  base,
  build: {
    target: 'es2022',
    outDir: resolve(import.meta.dirname, 'dist-site'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'demo/index.html'),
        benchmark: resolve(import.meta.dirname, 'demo/benchmark.html'),
        docs: resolve(import.meta.dirname, 'demo/docs.html'),
      },
    },
  },
})
