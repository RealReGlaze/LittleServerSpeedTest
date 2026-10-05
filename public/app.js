const $ = (id) => document.getElementById(id);
const config = window.SPEED_TEST_CONFIG || {};
const duration = Math.max(3, Math.min(30, Number(config.durationSeconds) || 8)) * 1000;
const connections = Math.max(1, Math.min(6, Number(config.connections) || 3));
let controller, samples = [], transferred = 0, chartColor = '#83ae43';
try { $('server-url').value = localStorage.getItem('speed-server') || config.serverUrl || ''; } catch { $('server-url').value = config.serverUrl || ''; }
if (!$('server-url').value && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && location.port) $('server-url').value = location.origin;
if (!$('server-url').value && location.port === '8080') $('server-url').value = location.origin;

function clock() {
  const now = new Date();
  $('local-time').textContent = new Intl.DateTimeFormat('sv-SE', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(now);
  $('local-time').dateTime = now.toISOString();
  const offset = -now.getTimezoneOffset();
  $('timezone').textContent = `${Intl.DateTimeFormat().resolvedOptions().timeZone} · UTC${offset >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
}
clock(); setInterval(clock, 1000);
async function publicIP(version) {
  try {
    const response = await fetch(version === 4 ? 'https://api.ipify.org?format=json' : 'https://api6.ipify.org?format=json', { signal: AbortSignal.timeout(6000), cache:'no-store', credentials:'omit' });
    if (!response.ok) throw new Error('IP lookup failed');
    const { ip } = await response.json();
    if (version === 6 && !ip.includes(':')) throw new Error('No IPv6');
    $(`ipv${version}`).textContent = ip;
  } catch { $(`ipv${version}`).textContent = version === 6 ? '不可用或查询失败' : '暂时无法获取'; }
}
publicIP(4); publicIP(6);
function drawChart() {
  const canvas = $('chart'), width = canvas.clientWidth, height = canvas.clientHeight, ratio = devicePixelRatio || 1;
  canvas.width = width * ratio; canvas.height = height * ratio;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  ctx.strokeStyle = '#e9ede6'; ctx.lineWidth = 1;
  for (const y of [height * .25, height * .6, height - 1]) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(width,y); ctx.stroke(); }
  if (!samples.length) return;
  const max = Math.max(...samples, 1) * 1.15;
  const points = samples.map((v, i) => [i * width / Math.max(samples.length - 1, 1), height - 8 - v / max * (height - 20)]);
  ctx.beginPath(); ctx.moveTo(0,height); points.forEach(([x,y]) => ctx.lineTo(x,y)); ctx.lineTo(points.at(-1)[0],height); ctx.closePath(); ctx.fillStyle = chartColor === '#83ae43' ? '#eaf3dd' : '#f4e8df'; ctx.fill();
  ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.strokeStyle = chartColor; ctx.lineWidth = 2; ctx.stroke();
}
new ResizeObserver(drawChart).observe($('chart'));
function fitReadings() {
  const context = document.createElement('canvas').getContext('2d');
  for (const id of ['download', 'upload', 'ping']) {
    const element = $(id); element.style.fontSize = '';
    const style = getComputedStyle(element); context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const width = context.measureText(element.textContent).width, available = element.parentElement.clientWidth;
    if (width > available) element.style.fontSize = `${Math.floor(parseFloat(style.fontSize) * available / width)}px`;
  }
}
new ResizeObserver(fitReadings).observe(document.querySelector('.metrics'));
for (const id of ['download', 'upload', 'ping']) new MutationObserver(fitReadings).observe($(id), { childList:true });
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function format(value) { return value >= 1000 ? Math.round(value).toString() : value.toFixed(1); }
function endpoint(base, path) { const url = new URL(`${base}${path}`); url.searchParams.set('nonce', `${Date.now()}-${Math.random()}`); return url; }
async function request(base, path, signal) {
  const response = await fetch(endpoint(base, path), { cache:'no-store', credentials:'omit', signal });
  if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
  return response;
}
async function latency(base, signal) {
  status('正在测量 Ping 延迟…'); $('chart-label').textContent = '延迟采样 · ms'; samples = []; chartColor = '#83ae43';
  for (let i = 0; i < 11; i++) {
    const start = performance.now();
    const response = await request(base, '/api/ping', AbortSignal.any([signal, AbortSignal.timeout(5000)]));
    await response.arrayBuffer();
    if (i > 0) { samples.push(performance.now() - start); $('ping').textContent = format([...samples].sort((a,b) => a-b)[Math.floor(samples.length / 2)]); drawChart(); }
    $('progress').style.width = `${(i + 1) / 11 * 15}%`;
  }
  const jitter = samples.slice(1).reduce((sum, value, i) => sum + Math.abs(value - samples[i]), 0) / (samples.length - 1);
  $('jitter').textContent = `抖动 ${format(jitter)} ms`;
}
async function speed(base, mode, outerSignal) {
  const phase = new AbortController(), signal = AbortSignal.any([outerSignal, phase.signal]);
  let bytes = 0, lastBytes = 0, lastTime = performance.now();
  const start = lastTime;
  samples = []; chartColor = mode === 'download' ? '#83ae43' : '#c28b68';
  $('chart-label').textContent = `${mode === 'download' ? '下载' : '上传'}采样 · Mbps`;
  status(`正在测量${mode === 'download' ? '下载' : '上传'}速度…`);
  $(mode).closest('.metric').classList.add('active');
  const update = () => {
    const now = performance.now(), elapsed = now - start;
    $(mode).textContent = format(bytes * 8 / Math.max(elapsed, 1) / 1000);
    samples.push((bytes - lastBytes) * 8 / Math.max(now - lastTime, 1) / 1000); lastBytes = bytes; lastTime = now;
    $('transfer').textContent = `已传输 ${((transferred + bytes) / 1e6).toFixed(1)} MB`;
    $('progress').style.width = `${(mode === 'download' ? 15 : 55) + Math.min(elapsed / duration, 1) * 40}%`;
    drawChart();
  };
  const interval = setInterval(update, 250), timer = setTimeout(() => phase.abort(), duration);
  // Random data prevents transparent HTTP compression from inflating throughput.
  const payload = new Uint8Array(2 * 1024 * 1024);
  if (mode === 'upload') for (let i = 0; i < payload.length; i += 65536) crypto.getRandomValues(payload.subarray(i, i + 65536));
  const upload = () => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); let previous = 0;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { xhr.abort(); cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    if (signal.aborted) return abort();
    xhr.open('POST', endpoint(base, '/api/upload'));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => { bytes += Math.max(0, event.loaded - previous); previous = event.loaded; };
    xhr.onload = () => { cleanup(); if (xhr.status !== 200) return reject(new Error(`上传失败 HTTP ${xhr.status}`)); bytes += Math.max(0, payload.length - previous); resolve(); };
    xhr.onerror = () => { cleanup(); reject(new Error('上传连接失败，请检查 HTTPS、端口与跨域配置')); };
    signal.addEventListener('abort', abort, { once:true }); xhr.send(payload);
  });
  const worker = async () => {
    while (!signal.aborted) {
      if (mode === 'upload') { await upload(); continue; }
      const response = await request(base, '/api/download?bytes=33554432', signal);
      const reader = response.body.getReader();
      try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; } }
      finally { reader.releaseLock(); }
    }
  };
  let failure;
  try {
    await Promise.allSettled(Array.from({ length:connections }, async () => {
      try { await worker(); }
      catch (error) { if (!signal.aborted) { failure = error; phase.abort(); } }
    }));
  }
  finally { phase.abort(); clearInterval(interval); clearTimeout(timer); update(); transferred += bytes; $(mode).closest('.metric').classList.remove('active'); }
  outerSignal.throwIfAborted();
  if (failure) throw failure;
  if (!bytes) throw new Error('未收到测速数据，请检查服务器连接');
}
$('stop-button').addEventListener('click', () => controller?.abort());
$('server-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (controller) return;
  let base;
  try {
    const url = new URL($('server-url').value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请输入完整的 HTTP 或 HTTPS 服务器地址');
    if (location.protocol === 'https:' && url.protocol === 'http:') throw new Error('当前页面使用 HTTPS，测速服务器也需要 HTTPS');
    base = url.href.replace(/\/$/, '');
  } catch (error) { status(error.message || '服务器地址无效', true); return; }
  try { localStorage.setItem('speed-server', base); } catch {}
  controller = new AbortController(); const signal = controller.signal;
  $('start-button').hidden = true; $('stop-button').hidden = false; $('server-url').disabled = true;
  for (const id of ['download', 'upload', 'ping']) $(id).textContent = '--';
  $('progress').style.width = '0%'; transferred = 0; $('transfer').textContent = '已传输 0 MB'; $('jitter').textContent = '抖动 -- ms';
  const started = performance.now(), ticker = setInterval(() => { $('elapsed').textContent = `已用时 ${Math.floor((performance.now() - started) / 1000)} 秒`; }, 1000);
  try {
    status('正在连接服务器…');
    const info = await (await request(base, '/api/info', AbortSignal.any([signal, AbortSignal.timeout(7000)]))).json();
    if (info.service !== 'little-server-speed-test') throw new Error('该地址不是兼容的测速服务');
    $('connection-state').classList.add('connected'); $('connection-state').lastChild.textContent = '已连接';
    $('server-clock').textContent = `服务器时间 ${new Date(info.time).toLocaleString('zh-CN', { hour12:false, timeZone:info.timezone })} · ${info.timezone}`;
    await latency(base, signal); await speed(base, 'download', signal); await speed(base, 'upload', signal);
    $('progress').style.width = '100%'; status('测速完成');
    $('tested-at').textContent = `测试于 ${new Date().toLocaleTimeString('zh-CN', { hour12:false })}`;
  } catch (error) {
    if (signal.aborted) { status('测速已停止 · 当前数值为未完成采样'); $('tested-at').textContent = '测试未完成'; }
    else { status(error instanceof TypeError ? '连接失败，请检查地址、HTTPS、端口映射和跨域设置' : error.message, true); $('connection-state').classList.remove('connected'); $('connection-state').lastChild.textContent = '连接失败'; $('tested-at').textContent = '测试未完成'; }
  } finally {
    clearInterval(ticker); $('elapsed').textContent = `用时 ${((performance.now() - started) / 1000).toFixed(1)} 秒`;
    controller = null; $('start-button').hidden = false; $('stop-button').hidden = true; $('server-url').disabled = false;
  }
});
