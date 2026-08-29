import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CompanionApp } from './CompanionApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.hash === '#companion' ? <CompanionApp /> : <App />}
  </StrictMode>
);
