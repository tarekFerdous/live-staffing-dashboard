import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App, createQueryClient, ROUTER_FUTURE } from './App';
import { appSyncTransport, loadRealtimeConfig } from './lib/sync/appsyncTransport';
import './index.css';

// The deploy writes /config.json with the realtime endpoint; without it the app refetches after actions.
const realtime = await loadRealtimeConfig();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={ROUTER_FUTURE}>
      <App queryClient={createQueryClient()} transport={realtime ? appSyncTransport(realtime) : null} />
    </BrowserRouter>
  </StrictMode>,
);
