import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/grid.css';
import './themes/registry'; // eagerly imports the minimal theme stylesheet
import { initTheme } from './themes/store';
import { App } from './App';

// Load the active theme's CSS before revealing the page (see public/theme-boot.js).
void initTheme().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
