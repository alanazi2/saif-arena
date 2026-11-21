import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, emptyData, cleanName } from '../src/core.mjs';

const memDb = () => { let d = emptyData(); return { load: async () => d, update: async fn => fn(d), get data() { return d; } }; };
const ID = '0123456789abcdef01';
const add = { t: 'add', round: { id: ID, game: 'puzzle', screen: 1, score: 900, max: 1000, tier: 'gold', lv: 2 } };

test('cleanName يقبل اسمًا صحيحًا ويرفض القصير والطويل', () => {
  assert.equal(cleanName('سارة'), 'سارة');
  assert.equal(cleanName('ا'), null);
  assert.equal(cleanName('x'.repeat(25)), null);
});

test('جولة ثم تسجيل اسم بدون أي رقم جوال', async () => {
  const db = memDb();
  const r = await handle(db, { method: 'POST', path: '/ops', body: { ops: [add, { t: 'ident', id: ID, name: 'سارة' }] } }, { ADMIN_PIN: 'secret-123' });
  assert.deepEqual(r.body.results, ['ok', 'ok']);
  const data = await handle(db, { method: 'GET', path: '/data' }, { ADMIN_PIN: 'secret-123' });
  assert.equal(data.body.rounds[0].name, 'سارة');
  assert.ok(!('phone' in data.body.rounds[0]));
});

test('رمز الإدارة: لا قيمة افتراضية ويُقفل إن كان قصيرًا', async () => {
  const db = memDb();
  assert.equal((await handle(db, { method: 'POST', path: '/auth', body: { pin: '2026' } }, {})).status, 503);
  assert.equal((await handle(db, { method: 'POST', path: '/auth', body: { pin: '2026' } }, { ADMIN_PIN: '2026' })).status, 503);
  assert.equal((await handle(db, { method: 'POST', path: '/auth', body: { pin: 'bad' } }, { ADMIN_PIN: 'secret-123' })).status, 401);
  assert.equal((await handle(db, { method: 'POST', path: '/auth', body: { pin: 'secret-123' } }, { ADMIN_PIN: 'secret-123' })).status, 200);
});

test('عمليات الإدارة ممنوعة بدون رمز', async () => {
  const db = memDb();
  const r = await handle(db, { method: 'POST', path: '/ops', body: { ops: [{ t: 'reset' }] } }, { ADMIN_PIN: 'secret-123' });
  assert.deepEqual(r.body.results, ['forbidden']);
});

test('جولة مكررة أو بدرجة خارج النطاق تُرفض', async () => {
  const db = memDb();
  await handle(db, { method: 'POST', path: '/ops', body: { ops: [add] } }, {});
  const dup = await handle(db, { method: 'POST', path: '/ops', body: { ops: [add] } }, {});
  assert.deepEqual(dup.body.results, ['dup']);
  const bad = await handle(db, { method: 'POST', path: '/ops', body: { ops: [{ t: 'add', round: { ...add.round, id: 'aaaaaaaaaaaaaaaaaa', score: 5000 } }] } }, {});
  assert.deepEqual(bad.body.results, ['bad']);
});

test('تُرفض الجولات بعد بلوغ سقف اليوم', async () => {
  const db = memDb();
  const round = id => ({ t: 'add', round: { ...add.round, id } });
  const ops = [round('a'.repeat(18)), round('b'.repeat(18)), round('c'.repeat(18))];
  const r = await handle(db, { method: 'POST', path: '/ops', body: { ops } }, { MAX_ROUNDS_PER_DAY: '2' });
  assert.deepEqual(r.body.results, ['ok', 'ok', 'full']);
});
