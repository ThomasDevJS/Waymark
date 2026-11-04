#!/usr/bin/env node
// Static server for the fixture site. One port serves two origins:
// http://127.0.0.1:<port> (main) and http://localhost:<port> (cross-origin iframes).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./site/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

export function startFixtureServer(port = Number(process.env.FIXTURE_PORT ?? 4173)) {
  /** Test-only library pack: set with PUT /__library, served at /library.waymark.json. */
  let library = null;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/__library' && req.method === 'PUT') {
      let body = '';
      for await (const chunk of req) body += chunk;
      library = body;
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/library.waymark.json') {
      if (library === null) res.writeHead(404).end();
      else res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(library);
      return;
    }
    let path = decodeURIComponent(url.pathname);
    // /slow/... serves the app shell after 2.5 s (slow full page loads).
    if (path.startsWith('/slow/')) {
      await new Promise((r) => setTimeout(r, Number(url.searchParams.get('delay') ?? 2500)));
      path = '/index.html';
    }
    // In-app routes (history routing) all serve the app shell.
    if (path === '/' || path.startsWith('/app/')) path = '/index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await startFixtureServer();
  const { port } = server.address();
  console.log(`Fixture site: http://127.0.0.1:${port}/  (cross-origin frames from http://localhost:${port})`);
}
