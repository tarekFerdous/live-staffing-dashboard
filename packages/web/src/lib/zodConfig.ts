// zod 4 (mini too) probes `new Function` to compile faster object parsers. The deployed site's strict CSP
// (`script-src 'self'`, no 'unsafe-eval') blocks it and reports a violation, so the browser uses
// zod's plain parsers, which are fast enough here. Imported first in main.tsx: ES modules run in
// import order, so this applies before any schema parses.
import * as z from 'zod/mini';

z.config({ jitless: true });
