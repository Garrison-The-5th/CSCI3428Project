import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/build/',
      '**/coverage/',
      '**/.next/',
      'backend/generated/*',
    ],
  },
  // Global configuration
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'simple-import-sort': simpleImportSort,
      import: importPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-undef': 'off',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import/no-duplicates': 'error',
    },
    settings: {
      react: {
        version: '19.1',
      },
    },
  },
  // Backend configuration (Node.js only)
  {
    files: ['backend/**/*.{js,ts}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...typescript.configs.recommended.rules,
      'no-undef': 'off',
    },
  },
  // Frontend configuration (Browser only)
  {
    files: ['frontend/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      '@typescript-eslint': typescript,
      import: importPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...typescript.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-undef': 'off',
      'import/no-mutable-exports': 'error',
      /*
       * `import/order` is deliberately off.
       *
       * It and simple-import-sort both order imports, and they disagree about
       * blank lines: simple-import-sort separates its groups with one, which
       * import/order then reports as "no empty line within import group". Each
       * rule's autofix undoes the other's, so the pair can never both be
       * satisfied — three files were stuck failing lint no matter which fix ran.
       * simple-import-sort is the one kept, because it is the one that can
       * actually repair a file rather than only complain about it.
       */
      'import/order': 'off',
      'import/newline-after-import': ['error', { count: 1 }],
      /*
       * Raised from 10. CI fails on warnings (§5.1.2), and 10 fired on every
       * page component — a page is a composition root, so a dozen imports is
       * normal rather than a smell. 18 still catches a module that has
       * genuinely become a tangle.
       */
      'import/max-dependencies': ['warn', { max: 18, ignoreTypeImports: true }],
    },
    settings: {
      react: {
        version: '19.1',
      },
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
        },
      },
    },
  },
  // Prettier config (should be last)
  prettier,
];
