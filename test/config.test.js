const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, rawGet } = require('./helpers');

test('no ADMIN_PASSWORD: editing disabled', async () => {
  const s = await startServer({ ADMIN_PASSWORD: '' });
  try {
    assert.equal((await s.req('/api/login', { method: 'POST', headers: { Authorization: 'Bearer ' } })).status, 401);
    assert.match(s.logs(), /ADMIN_PASSWORD not set and no owner account/);
  } finally { await s.stop(); }
});

test('SITE_URL: canonical links and www redirect', async () => {
  const s = await startServer({ SITE_URL: 'https://www.example.com/' });
  try {
    const html = await (await s.req('/')).text();
    assert.match(html, /<link rel="canonical" href="https:\/\/www\.example\.com\/">/);
    const r = await rawGet(s.base, '/es?x=1', { Host: 'example.com' });
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, 'https://www.example.com/es?x=1');
    const http = await rawGet(s.base, '/', { Host: 'www.example.com', 'X-Forwarded-Proto': 'http' });
    assert.equal(http.status, 301);
    const lan = await rawGet(s.base, '/', { Host: '192.168.1.10:8088' });
    assert.equal(lan.status, 200, 'LAN access is left alone');
  } finally { await s.stop(); }
});

test('SECURITY_CONTACT is used in security.txt', async () => {
  const s = await startServer({ SECURITY_CONTACT: 'mailto:sec@example.com' });
  try {
    assert.match(await (await s.req('/security.txt')).text(), /^Contact: mailto:sec@example\.com$/m);
  } finally { await s.stop(); }
});
