import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/server.mjs';

let server, base;
before(async () => {
  server = createServer({ allowedOrigins:'https://example.pages.dev' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections(); server.close(); });
test('metadata, latency, and static page are available', async () => {
  const info = await (await fetch(`${base}/api/info`)).json();
  assert.equal(info.service, 'little-server-speed-test');
  assert.ok(Number.isFinite(Date.parse(info.time)));
  assert.equal((await fetch(`${base}/api/ping`)).status, 200);
  assert.match(await (await fetch(base)).text(), /id="download"/);
});
test('download returns exactly requested uncompressed bytes', async () => {
  const res = await fetch(`${base}/api/download?bytes=131075`);
  assert.equal(res.headers.get('content-encoding'), null);
  assert.equal((await res.arrayBuffer()).byteLength, 131075);
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal((await fetch(`${base}/api/download?bytes=999999999`)).status, 400);
});
test('upload drains payload and counts received bytes', async () => {
  const res = await fetch(`${base}/api/upload`, { method:'POST', body:new Uint8Array(100123) });
  assert.deepEqual(await res.json(), { bytes:100123 });
});
test('browser preflight and origin restriction', async () => {
  const res = await fetch(`${base}/api/upload`, { method:'OPTIONS', headers:{ Origin:'https://example.pages.dev', 'Access-Control-Request-Method':'POST', 'Access-Control-Request-Headers':'content-type' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://example.pages.dev');
  assert.equal((await fetch(`${base}/api/ping`, { headers:{ Origin:'https://untrusted.test' } })).status, 403);
});
test('unknown routes and private files are not served', async () => {
  assert.equal((await fetch(`${base}/server/server.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
});
