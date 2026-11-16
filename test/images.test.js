const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ROOT } = require('./helpers');

let s;
before(async () => { s = await startServer(); });
after(() => s.stop());

test('<picture> WebP sources are cache-busted and served as image/webp', async () => {
  const html = await (await s.req('/')).text();
  const srcs = [...html.matchAll(/<source type="image\/webp" srcset="([^"]+)">/g)].map((m) => m[1]);
  assert.equal(srcs.length, 4);
  for (const src of srcs) {
    assert.match(src, /\.webp\?v=\w+$/);
    const r = await s.req(src);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/webp');
    assert.match(r.headers.get('cache-control'), /immutable/);
  }
});

test('every image referenced by pages, renderers and seed data exists', () => {
  const text = ['public/index.html', 'public/site.js', 'public/taps.js', 'public/admin.html', 'public/board.html', 'server.js']
    .concat(fs.readdirSync(path.join(ROOT, 'seed')).map((f) => 'seed/' + f))
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const refs = new Set([...text.matchAll(/\/img\/[\w./-]+\.(?:png|jpe?g|webp|svg)/g)].map((m) => m[0]));
  assert.ok(refs.size > 5);
  for (const r of refs) assert.ok(fs.existsSync(path.join(ROOT, 'public', r)), `missing ${r}`);
});
