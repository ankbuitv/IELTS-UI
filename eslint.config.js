import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.wrangler/**', 'coverage/**', 'seed/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Node-side tooling (database reset, end-to-end acceptance run). These are
    // plain `.mjs` scripts executed by Node, so they get Node globals and may
    // print to stdout - the acceptance run reports through the console.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/client/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler is not enabled for this project. These rules flag two
      // patterns we use deliberately and test:
      //   * fetching data in a mount/deps effect (useAsync, AuthContext,
      //     useExamSession, AdminSettings) and the resulting async setState;
      //   * resetting local editor state when a new server document arrives
      //     (AudioPlayer playback counters, WritingEditor buffer).
      // They stay visible as warnings so a future compiler migration can pick
      // them up, but they must not fail the build today.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
);
