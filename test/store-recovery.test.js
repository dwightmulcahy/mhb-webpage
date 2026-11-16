const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, ROOT } = require('./helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mhb-store-'));

test('corrupt store with no backup: restored from seed, bad file kept, site up', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'events.json'), '{"events": [ truncated');
  const s = await startServer({ DATA_DIR: dir });
  try {
    assert.equal((await s.req('/')).status, 200);
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/events.json'), 'utf8'));
    assert.deepEqual(await (await s.req('/api/events')).json(), seed);
    assert.ok(fs.readdirSync(dir).some((f) => /^events\.json\.corrupt-/.test(f)), 'bad file set aside');
    assert.match(s.logs(), /events\.json was unreadable; restored from seed/);
  } finally { await s.stop(); }
});

test('corrupt store restored from .bak', async () => {
  const dir = tmp();
  const seedEvents = { updated: 'x', events: [{ id: 'a', title: 'From backup', date: '2099-01-01' }] };
  fs.writeFileSync(path.join(dir, 'events.json'), '');
  fs.writeFileSync(path.join(dir, 'events.json.bak'), JSON.stringify(seedEvents));
  const s = await startServer({ DATA_DIR: dir });
  try {
    assert.equal((await (await s.req('/api/events')).json()).events[0].title, 'From backup');
    assert.match(s.logs(), /restored from backup/);
  } finally { await s.stop(); }
});

test('each save keeps the previous version as .bak', async () => {
  const s = await startServer();
  try {
    const put = (events) => s.req('/api/events', { method: 'PUT', headers: s.auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ events }) });
    assert.equal((await put([{ title: 'First', date: '2099-01-01' }])).status, 200);
    assert.equal((await put([{ title: 'Second', date: '2099-01-02' }])).status, 200);
    const bak = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'events.json.bak'), 'utf8'));
    assert.equal(bak.events[0].title, 'First');
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'events.json.tmp')), 'no leftover temp file');
  } finally { await s.stop(); }
});
