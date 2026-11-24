import { defineConfig, type Plugin } from 'vite';

// Hosts the page may talk to. The API keys typed on the phone can only ever leave towards these.
const CONNECT = [
  'https://api.anthropic.com',
  'https://api.open-meteo.com',
  'http://127.0.0.1:8765',
  'http://localhost:8765',
  // Synced lyrics of what's playing (title and artist only).
  'https://lrclib.net',
  // Drive HUD: map tiles, speed limits/cameras, routing and place search.
  'https://khj0209.github.io', 'https://overpass-api.de', 'https://overpass.private.coffee', 'https://maps.mail.ru', 'https://router.project-osrm.org', 'https://nominatim.openstreetmap.org', 'https://apis.openapi.sk.com',
];

/** Adds a strict Content-Security-Policy to the built page (not in dev, where Vite injects inline code). */
function csp(): Plugin {
  // No 'self'-based directives: the Even App loads the page from a file-like origin where 'self'
  // may not match, which would block the app's own bundle. connect-src is what keeps the keys in.
  const policy = [
    `connect-src ${CONNECT.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

// Relative base so the build works when packed into an .ehpk and loaded from a file-like origin.
export default defineConfig({
  base: './',
  plugins: [csp()],
  server: { port: 5173, strictPort: true },
});
