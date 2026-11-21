/* خادم ساحة سيف: ملفات ثابتة + واجهة /api/* + مسارات الصحة. عملية ويب واحدة. */
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { loadConfig } from './config.mjs';
import { log } from './log.mjs';
import { handle } from './core.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8' };
const SEC = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' };

export function createServer(cfg, db) {
  let shuttingDown = false, inflight = 0;

  const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...SEC, ...headers }); res.end(body); };
  const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });

  function readBody(req, max = 200 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > max) { reject(Object.assign(new Error('too large'), { code: 'E_BODY' })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
    let p;
    try { p = decodeURIComponent(pathname); } catch (e) { return send(res, 400, 'Bad Request'); }
    if (p.includes('\0')) return send(res, 400, 'Bad Request');
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(PUBLIC, p));
    if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) return send(res, 403, 'Forbidden');
    let st; try { st = statSync(file); } catch (e) { return send(res, 404, 'Not Found'); }
    if (!st.isFile()) return send(res, 404, 'Not Found');
    const ext = extname(file).toLowerCase();
    const html = ext === '.html';
    res.writeHead(200, { ...SEC, 'content-type': MIME[ext] || 'application/octet-stream', 'content-length': st.size, 'last-modified': st.mtime.toUTCString(),
      'cache-control': html ? 'no-cache' : 'public, max-age=3600' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now(); inflight++;
    res.on('close', () => { inflight--; });
    let pathname = '/';
    try {
      const url = new URL(req.url, 'http://localhost'); pathname = url.pathname;
      if (pathname === '/livez') return send(res, 200, 'ok', { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      if (pathname === '/readyz') return shuttingDown ? send(res, 503, 'shutting down', { 'content-type': 'text/plain', 'cache-control': 'no-store' }) : send(res, 200, 'ok', { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        let body = null;
        if (req.method === 'POST') { try { body = JSON.parse(await readBody(req)); } catch (e) { if (e.code === 'E_BODY') return sendJson(res, 413, { ok: false }); body = null; } }
        const out = await handle(db, { method: req.method, path: pathname.replace(/^\/api/, '') || '/', body, pin: String(req.headers['x-admin-pin'] || '') }, { ADMIN_PIN: cfg.adminPin, MAX_ROUNDS_PER_DAY: cfg.maxRoundsPerDay });
        /* الرابط العام يأتي من APP_URL إن وُجد (يتقدّم على القيمة المخزّنة من لوحة الإدارة) */
        if (cfg.appUrl && pathname === '/api/data' && out.status === 200 && out.body && out.body.cfg) out.body.cfg.publicUrl = cfg.appUrl;
        return sendJson(res, out.status, out.body);
      }
      /* الموشن الكبير يُخدَّم من تخزين S3 (متغير S3_PUBLIC_URL) ولا يُدمج في الصورة */
      if (/^\/video\/[\w.-]+\.mp4$/.test(pathname)) {
        if (cfg.s3PublicUrl) return send(res, 302, '', { location: cfg.s3PublicUrl + pathname, 'cache-control': 'public, max-age=300' });
        return send(res, 404, 'Not Found');
      }
      return serveStatic(req, res, pathname);
    } catch (e) {
      log.error('request failed', { path: pathname, code: e.code || 'unknown', ...(cfg.debug ? { stack: String(e.stack) } : {}) });
      if (!res.headersSent) return sendJson(res, 500, { ok: false, error: 'server' });
      res.destroy();
    } finally {
      if (pathname !== '/livez' && pathname !== '/readyz') log.info('request', { method: req.method, path: pathname, status: res.statusCode, ms: Date.now() - t0 });
    }
  });
  server.keepAliveTimeout = 65000; server.headersTimeout = 66000;

  /* إيقاف تدريجي: يفشل readyz، ثم يكمل الطلبات الجارية خلال مهلة، ثم يخرج */
  async function shutdown(signal) {
    if (shuttingDown) return; shuttingDown = true;
    log.info('shutdown started', { signal });
    const force = setTimeout(() => { log.warn('shutdown forced', { inflight }); process.exit(1); }, cfg.shutdownGraceMs); force.unref();
    server.close(async () => { try { await db.close(); } catch (e) { /* مغلق */ } log.info('shutdown complete'); clearTimeout(force); process.exit(0); });
    server.closeIdleConnections && server.closeIdleConnections();
  }
  return { server, shutdown, isShuttingDown: () => shuttingDown };
}
