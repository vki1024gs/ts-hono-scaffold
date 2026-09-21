import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectConfig } from './lib/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = projectConfig(root);
const publicRoot = path.join(root, 'packages/frontend/dist');
const indexFile = path.join(publicRoot, 'index.html');
const api = new URL(config.apiOrigin);
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
]);

const isApiPath = (pathname) =>
  pathname === '/status' ||
  pathname === '/api' ||
  pathname.startsWith('/api/') ||
  pathname === '/health' ||
  pathname.startsWith('/health/');

function proxy(req, res) {
  const upstream = request(
    {
      protocol: api.protocol,
      hostname: api.hostname,
      port: api.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: api.host },
      timeout: 5000,
    },
    (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('timeout', () => upstream.destroy(new Error('PROXY_TIMEOUT')));
  upstream.on('error', () => {
    if (!res.headersSent)
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('{"error":"UPSTREAM_UNAVAILABLE"}\n');
  });
  req.pipe(upstream);
}

async function staticFile(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const candidate = path.resolve(publicRoot, `.${decoded}`);
  if (
    candidate !== publicRoot &&
    !candidate.startsWith(publicRoot + path.sep)
  ) {
    res.writeHead(400).end();
    return;
  }
  let file = candidate;
  try {
    if (!(await stat(file)).isFile()) file = indexFile;
  } catch {
    if (path.extname(decoded)) {
      res.writeHead(404).end();
      return;
    }
    file = indexFile;
  }
  const metadata = await stat(file);
  res.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': metadata.size,
    'Content-Type':
      mimeTypes.get(path.extname(file)) || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://local').pathname;
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (isApiPath(pathname)) proxy(req, res);
  else
    void staticFile(req, res, pathname).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
});

server.on('error', () => process.exit(1));
server.listen(config.webPort, config.webHost);
const stop = () => {
  const timer = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 5000);
  server.close(() => {
    clearTimeout(timer);
    process.exit(0);
  });
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
