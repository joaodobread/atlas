import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './app/Root.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
