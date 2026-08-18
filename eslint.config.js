import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'node_modules',
    'workers/.wrangler/**',
    'workers/.dev.vars',
    'data/**',
    'supabase/.temp/**',
    'supabase/.branches/**',
    '.agents/**',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // react-hooks/preserve-manual-memoization — слишком агрессивное правило
      // React Compiler (требует мемоизации deps из пропсов); в существующем коде
      // массово требует рефакторинга вызывающих компонентов. Отключено до тех
      // пор, пока команда не выработает стратегию мемоизации callbacks.
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
])
