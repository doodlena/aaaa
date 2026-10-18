import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource/young-serif/latin-400.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/atkinson-hyperlegible-mono/latin-400';
import '@fontsource/atkinson-hyperlegible-mono/latin-700';
import { reloadForNewVersion } from './i18n';
import './styles/app.css';
import { App } from './App';
import { registerServiceWorker } from './lib/offline';

registerServiceWorker();
// A lazily loaded file from an older deploy is gone: reload into the current version instead of failing.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewVersion()) e.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
