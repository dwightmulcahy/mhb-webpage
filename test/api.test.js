const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, PASSWORD } = require('./helpers');

let s;
before(async () => { s = await startServer(); });
after(() => s.stop());

const put = (route, body, headers = s.auth()) =>
  s.req('/api/' + route, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('stores are seeded on first start', () => {
  for (const f of ['taplist.json', 'events.json', 'announcements.json', 'merch.json', 'places.json', 'social.json', 'releases.json', 'mobiletap.json']) {
    assert.ok(fs.existsSync(path.join(s.dataDir, f)), f);
  }
});

test('GET stores is public and not cached', async () => {
  for (const r of ['taps', 'events', 'announcements', 'merch', 'places', 'social', 'releases', 'mobiletap', 'schemas']) {
    const res = await s.req('/api/' + r);
    assert.equal(res.status, 200, r);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    await res.json();
  }
});

test('login', async () => {
  assert.equal((await s.req('/api/login', { method: 'POST', headers: { Authorization: 'Bearer ' + PASSWORD } })).status, 200, 'legacy bearer-password login');
  assert.equal((await s.req('/api/login', { method: 'GET' })).status, 405);
});

test('PUT requires auth', async () => {
  const r = await put('events', { events: [] }, { Authorization: 'Bearer nope' });
  assert.equal(r.status, 401);
});

test('events: valid save is normalized, sorted and persisted', async () => {
  const r = await put('events', { events: [
    { title: '  Later ', date: '2099-02-01', start: '18:00', bogus: 'x' },
    { title: 'Sooner', date: '2099-01-01', id: 'keep-me' },
  ] });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual(d.events.map((e) => e.title), ['Sooner', 'Later']);
  assert.equal(d.events[0].id, 'keep-me');
  assert.ok(d.events[1].id, 'id generated');
  assert.equal(d.events[1].bogus, undefined, 'unknown fields dropped');
  assert.ok(d.updated);
  const disk = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'events.json'), 'utf8'));
  assert.deepEqual(disk, d);
  assert.match(await (await s.req('/')).text(), /Sooner/, 'rendered on the home page');
});

test('events: validation errors', async () => {
  for (const [body, msg] of [
    [{}, /missing "events"/],
    [{ events: [{ date: '2099-01-01' }] }, /Title is required/],
    [{ events: [{ title: 'x', date: 'tomorrow' }] }, /must be a date/],
    [{ events: [{ title: 'x', date: '2099-01-01', link: 'javascript:alert(1)' }] }, /must start with http/],
    [{ events: [{ title: 'x', date: '2099-01-01', image: 'https://evil/x.jpg' }] }, /uploaded image/],
    [{ events: Array.from({ length: 101 }, () => ({ title: 'x', date: '2099-01-01' })) }, /too many/],
  ]) {
    const r = await put('events', body);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, msg);
  }
});

test('mobiletap settings: phone digits only, unknown pick -> random', async () => {
  const cur = await (await s.req('/api/mobiletap')).json();
  let r = await put('mobiletap', { ...cur, phone: '+506 8733-7046', pick: 'does-not-exist' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.phone, '50687337046');
  assert.equal(d.pick, 'random');
  r = await put('mobiletap', { ...cur, phone: '123' });
  assert.equal(r.status, 400);
});

test('taps: TapListBuilder validation', async () => {
  const cur = await (await s.req('/api/taps')).json();
  assert.equal((await put('taps', { items: [{ type: 'nope' }] })).status, 400);
  assert.equal((await put('taps', { items: [{ type: 'beer' }] })).status, 400);
  assert.equal((await put('taps', [])).status, 400);
  const r = await put('taps', cur);
  assert.equal(r.status, 200);
  assert.ok((await r.json()).publishedAt);
});

test('invalid JSON body is 400', async () => {
  const r = await s.req('/api/events', { method: 'PUT', headers: s.auth({ 'Content-Type': 'application/json' }), body: '{nope' });
  assert.equal(r.status, 400);
});

test('upload: type + magic bytes checked, file served', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  let r = await s.req('/api/upload', { method: 'POST', headers: s.auth({ 'Content-Type': 'image/png' }), body: png });
  assert.equal(r.status, 200);
  const { path: p } = await r.json();
  assert.match(p, /^\/uploads\/\d+-[0-9a-f]{8}\.png$/);
  const got = await s.req(p);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');

  r = await s.req('/api/upload', { method: 'POST', headers: s.auth({ 'Content-Type': 'image/png' }), body: '<script>alert(1)</script>' });
  assert.equal(r.status, 415);
  r = await s.req('/api/upload', { method: 'POST', headers: s.auth({ 'Content-Type': 'text/html' }), body: png });
  assert.equal(r.status, 415);
  r = await s.req('/api/upload', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
  assert.equal(r.status, 401);
});

test('unknown API route is 404', async () => {
  assert.equal((await s.req('/api/nope')).status, 404);
});

test('brute-force lockout after 10 wrong passwords (per client IP)', async () => {
  const ip = { 'CF-Connecting-IP': '203.0.113.77' };
  for (let i = 0; i < 10; i++) {
    assert.equal((await s.req('/api/login', { method: 'POST', headers: { Authorization: 'Bearer wrong', ...ip } })).status, 401);
  }
  assert.equal((await s.req('/api/login', { method: 'POST', headers: { Authorization: 'Bearer wrong', ...ip } })).status, 429);
  assert.equal((await s.req('/api/login', { method: 'POST', headers: { Authorization: 'Bearer ' + PASSWORD, ...ip } })).status, 429, 'even the right password while locked');
  assert.equal((await s.req('/api/login', { method: 'POST', headers: { Authorization: 'Bearer ' + PASSWORD, 'CF-Connecting-IP': '203.0.113.78' } })).status, 200, 'other IPs unaffected');
});

test('announcements: shown only while active and in date range', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date());
  const r = await put('announcements', { announcements: [
    { title: 'Closed for Christmas', body: 'Line one\nline <two>', kind: 'closure', until: '2099-12-26' },
    { title: 'Hidden one', active: false },
    { title: 'Expired one', until: '2000-01-01' },
    { title: 'Future one', from: '2099-01-01' },
    { title: 'Bad kind', kind: 'nope', from: today },
  ] });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.announcements[0].active, true, 'active defaults to true');
  assert.equal(d.announcements[4].kind, 'news', 'unknown kind falls back');
  const html = await (await s.req('/')).text();
  assert.match(html, /<section class="announce" id="news" aria-labelledby/);
  assert.match(html, /Closed for Christmas/);
  assert.match(html, /Line one<br>line &lt;two&gt;/, 'escaped, newlines kept');
  assert.match(html, /Bad kind/);
  for (const t of ['Hidden one', 'Expired one', 'Future one']) assert.doesNotMatch(html.split('id="annList"')[1].split('</section>')[0], new RegExp(t), t);
  const es = await (await s.req('/es')).text();
  assert.match(es, /Cambio de horario/);
});

test('announcements: section hidden when none, until before from rejected', async () => {
  assert.equal((await put('announcements', { announcements: [{ title: 'x', from: '2099-02-01', until: '2099-01-01' }] })).status, 400);
  assert.equal((await put('announcements', { announcements: [{ title: '' }] })).status, 400);
  assert.equal((await put('announcements', { announcements: [] })).status, 200);
  assert.match(await (await s.req('/')).text(), /<section class="announce" id="news" hidden/);
  assert.equal((await put('announcements', { announcements: [] }, { Authorization: 'Bearer nope' })).status, 401);
});
