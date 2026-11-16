const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, PASSWORD } = require('./helpers');

const login = (s, pw, headers = {}) => s.req('/api/login', { method: 'POST', headers: { Authorization: 'Bearer ' + pw, ...headers } });

test('forwarded IP headers are ignored from untrusted peers (no lockout bypass)', async () => {
  const s = await startServer({ TRUSTED_PROXIES: '10.9.9.9' }); // the test client (127.0.0.1) is NOT a trusted proxy
  try {
    for (let i = 0; i < 10; i++) await login(s, 'wrong', { 'CF-Connecting-IP': `198.51.100.${i}`, 'X-Forwarded-For': `198.51.100.${i}` });
    assert.equal((await login(s, 'wrong', { 'CF-Connecting-IP': '198.51.100.200' })).status, 429, 'rotating the header does not help');
  } finally { await s.stop(); }
});

test('forwarded IP headers are honoured from trusted peers', async () => {
  const s = await startServer(); // default trusts loopback/private
  try {
    for (let i = 0; i < 10; i++) await login(s, 'wrong', { 'CF-Connecting-IP': '198.51.100.1' });
    assert.equal((await login(s, 'wrong', { 'CF-Connecting-IP': '198.51.100.1' })).status, 429);
    assert.equal((await login(s, 'wrong', { 'CF-Connecting-IP': '198.51.100.2' })).status, 401, 'separate visitor');
  } finally { await s.stop(); }
});

test('lockout survives a restart', async () => {
  const a = await startServer();
  const ip = { 'CF-Connecting-IP': '198.51.100.9' };
  for (let i = 0; i < 10; i++) await login(a, 'wrong', ip);
  await new Promise((r) => setTimeout(r, 700)); // debounced save
  await a.stop({ keepData: true });
  const b = await startServer({ DATA_DIR: a.dataDir });
  try {
    assert.equal((await login(b, PASSWORD, ip)).status, 429);
  } finally { await b.stop(); }
});
