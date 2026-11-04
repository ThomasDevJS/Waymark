import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['.output/**', '.output-test/**', '.wxt/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, chrome: 'readonly', __WAYMARK_TEST__: 'readonly', defineBackground: 'readonly', defineUnlistedScript: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty-pattern': 'off',
      // User strings never reach innerHTML (SPEC: Security).
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'User strings never reach innerHTML (SPEC: Security).' },
        { property: 'outerHTML', message: 'User strings never reach outerHTML (SPEC: Security).' },
        { property: 'insertAdjacentHTML', message: 'Use DOM APIs (SPEC: Security).' },
      ],
      // Bare browser globals that silently stand in for a missing local variable.
      'no-restricted-globals': [
        'error',
        ...['origin', 'name', 'status', 'event', 'length', 'closed'].map((n) => ({ name: n, message: `Use window.${n} explicitly if you mean the global.` })),
      ],
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
);
