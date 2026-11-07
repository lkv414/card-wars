import { createReadStream, cpSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const contentDir = resolve(here, '../../content');

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

// Serves the repo-root content/ to the client: middleware in dev, copied art in build.
function contentAssets(): Plugin {
  return {
    name: 'card-wars-content-assets',
    configureServer(server) {
      server.middlewares.use('/content', (req, res) => {
        const urlPath = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        const filePath = resolve(join(contentDir, urlPath));
        if (!filePath.startsWith(contentDir + sep)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        res.setHeader('Content-Type', MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        createReadStream(filePath).pipe(res);
      });
    },
    closeBundle() {
      // Card scans and hero portraits are served as static assets (docs/UI-3D.md).
      for (const part of [['cards', 'images'], ['heroes', 'images']]) {
        const source = join(contentDir, ...part);
        const target = resolve(here, 'dist/content', ...part);
        if (existsSync(source)) cpSync(source, target, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), contentAssets()],
  build: {
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, '/');
          if (norm.includes('node_modules/@react-three')) {
            return 'r3f';
          }
          if (norm.includes('node_modules/three')) {
            return 'three';
          }
          if (norm.includes('packages/content')) {
            return 'content';
          }
          if (norm.includes('node_modules/zod')) {
            return 'zod';
          }
        },
      },
    },
  },
});
