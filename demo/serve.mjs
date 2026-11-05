#!/usr/bin/env node
// Serves the demo app at http://localhost:8080 (no dependencies; needs Node 18+).
// Waymark works only on http(s) pages, so opening the files directly (file://) won't work.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

createServer(async (req, res) => {
  let path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root) || !TYPES[extname(file)]) return res.writeHead(404).end('Not found');
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] }).end(await readFile(file));
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Demo app: http://localhost:${port}  (Ctrl+C to stop)`));
