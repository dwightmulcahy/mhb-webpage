const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');

let s;
before(async () => { s = await startServer({ HISTORY_KEEP: '5' }); });
after(() => s.stop());

const put = (events) => s.req('/api/events', { method: 'PUT', headers: s.auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ events }) });
const hist = (p = '') => s.req('/api/history/events' + p, { headers: s.auth() });

test('history starts with the current state', async () => {
  const list = await (await hist()).json();
  assert.equal(list.length, 1);
  assert.match(list[0].id, /^\d{8}T\d{9}Z/);
});

test('every save adds a version, newest first, capped at HISTORY_KEEP', async () => {
  for (let i = 1; i <= 7; i++) assert.equal((await put([{ title: `V${i}`, date: '2099-01-01' }])).status, 200);
  const list = await (await hist()).json();
  assert.equal(list.length, 5);
  assert.equal(fs.readdirSync(path.join(s.dataDir, 'history/events')).length, 5);
  const newest = await (await hist('/' + list[0].id)).json();
  assert.equal(newest.events[0].title, 'V7');
  const oldest = await (await hist('/' + list[4].id)).json();
  assert.equal(oldest.events[0].title, 'V3');
});

test('history needs auth and rejects bad ids/stores', async () => {
  assert.equal((await s.req('/api/history/events')).status, 401);
  assert.equal((await hist('/..%2f..%2fevents')).status, 404);
  assert.equal((await hist('/20990101T000000000Z')).status, 404);
  assert.equal((await s.req('/api/history/nope', { headers: s.auth() })).status, 404);
  assert.equal((await s.req('/api/history/events', { method: 'POST', headers: s.auth() })).status, 405);
});

test('backup bundles every store', async () => {
  assert.equal((await s.req('/api/backup')).status, 401);
  const r = await s.req('/api/backup', { headers: s.auth() });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="mhb-backup-\d{4}-\d{2}-\d{2}\.json"/);
  const b = await r.json();
  assert.equal(b.format, 'mhb-backup');
  assert.deepEqual(Object.keys(b.stores).sort(), ['events', 'merch', 'mobiletap', 'places', 'releases', 'social', 'taps']);
  assert.equal(b.stores.events.events[0].title, 'V7');
});
