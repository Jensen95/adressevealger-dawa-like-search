import { resolve } from 'node:path'

import { defineConfig } from 'vite'

// Library build config. Produces the ESM bundle in dist/ with Lit left
// external so consumers dedupe a single copy. Type declarations are emitted
// separately by `tsc -p tsconfig.build.json` (see the `build` npm script).
export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        'lib/index': resolve(import.meta.dirname, 'src/lib/index.ts'),
        'components/adressevaelger-search': resolve(
          import.meta.dirname,
          'src/components/adressevaelger-search.ts',
        ),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^lit/, /^@lit/],
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts',
        'dist/**',
        'dist-site/**',
        '**/*.config.*',
        '**/*.d.ts',
      ],
    },
  },
})
