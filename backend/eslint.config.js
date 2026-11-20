import globals from 'globals';

export default [
  // Standalone ignores block — excludes these patterns globally
  {
    ignores: ['node_modules/', 'dist/', 'src/generated/', 'eslint.config.js'],
  },
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        fetch: 'readonly',
        AbortController: 'readonly',
        Blob: 'readonly',
        FormData: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^(_|next|res)$' }],
      'no-console': ['warn', { allow: ['error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      'no-return-await': 'error',
      'no-duplicate-imports': 'error',
      'object-shorthand': 'error',
    },
  },
  // Operator scripts print progress and one-time secrets to the terminal.
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
];
