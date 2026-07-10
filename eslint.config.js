import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-site/**', 'custom-elements.json', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,mjs,js}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['scripts/**/*.mjs', 'demo/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
