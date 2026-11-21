/* منطق الخادم المشترك لساحة سيف (مستقل عن التخزين). يستعمله api.mjs مع Netlify Blobs. */
const GAMES = ['puzzle', 'network', 'b1', 'b2', 'b3', 'b4', 'b5', 'vuln', 'defend', 'forensic', 'deepfake', 'ml', 'pattern'];
const TIERS = ['gold', 'silver', 'bronze'];
const ADMIN_OPS = new Set(['hide', 'close', 'cfg', 'reset']);
/* كل الجولات في صف واحد يُعاد كتابته مع كل عملية ويُرسل كاملًا لكل شاشة، و«add» بلا رمز إدارة، فبلا سقف يكبر الصف بلا حد */
export const DEFAULT_MAX_ROUNDS_PER_DAY = 2000;
const dayOf = ts => new Date(ts + 3 * 3600e3).toISOString().slice(0, 10);   // توقيت الرياض

export function cleanName(n) {
  if (n == null) return null;
  const s = String(n).replace(/[\u0000-\u001f\u007f<>]/g, '').split(' ').filter(Boolean).join(' ');
  return s.length < 2 || s.length > 24 ? null : s;
}

export const emptyData = () => ({ rounds: [], cfg: { publicUrl: '', closedDays: {}, crowd: false } });

function view(d, admin) {
  return {
    rounds: d.rounds.map(({ phone, ...r }) => r),
    cfg: d.cfg, now: Date.now(),
  };
}

function applyOp(d, op, admin, now, quota) {
  if (!op || typeof op !== 'object') return 'bad';
  if (ADMIN_OPS.has(op.t) && !admin) return 'forbidden';
  switch (op.t) {
    case 'add': {
      const r = op.round || {};
      if (!/^[0-9a-f]{18}$/.test(r.id || '') || !GAMES.includes(r.game) || ![1, 2].includes(+r.screen) || !TIERS.includes(r.tier)) return 'bad';
      const max = Math.round(+r.max), score = Math.round(+r.score);
      if (!(max >= 1 && max <= 2000) || !(score >= 0 && score <= max)) return 'bad';
      if (d.rounds.some(x => x.id === r.id)) return 'dup';
      if (quota.left <= 0) return 'full';
      quota.left--;
      d.rounds.push({ id: r.id, day: dayOf(now), ts: now, name: '', game: r.game, screen: +r.screen, score, max, tier: r.tier, lv: [1, 2, 3].includes(+r.lv) ? +r.lv : 1, hidden: false });
      return 'ok';
    }
    case 'ident': {
      const r = d.rounds.find(x => x.id === op.id), n = cleanName(op.name);
      if (!r || !n || r.name) return 'bad';
      if (d.cfg.closedDays[r.day]) return 'closed';
      r.name = n; return 'ok';
    }
    case 'hide': { const r = d.rounds.find(x => x.id === op.id); if (!r) return 'bad'; r.hidden = !!op.hidden; return 'ok'; }
    case 'close': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(op.day || '')) return 'bad';
      if (op.close) d.cfg.closedDays[op.day] = now; else delete d.cfg.closedDays[op.day];
      return 'ok';
    }
    case 'cfg': {
      if (typeof op.publicUrl === 'string') { const u = op.publicUrl.trim(); if (u && !/^https?:\/\/\S+$/i.test(u)) return 'bad'; d.cfg.publicUrl = u.replace(/\/$/, ''); }
      if (typeof op.crowd === 'boolean') d.cfg.crowd = op.crowd;
      return 'ok';
    }
    case 'reset': d.rounds = []; d.cfg.closedDays = {}; return 'ok';
    default: return 'bad';
  }
}

/** db: { load(): Promise<data>, update(fn): Promise<any> } */
export async function handle(db, { method, path, body, pin }, env = {}) {
  const adminPin = String(env.ADMIN_PIN || ''), pinOk = adminPin.length >= 6, admin = pinOk && pin === adminPin;
  const json = (status, b) => ({ status, body: b });
  if (path === '/ping') return json(200, { ok: true, mode: 'remote' });
  if (path === '/auth' && method === 'POST') return !pinOk ? json(503, { ok: false, reason: 'nopin' }) : admin || (body && body.pin === adminPin) ? json(200, { ok: true }) : json(401, { ok: false });
  if (path === '/data' && method === 'GET') return json(200, view(await db.load(), admin));
  if (path === '/ops' && method === 'POST') {
    const ops = body && Array.isArray(body.ops) ? body.ops.slice(0, 50) : null;
    if (!ops) return json(400, { ok: false });
    const perDay = Number(env.MAX_ROUNDS_PER_DAY) > 0 ? Number(env.MAX_ROUNDS_PER_DAY) : DEFAULT_MAX_ROUNDS_PER_DAY;
    const results = await db.update(d => {
      const now = Date.now(), today = dayOf(now);
      const quota = { left: perDay - d.rounds.filter(x => x.day === today).length };
      return ops.map(op => applyOp(d, op, admin, now, quota));
    });
    return json(200, { ok: true, results });
  }
  return json(404, { ok: false });
}
