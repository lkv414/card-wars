import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Этап 2: прокси /ws на wrangler dev для локальной разработки.
});
