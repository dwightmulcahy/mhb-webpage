const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./helpers');

test('unused old uploads go to trash; used, recent and trash-expired files handled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhb-up-'));
  const up = path.join(dir, 'uploads'), trash = path.join(dir, 'uploads-trash');
  fs.mkdirSync(up); fs.mkdirSync(trash);
  const old = new Date(Date.now() - 10 * 864e5), ancient = new Date(Date.now() - 40 * 864e5);
  for (const f of ['used.jpg', 'orphan.jpg', 'fresh.jpg']) fs.writeFileSync(path.join(up, f), 'x');
  fs.utimesSync(path.join(up, 'used.jpg'), old, old);
  fs.utimesSync(path.join(up, 'orphan.jpg'), old, old);
  fs.writeFileSync(path.join(trash, 'expired.jpg'), 'x');
  fs.utimesSync(path.join(trash, 'expired.jpg'), ancient, ancient);
  fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify({ events: [{ id: 'e', title: 'T', date: '2099-01-01', image: '/uploads/used.jpg' }] }));

  const s = await startServer({ DATA_DIR: dir });
  try {
    for (let i = 0; i < 80 && !fs.existsSync(path.join(trash, 'orphan.jpg')); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(path.join(up, 'used.jpg')), 'referenced file kept');
    assert.ok(fs.existsSync(path.join(up, 'fresh.jpg')), 'recent upload kept (may be in an unsaved draft)');
    assert.ok(fs.existsSync(path.join(trash, 'orphan.jpg')), 'unused old file moved to trash');
    assert.ok(!fs.existsSync(path.join(trash, 'expired.jpg')), 'trash older than 30 days purged');
    assert.equal((await s.req('/uploads/used.jpg')).status, 200);
    assert.equal((await s.req('/uploads/orphan.jpg')).status, 404, 'trash is not served');
    assert.match(s.logs(), /uploads cleanup: 1 unused moved to uploads-trash, 1 purged/);
  } finally { await s.stop(); }
});
