import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const chunk = randomBytes(64 * 1024);
const maxDownload = 128 * 1024 * 1024, maxUpload = 32 * 1024 * 1024;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml' };

export function createServer(options = {}) {
  const origins = (options.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '*').split(',').map((value) => value.trim());
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    if (origin && !origins.includes('*') && !origins.includes(origin)) { res.writeHead(403); res.end('Origin denied'); return; }
    res.setHeader('Access-Control-Allow-Origin', origins.includes('*') ? '*' : origin || origins[0]);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    const json = (data, code = 200) => { res.writeHead(code, { 'Content-Type':'application/json' }); res.end(JSON.stringify(data)); };
    if (url.pathname === '/api/ping' && req.method === 'GET') { json({ time:Date.now() }); return; }
    if (url.pathname === '/api/info' && req.method === 'GET') {
      json({ service:'little-server-speed-test', time:new Date().toISOString(), timezone:Intl.DateTimeFormat().resolvedOptions().timeZone, clientAddress:req.socket.remoteAddress }); return;
    }
    if (url.pathname === '/api/download' && req.method === 'GET') {
      const size = Number(url.searchParams.get('bytes') ?? 33554432);
      if (!Number.isInteger(size) || size < 1 || size > maxDownload) { json({ error:'Invalid download size' }, 400); return; }
      res.writeHead(200, { 'Content-Type':'application/octet-stream', 'Content-Length':size, 'X-Accel-Buffering':'no' });
      let sent = 0;
      const pump = () => {
        while (sent < size && !res.destroyed) {
          const data = chunk.subarray(0, Math.min(chunk.length, size - sent)); sent += data.length;
          if (!res.write(data)) { res.once('drain', pump); return; }
        }
        if (!res.destroyed) res.end();
      };
      pump(); return;
    }
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      if (Number(req.headers['content-length']) > maxUpload) { json({ error:'Upload too large' }, 413); req.resume(); return; }
      let bytes = 0;
      req.on('data', (data) => { bytes += data.length; if (bytes > maxUpload && !res.writableEnded) { json({ error:'Upload too large' }, 413); req.destroy(); } });
      req.on('end', () => { if (!res.writableEnded) json({ bytes }); });
      req.on('error', () => { if (!res.writableEnded) res.destroy(); }); return;
    }
    if (url.pathname.startsWith('/api/')) { json({ error:'Not found or method not allowed' }, 404); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    try {
      const path = resolve(publicDir, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(publicDir) || !types[extname(path)]) { res.writeHead(404); res.end(); return; }
      let body = await readFile(path);
      if (url.pathname === '/config.js') body = Buffer.from(`${body.toString()}\nwindow.SPEED_TEST_CONFIG.serverUrl ||= location.origin;\n`);
      res.writeHead(200, { 'Content-Type':types[extname(path)] }); res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.requestTimeout = 60000; server.headersTimeout = 15000; server.timeout = 60000;
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080), host = process.env.HOST || '::';
  const server = createServer(); server.listen(port, host, () => console.log(`Speed test listening on port ${port}`));
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
