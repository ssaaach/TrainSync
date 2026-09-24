// ESLint flat config. Node (CommonJS) for the server, tests and scripts;
// browser globals for public/js; Playwright/Jest globals in tests.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'public/vendor/**', 'ml/.venv/**', 'playwright-report/**', 'test-results/**', 'tests/visual/__diff__/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, TS: 'readonly', L: 'readonly', Chart: 'readonly' },
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.jest } },
  },
  {
    // Playwright page.evaluate() callbacks run in the browser.
    files: ['tests/visual/**/*.js', 'tests/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
];
