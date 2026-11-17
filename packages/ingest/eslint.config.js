import globals from 'globals';

export default [
  {
    ignores: ['node_modules/', 'test/'],
  },
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        fetch: 'readonly',
        AbortController: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      'no-return-await': 'error',
      'no-duplicate-imports': 'error',
      'object-shorthand': 'error',
    },
  },
];
