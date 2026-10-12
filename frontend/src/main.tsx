import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource/young-serif/latin-400.css';
import '@fontsource/atkinson-hyperlegible-mono/latin-400';
import '@fontsource/atkinson-hyperlegible-mono/latin-700';
import './i18n';
import './styles/app.css';
import { App } from './App';
import { registerServiceWorker } from './lib/offline';

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
