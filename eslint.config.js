import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.wrangler/**',
      '**/coverage/**',
      '.archive/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // '_' — намеренная конвенция для неиспользуемых параметров/переменных
      // (см. packages/domain/src/mechanics/handlers.ts: единая сигнатура обработчиков эффектов).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
);
