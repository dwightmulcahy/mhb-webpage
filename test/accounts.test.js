const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');

let s;
before(async () => { s = await startServer(); });
after(() => s.stop());

const json = (method, body, headers) => ({ method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const login = async (user, password) => {
  const r = await s.req('/api/login', json('POST', { user, password }));
  return { status: r.status, ...(await r.json()) };
};
const as = (token) => ({ Authorization: 'Bearer ' + token });
const putUsers = (users, token = s.token()) => s.req('/api/users', json('PUT', { users }, as(token)));

test('built-in admin logs in with a session token; the password is not a token', async () => {
  const me = await (await s.req('/api/me', { headers: s.auth() })).json();
  assert.deepEqual(me, { user: 'admin', role: 'owner', builtin: true });
  const r = await s.req('/api/events', json('PUT', { events: [] }, { Authorization: 'Bearer test-password-123' }));
  assert.equal(r.status, 401, 'raw password no longer works on data endpoints');
});

test('owner adds staff; editor can edit lists but not manage accounts', async () => {
  let r = await putUsers([{ name: 'Maria', role: 'editor', password: 'maria-pass-1234' }, { name: 'Jose', role: 'owner', password: 'jose-pass-12345' }]);
  assert.equal(r.status, 200);
  const list = await r.json();
  assert.deepEqual(list.users.map((u) => [u.name, u.role]), [['Maria', 'editor'], ['Jose', 'owner']]);
  assert.ok(!JSON.stringify(list).includes('scrypt'), 'hashes never leave the server');
  const disk = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'users.json'), 'utf8'));
  assert.match(disk.users[0].hash, /^scrypt\$/);
  assert.ok(!JSON.stringify(disk).includes('maria-pass-1234'));

  const maria = await login('maria', 'maria-pass-1234'); // name is case-insensitive
  assert.equal(maria.status, 200);
  assert.equal(maria.user, 'Maria');
  assert.equal(maria.role, 'editor');
  r = await s.req('/api/events', json('PUT', { events: [{ title: 'By Maria', date: '2099-03-03' }] }, as(maria.token)));
  assert.equal(r.status, 200);
  assert.equal((await s.req('/api/users', { headers: as(maria.token) })).status, 403);
  assert.equal((await s.req('/api/audit', { headers: as(maria.token) })).status, 403);
  assert.equal((await login('Maria', 'wrong-password-x')).status, 401);
  assert.equal((await login('Nobody', 'whatever-123456')).status, 401);
});

test('audit log records who did what', async () => {
  const log = await (await s.req('/api/audit?limit=50', { headers: s.auth() })).json();
  const save = log.find((e) => e.action === 'save' && e.user === 'Maria');
  assert.ok(save, 'save by Maria');
  assert.equal(save.store, 'events');
  assert.match(save.detail, /1 item\(s\)/);
  assert.ok(log.find((e) => e.action === 'users' && /added Maria \(editor\)/.test(e.detail)));
  assert.ok(log.find((e) => e.action === 'login_failed' && e.user === 'Nobody'));
  assert.ok(new Date(log[0].time) >= new Date(log[log.length - 1].time), 'newest first');
  assert.match(s.logs(), /"user":"Maria"/, 'request log names the user');
});

test('changing role or removing an account ends their sessions', async () => {
  const maria = await login('Maria', 'maria-pass-1234');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await putUsers([{ name: 'Maria', role: 'owner' }, { name: 'Jose', role: 'owner' }])).status, 200);
  assert.equal((await s.req('/api/me', { headers: as(maria.token) })).status, 401);
  const again = await login('Maria', 'maria-pass-1234');
  assert.equal(again.role, 'owner');
  assert.equal((await putUsers([{ name: 'Jose', role: 'owner' }])).status, 200);
  assert.equal((await s.req('/api/me', { headers: as(again.token) })).status, 401);
  assert.equal((await login('Maria', 'maria-pass-1234')).status, 401);
});

test('change my password: old sessions end, new token works', async () => {
  const a = await login('Jose', 'jose-pass-12345');
  const b = await login('Jose', 'jose-pass-12345');
  await new Promise((r) => setTimeout(r, 5));
  let r = await s.req('/api/me', json('PUT', { current: 'nope', password: 'jose-new-pass-1' }, as(a.token)));
  assert.equal(r.status, 400);
  r = await s.req('/api/me', json('PUT', { current: 'jose-pass-12345', password: 'short' }, as(a.token)));
  assert.equal(r.status, 400);
  r = await s.req('/api/me', json('PUT', { current: 'jose-pass-12345', password: 'jose-new-pass-1' }, as(a.token)));
  assert.equal(r.status, 200);
  const { token } = await r.json();
  assert.equal((await s.req('/api/me', { headers: as(b.token) })).status, 401, 'other session ended');
  assert.equal((await s.req('/api/me', { headers: as(token) })).status, 200);
  assert.equal((await login('Jose', 'jose-new-pass-1')).status, 200);
});

test('logout revokes the token', async () => {
  const j = await login('Jose', 'jose-new-pass-1');
  assert.equal((await s.req('/api/logout', { method: 'POST', headers: as(j.token) })).status, 200);
  assert.equal((await s.req('/api/me', { headers: as(j.token) })).status, 401);
});

test('validation of account lists', async () => {
  for (const [users, msg] of [
    [[{ name: 'X', role: 'editor', password: 'long-enough-pw' }], /2–30/],
    [[{ name: 'Ana', role: 'boss', password: 'long-enough-pw' }], /owner or editor/],
    [[{ name: 'Ana', role: 'editor' }], /need a password/],
    [[{ name: 'Ana', role: 'editor', password: 'short' }], /at least 10/],
    [[{ name: 'Ana', role: 'editor', password: 'long-enough-pw' }, { name: 'ana', role: 'owner', password: 'long-enough-pw' }], /duplicate/],
  ]) {
    const r = await putUsers(users);
    assert.equal(r.status, 400, JSON.stringify(users));
    assert.match((await r.json()).error, msg);
  }
});

test('sessions survive a restart', async () => {
  const t = s.token();
  await new Promise((r) => setTimeout(r, 1200)); // debounced save
  await s.stop({ keepData: true });
  s = await startServer({ DATA_DIR: s.dataDir });
  assert.equal((await s.req('/api/me', { headers: as(t) })).status, 200);
});
