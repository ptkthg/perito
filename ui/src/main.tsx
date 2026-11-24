// Ponto de entrada. Fontes auto-hospedadas via @fontsource (sem CDN).
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/bench.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root ausente no index.html');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
