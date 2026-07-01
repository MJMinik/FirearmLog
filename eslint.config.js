// Focused, professional ESLint setup (flat config, ESLint 9 + typescript-eslint 8).
// Deliberately NOT the kitchen sink: base correctness rules + React hooks rules +
// the type-aware no-floating-promises rule (the highest-value one for reliability).
// Prettier owns formatting, so style rules are turned off.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'playwright-report',
      'test-results',
      'coverage',
      '*.timestamp-*.mjs',
      'public/sw.js', // plain service-worker script, not part of the TS project
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // TypeScript already checks for undefined identifiers (tsc), and no-undef does
  // not understand TS lib globals — so it's turned off for TS files, per the
  // typescript-eslint project's own guidance.
  { files: ['**/*.{ts,tsx}'], rules: { 'no-undef': 'off' } },
  // Plain JS / Node scripts (e.g. scripts/check-imports.mjs) get Node globals.
  { files: ['**/*.{js,mjs,cjs}'], languageOptions: { globals: globals.node } },
  // Type-aware rules only for the app source (the TS program covers src/; the
  // e2e + test files aren't in tsconfig, so they get non-type-aware linting).
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  prettier,
);
