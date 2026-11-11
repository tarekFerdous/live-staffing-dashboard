import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App, createQueryClient, ROUTER_FUTURE } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={ROUTER_FUTURE}>
      <App queryClient={createQueryClient()} />
    </BrowserRouter>
  </StrictMode>,
);
