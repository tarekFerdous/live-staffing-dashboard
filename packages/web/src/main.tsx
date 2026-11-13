import './lib/zodConfig'; // first: no `new Function` probe under the CSP
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App, createQueryClient } from './App';
import { appSyncTransport, loadRealtimeConfig } from './lib/sync/appsyncTransport';
// Geist, self-hosted from the bundle (no request to Google Fonts).
import '@fontsource-variable/geist';
import './index.css';

// GET /api/config says where the live channel is (AppSync Events in the cloud, the local ws
// server in local mode), so one build runs in both. Without one the app refetches after actions.
const realtime = await loadRealtimeConfig();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App queryClient={createQueryClient()} transport={realtime ? appSyncTransport(realtime) : null} />
    </BrowserRouter>
  </StrictMode>,
);
