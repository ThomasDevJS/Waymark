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
  {
    // Content code reads event paths through eventPath() (src/content/overlay/host.ts), which shows
    // test builds what the store build's closed overlay root shows (D86, #46).
    files: ['src/content/**/*.ts', 'src/content/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', { selector: "CallExpression[callee.property.name='composedPath']", message: 'Use eventPath(e) from src/content/overlay/host.ts (D86).' }],
    },
  },
);
