// Apply a stored theme before the first paint (no flash); storage may be unavailable.
// A file rather than an inline <script>, so the CSP can stay `script-src 'self'`.
/* global localStorage, document */
try {
  var t = localStorage.getItem('live-staffing.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {
  // No storage (private mode, blocked): keep the system theme.
}
