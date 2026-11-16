const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let s;
before(async () => { s = await startServer(); });
after(() => s.stop());

test('privacy page served and linked from the footer in both languages', async () => {
  const r = await s.req('/privacy');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /id="en" lang="en"/);
  assert.match(html, /id="es" lang="es"/);
  assert.match(await (await s.req('/')).text(), /<a href="\/privacy" data-i18n="foot.privacy">Privacy<\/a>/);
  assert.match(await (await s.req('/es')).text(), /<a href="\/privacy" data-i18n="foot.privacy">Privacidad<\/a>/);
  const es = await s.req('/es/privacy');
  assert.equal(es.status, 301);
  assert.equal(es.headers.get('location'), '/privacy#es');
  assert.match(await (await s.req('/sitemap.xml')).text(), /\/privacy<\/loc>/);
});
