import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerServiceWorker } from './pwa';

// Register PWA Service Worker for offline shell and asset caching
registerServiceWorker();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
