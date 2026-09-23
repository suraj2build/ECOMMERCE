module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  overrides: [
    {
      // apps/storefront: a browser/JSX (React) environment, not Node -
      // separate from the rest of this repo's server-side TypeScript.
      files: ['apps/storefront/**/*.ts', 'apps/storefront/**/*.tsx'],
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      plugins: ['jsx-a11y'],
      extends: ['plugin:jsx-a11y/recommended'],
      env: {
        browser: true,
        node: false,
      },
      rules: {
        // Next.js's App Router server components legitimately return
        // Promise<JSX.Element> - not a floating-promise bug.
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^React$' }],
      },
    },
  ],
  ignorePatterns: [
    'dist/',
    'build/',
    '.next/',
    'node_modules/',
    'coverage/',
    'playwright-report/',
    'packages/db/generated/',
    '*.cjs',
    '*.config.ts',
    '*.config.js',
    '*.config.mjs',
    '**/next-env.d.ts',
  ],
};
