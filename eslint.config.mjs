import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
export default ts.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.runtime/**',
      '.scaffold/recipes/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['packages/frontend/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': [
        'error',
        { patterns: ['@*/db', '@*/webui', '**/webui/**', '**/db/**'] },
      ],
    },
  },
  {
    files: ['packages/frontend/src/**/*.{ts,tsx}'],
    ignores: ['packages/frontend/src/api/**'],
    rules: {
      'no-restricted-globals': ['error', 'fetch'],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='fetch']",
          message: 'Use the centralized API client.',
        },
      ],
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'hono',
            'react',
            'zod',
            '@*/api',
            '@*/db',
            '@*/webui',
            '@*/frontend',
          ],
        },
      ],
    },
  },
  {
    files: ['packages/db/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'hono',
            'react',
            '@*/api',
            '@*/webui',
            '@*/frontend',
            '**/api/**',
            '**/webui/**',
            '**/frontend/**',
          ],
        },
      ],
    },
  },
  {
    files: ['packages/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'hono',
            'react',
            '@*/db',
            '@*/webui',
            '@*/frontend',
            '**/db/**',
            '**/webui/**',
            '**/frontend/**',
          ],
        },
      ],
    },
  },
  {
    files: ['packages/webui/src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        { patterns: ['react', '@*/frontend', '**/frontend/**'] },
      ],
    },
  },
);
