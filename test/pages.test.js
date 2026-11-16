const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer } = require('./helpers');

let s;
before(async () => { s = await startServer(); });
after(() => s.stop());

test('home page renders server-side in English', async () => {
  const r = await s.req('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(r.headers.get('content-language'), 'en');
  const html = await r.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/">/);
  assert.doesNotMatch(html, /<!--@\w+-->/, 'all template placeholders filled');
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld['@graph'][0]['@type'], 'Brewery');
});

test('Spanish page', async () => {
  const r = await s.req('/es');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-language'), 'es');
  const html = await r.text();
  assert.match(html, /<html lang="es">/);
  assert.match(html, /id="langBtn" href="\/" hreflang="en"/);
});

test('security headers on HTML', async () => {
  const r = await s.req('/');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(r.headers.get('strict-transport-security'), null, 'no HSTS over plain http');
  const https = await s.req('/', { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.match(https.headers.get('strict-transport-security'), /max-age=31536000/);
});

test('CSP allows exactly the inline scripts on /admin', async () => {
  const r = await s.req('/admin');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  const html = await r.text();
  const csp = r.headers.get('content-security-policy');
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc=/.test(m[1]) && m[2]);
  assert.ok(inline.length > 0);
  for (const m of inline) {
    const h = crypto.createHash('sha256').update(m[2]).digest('base64');
    assert.ok(csp.includes(`'sha256-${h}'`), 'inline script hash in CSP');
  }
});

test('assets get cache-busting versions and immutable caching', async () => {
  const html = await (await s.req('/')).text();
  const css = html.match(/href="(\/styles\.css\?v=\w+)"/)[1];
  const r = await s.req(css);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /immutable/);
  const etag = r.headers.get('etag');
  const again = await s.req(css, { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304);
});

test('gzip for large text responses', async () => {
  const r = await s.req('/styles.css', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(r.headers.get('content-encoding'), 'gzip');
});

test('robots, sitemap, manifest, security.txt, version', async () => {
  const robots = await (await s.req('/robots.txt')).text();
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
  const sm = await (await s.req('/sitemap.xml')).text();
  assert.match(sm, /<loc>http:\/\/127\.0\.0\.1:\d+\/es<\/loc>/);
  assert.match(sm, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  const mf = await (await s.req('/manifest.webmanifest')).json();
  assert.equal(mf.short_name, 'Monkey Head');
  const sec = await (await s.req('/.well-known/security.txt')).text();
  assert.match(sec, /^Contact: /m);
  assert.match(sec, /^Expires: \d{4}-/m);
  const v = await (await s.req('/api/version')).json();
  assert.equal(v.version, 'dev');
});

test('path traversal is refused', async () => {
  for (const p of ['/..%2fserver.js', '/%2e%2e/server.js', '/uploads/..%2f..%2fserver.js']) {
    const r = await s.req(p);
    assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.doesNotMatch(await r.text(), /createServer/);
  }
});

test('non-GET on static paths is 405', async () => {
  assert.equal((await s.req('/', { method: 'POST' })).status, 405);
});

test('malformed URL is 400', async () => {
  assert.equal((await s.req('/%E0%A4%A')).status, 400);
});
