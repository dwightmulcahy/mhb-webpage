// Monkey Head Brewing site — zero-dependency Node server
//   /            English page, pre-rendered (SEO)      /es   Spanish page
//   /api/taps    GET/PUT  taplist.json (TapListBuilder format)
//   /api/events  /api/merch  /api/places   GET/PUT   (schemas in public/schemas.js)
//   /api/upload  POST image -> DATA_DIR/uploads, served at /uploads/
//   /robots.txt  /sitemap.xml  /manifest.webmanifest  /healthz
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const vm = require('vm');

const PORT = parseInt(process.env.PORT || '8080', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// Build info baked into the image (see Dockerfile ARGs); "dev" when run from source.
const BUILD = {
  version: process.env.APP_VERSION || 'dev',
  commit: (process.env.GIT_SHA || 'unknown').slice(0, 7),
  built: process.env.BUILD_DATE || null,
  started: new Date().toISOString(),
};
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, ''); // e.g. https://monkeyheadbrewing.com
// security.txt contact (RFC 9116): a mailto:, https: or tel: URI
const SECURITY_CONTACT = process.env.SECURITY_CONTACT || 'tel:+506-8733-7046';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// One JSON object per line on stdout (docker logs) — the format logwatch.py parses.
const log = (level, fields) => process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), level, ...fields }) + '\n');
if (!ADMIN_PASSWORD) log('WARNING', { message: 'ADMIN_PASSWORD not set — editing disabled' });
if (!SITE_URL) log('WARNING', { message: 'SITE_URL not set — canonical/sitemap URLs will use the request Host header' });

// ---------- shared browser code, loaded for server-side rendering ----------
const ctx = vm.createContext({ console, Intl, Date, URLSearchParams });
ctx.window = ctx;
for (const f of ['schemas.js', 'i18n.js', 'taps.js', 'site.js']) {
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8'), ctx, { filename: f });
}
const { MHB_SCHEMAS: SCHEMAS, I18N, MHB, MHBSite } = ctx;

// ---------- data stores ----------
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const STORES = {
  taps: { file: 'taplist.json' },
  events: { file: 'events.json', schema: 'events' },
  merch: { file: 'merch.json', schema: 'merch' },
  places: { file: 'places.json', schema: 'places' },
  social: { file: 'social.json', schema: 'social' },
  releases: { file: 'releases.json', schema: 'releases' },
  mobiletap: { file: 'mobiletap.json', schema: 'mobiletap' },
};
for (const s of Object.values(STORES)) {
  s.path = path.join(DATA_DIR, s.file);
  if (!fs.existsSync(s.path)) fs.copyFileSync(path.join(__dirname, 'seed', s.file), s.path);
}
const cache = new Map(); // parsed JSON, keyed by store; invalidated on write
// A store that won't parse (disk full, hand edit, power cut) must not take the site down:
// set the bad file aside as <file>.corrupt-<time>, then fall back to the last good copy (<file>.bak, kept
// by writeStore) or the seed, and write that back so the next read is clean.
function loadStore(name) {
  const s = STORES[name];
  const tryRead = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } };
  let data = tryRead(s.path);
  if (data !== undefined && data !== null && typeof data === 'object') return data;
  const aside = `${s.path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try { fs.renameSync(s.path, aside); } catch { /* missing file: nothing to keep */ }
  let from = 'backup';
  data = tryRead(s.path + '.bak');
  if (!data || typeof data !== 'object') { from = 'seed'; data = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', s.file), 'utf8')); }
  writeAtomic(s.path, JSON.stringify(data, null, 2));
  log('ERROR', { message: `${s.file} was unreadable; restored from ${from}`, store: name, kept_as: path.basename(aside) });
  return data;
}
function readStore(name) {
  if (!cache.has(name)) cache.set(name, loadStore(name));
  return cache.get(name);
}
// Save: keep the previous good version as <file>.bak, then replace atomically.
function writeStore(name, data) {
  const s = STORES[name];
  try { fs.copyFileSync(s.path, s.path + '.bak'); } catch { /* first save */ }
  writeAtomic(s.path, JSON.stringify(data, null, 2));
  cache.set(name, data);
}

// ---------- validation ----------
const ITEM_TYPES = new Set(['beer', 'divider', 'text']);
function validateTaps(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('expected a TapListBuilder JSON object');
  if (!Array.isArray(input.items)) throw new Error('missing "items" array');
  if (input.items.length > 150) throw new Error('too many items');
  input.items.forEach((it, i) => {
    if (!it || !ITEM_TYPES.has(it.type)) throw new Error(`item ${i + 1}: unknown type "${it && it.type}"`);
    if (it.type === 'beer' && typeof it.name !== 'string') throw new Error(`item ${i + 1}: beer needs a name`);
    if (it.type === 'text' && !Array.isArray(it.columns)) throw new Error(`item ${i + 1}: text needs columns`);
  });
  if (input.settings && typeof input.settings !== 'object') throw new Error('"settings" must be an object');
  return { ...input, publishedAt: new Date().toISOString() };
}

const FIELD_RULES = {
  date: [/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)'],
  time: [/^(\d{2}:\d{2})?$/, 'must be a time (HH:MM)'],
  url: [/^(https?:\/\/\S+)?$/, 'must start with http:// or https://'],
  link: [/^((https?:\/\/|mailto:|tel:)\S+)?$/, 'must start with https://, mailto: or tel:'],
  image: [/^(\/(img|uploads)\/[\w./-]+)?$/, 'must be an uploaded image'],
};
function validateCollection(schemaName, input) {
  const sc = SCHEMAS[schemaName];
  const list = input && input[sc.listKey];
  if (!Array.isArray(list)) throw new Error(`missing "${sc.listKey}" array`);
  if (list.length > 100) throw new Error('too many entries');
  const out = list.map((row, i) => {
    const o = { id: typeof row.id === 'string' && /^[\w-]{1,40}$/.test(row.id) ? row.id : crypto.randomUUID().slice(0, 8) };
    const label = `${sc.label} ${i + 1}`;
    for (const f of sc.fields) {
      const v = row[f.k];
      if (f.type === 'bool') { o[f.k] = v === undefined ? !!f.def : !!v; continue; }
      let s = typeof v === 'string' ? v.trim().slice(0, f.type === 'textarea' ? 1000 : 300) : '';
      if (f.type === 'select' && !f.options.includes(s)) s = f.def || f.options[0];
      if (f.req && !s) throw new Error(`${label}: ${f.label} is required`);
      const rule = FIELD_RULES[f.type];
      if (rule && s && !rule[0].test(s)) throw new Error(`${label}: ${f.label} ${rule[1]}`);
      o[f.k] = s;
    }
    return o;
  });
  if (schemaName === 'events') out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  // Top-level settings for collections that have them (e.g. mobiletap)
  const settings = {};
  for (const f of sc.settings || []) {
    const v = input[f.k];
    if (f.type === 'bool') { settings[f.k] = v === undefined ? !!f.def : !!v; continue; }
    let s = typeof v === 'string' ? v.trim().slice(0, f.type === 'textarea' ? 1000 : 300) : '';
    if (f.type === 'pick' && s !== 'random' && !out.some((r) => r.id === s)) s = 'random';
    if (f.k === 'phone') { s = s.replace(/\D/g, ''); if (!/^\d{8,15}$/.test(s)) throw new Error(`${f.label}: 8–15 digits including country code`); }
    settings[f.k] = s || f.def || '';
  }
  return { updated: new Date().toISOString(), ...settings, [sc.listKey]: out };
}
for (const name of Object.keys(STORES)) readStore(name); // surface/repair bad files at startup, not on first visit
const validate = (name, body) => (name === 'taps' ? validateTaps(body) : validateCollection(STORES[name].schema, body));

// ---------- http helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff2': 'font/woff2',
};
const UPLOAD_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
// File signatures, so a renamed HTML/script can't be uploaded under an image Content-Type.
const MAGIC = {
  '.jpg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg)/;
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-site',
  'X-Permitted-Cross-Domain-Policies': 'none',
};
// Content-Security-Policy. Everything (fonts, JS, CSS, images) is self-hosted except the Cloudflare Web Analytics
// beacon Cloudflare injects; inline <script> blocks
// (admin, board) are allowed by SHA-256 hash, computed from the exact HTML being served.
const CSP_BASE = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' https://cloudflareinsights.com; " +
  "manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
const cspCache = new Map();
function cspFor(html) {
  const key = crypto.createHash('sha1').update(html).digest('hex');
  if (!cspCache.has(key)) {
    const hashes = [];
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc=/.test(m[1]) || /\btype="application\/(ld\+)?json"/.test(m[1]) || !m[2]) continue; // data blocks never execute
      hashes.push(`'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`);
    }
    if (cspCache.size > 50) cspCache.clear();
    cspCache.set(key, `${CSP_BASE}; script-src 'self' https://static.cloudflareinsights.com${hashes.length ? ' ' + hashes.join(' ') : ''}`);
  }
  return cspCache.get(key);
}
// HSTS only on responses the visitor received over https (never on LAN http access).
const hsts = (req) => (visitorProto(req) === 'https' ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {});

function send(req, res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const csp = type.startsWith('text/html') ? cspFor(buf.toString('utf8')) : "default-src 'none'; frame-ancestors 'none'";
  const headers = { 'Content-Type': type, ...BASE_HEADERS, 'Content-Security-Policy': csp, ...hsts(req), ...extra };
  if (buf.length > 1024 && COMPRESSIBLE.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    buf = zlib.gzipSync(buf); headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(code, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
const jsonErr = (req, res, code, msg) => send(req, res, code, JSON.stringify({ error: msg }));

// Brute-force guard: 10 wrong passwords per IP per 15 minutes, then 429 until the window resets.
const FAILS = new Map(); // ip -> { n, reset }
const FAIL_LIMIT = 10, FAIL_WINDOW = 15 * 60 * 1000;
function lockedOut(req) {
  const f = FAILS.get(clientIp(req));
  if (f && Date.now() > f.reset) { FAILS.delete(clientIp(req)); return false; }
  return !!f && f.n >= FAIL_LIMIT;
}
function noteFail(req) {
  const ip = clientIp(req), now = Date.now();
  const f = FAILS.get(ip);
  if (!f || now > f.reset) FAILS.set(ip, { n: 1, reset: now + FAIL_WINDOW }); else f.n++;
  if (FAILS.size > 10000) for (const [k, v] of FAILS) if (now > v.reset) FAILS.delete(k);
}
// Returns true, or sends 401/429 and returns false.
function requireAuth(req, res) {
  if (lockedOut(req)) { jsonErr(req, res, 429, 'too many attempts, try again later'); return false; }
  if (authorized(req)) { FAILS.delete(clientIp(req)); return true; }
  noteFail(req);
  jsonErr(req, res, 401, 'unauthorized');
  return false;
}

function authorized(req) {
  if (!ADMIN_PASSWORD) return false;
  const h = req.headers.authorization || '';
  const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
  const want = Buffer.from(ADMIN_PASSWORD);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
// Scheme the visitor actually used (Cloudflare sends cf-visitor; other proxies X-Forwarded-Proto)
function visitorProto(req) {
  const cf = req.headers['cf-visitor'];
  if (cf) { try { const v = JSON.parse(cf).scheme; if (v) return v; } catch { /* ignore */ } }
  // Anything that came through Cloudflare (cf-ray / cf-connecting-ip) is served to the public over https,
  // even if a proxy in between (tunnel, NAS reverse proxy) rewrote X-Forwarded-Proto to http.
  if (req.headers['cf-ray'] || req.headers['cf-connecting-ip']) return 'https';
  return (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
}
const reqHost = (req) => (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim().toLowerCase();
function baseUrl(req) {
  if (SITE_URL) return SITE_URL;
  return `${visitorProto(req)}://${reqHost(req)}`;
}
// With SITE_URL set, send the other www/non-www variant (and plain http on the public domain) to the one true address.
// LAN access (IP, homenas.lan, …) is left alone.
const CANON = SITE_URL ? new URL(SITE_URL) : null;
const ALT_HOST = CANON && (CANON.host.startsWith('www.') ? CANON.host.slice(4) : 'www.' + CANON.host);
function canonicalRedirect(req) {
  if (!CANON) return null;
  const host = reqHost(req);
  const wrongHost = host === ALT_HOST;
  const wrongProto = host === CANON.host && CANON.protocol === 'https:' && visitorProto(req) === 'http' && (req.headers['cf-visitor'] || req.headers['x-forwarded-proto']);
  return wrongHost || wrongProto ? SITE_URL + req.url : null;
}

// ---------- API ----------
async function handleApi(req, res, route) {
  if (route === 'login') {
    if (req.method !== 'POST') return jsonErr(req, res, 405, 'method not allowed');
    return requireAuth(req, res) && send(req, res, 200, '{"ok":true}');
  }
  if (route === 'upload') {
    if (req.method !== 'POST') return jsonErr(req, res, 405, 'method not allowed');
    if (!requireAuth(req, res)) return;
    const ext = UPLOAD_TYPES[(req.headers['content-type'] || '').split(';')[0]];
    if (!ext) return jsonErr(req, res, 415, 'upload a JPEG, PNG or WebP image');
    const buf = await readBody(req, 8_000_000);
    if (!MAGIC[ext](buf)) return jsonErr(req, res, 415, 'file is not a valid JPEG, PNG or WebP image');
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    return send(req, res, 200, JSON.stringify({ path: `/uploads/${name}` }));
  }
  const store = STORES[route];
  if (!store) return jsonErr(req, res, 404, 'not found');
  if (req.method === 'GET' || req.method === 'HEAD') {
    return send(req, res, 200, JSON.stringify(readStore(route)), undefined, { 'Cache-Control': 'no-store' });
  }
  if (req.method === 'PUT') {
    if (!requireAuth(req, res)) return;
    try {
      const clean = validate(route, JSON.parse((await readBody(req, 5_000_000)).toString('utf8')));
      writeStore(route, clean);
      return send(req, res, 200, JSON.stringify(clean));
    } catch (e) {
      return jsonErr(req, res, 400, e.message);
    }
  }
  jsonErr(req, res, 405, 'method not allowed');
}

// ---------- server-side rendered home page ----------
// ---------- cache busting ----------
// Every /x.css, /x.js and image referenced from our HTML gets ?v=<content hash>, so browsers and
// Cloudflare fetch the new file right after an update instead of mixing old CSS/JS with new HTML.
const etags = new Map();
function fileHash(file) {
  if (!etags.has(file)) {
    try { etags.set(file, crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10)); } catch { etags.set(file, null); }
  }
  return etags.get(file);
}
const versionAssets = (html) => html.replace(/(\b(?:src|href)=")(\/[\w./-]+\.(?:css|js|png|jpe?g|ico|webp|svg))(")/g, (m, a, p, z) => {
  const v = fileHash(path.join(PUBLIC_DIR, p));
  return v ? `${a}${p}?v=${v}${z}` : m;
});
const TEMPLATE = versionAssets(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8'));
const escAttr = MHBSite.esc;
const GEO = { lat: 10.580565, lng: -85.5746102 };  // Monkey Head Brewing, Ruta 21, Liberia 50103
const MAP_URL = 'https://www.google.com/maps/search/?api=1&query=Monkey+Head+Brewing&query_place_id=ChIJ241Qvc3Vn48Rgrd8eYe10KI';
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');

function structuredData(lang, url, base, data) {
  const t = (k) => I18N.tFor(lang, k);
  const org = `${base}/#brewery`;
  const menuSections = []; let cur = null;
  for (const it of data.taps.items || []) {
    if (it.type === 'divider') { cur = { '@type': 'MenuSection', name: it.text, hasMenuItem: [] }; menuSections.push(cur); }
    if (it.type === 'beer') {
      if (!cur) { cur = { '@type': 'MenuSection', name: 'On Tap', hasMenuItem: [] }; menuSections.push(cur); }
      const { name, desc } = MHB.tr(it, lang);
      cur.hasMenuItem.push({ '@type': 'MenuItem', name, description: [it.style, it.abv && it.abv + '% ABV', desc].filter(Boolean).join(' · '),
        ...(it.glutenFree ? { suitableForDiet: 'https://schema.org/GlutenFreeDiet' } : {}) });
    }
  }
  const graph = [
    {
      '@type': 'Brewery', '@id': org, name: 'Monkey Head Brewing Co.', alternateName: 'Monkey Head Brewing',
      url: base + '/', logo: base + '/img/icon-512.png', image: [base + '/img/og-card.jpg', base + '/img/mobile-tap.jpg'],
      description: t('page.desc'), telephone: '+506 8733 7046', foundingDate: '2015', servesCuisine: 'Craft beer',
      address: { '@type': 'PostalAddress', streetAddress: 'Ruta 21, 3 km west of Daniel Oduber International Airport', addressLocality: 'Liberia', addressRegion: 'Guanacaste', postalCode: '50103', addressCountry: 'CR' },
      geo: { '@type': 'GeoCoordinates', latitude: GEO.lat, longitude: GEO.lng },
      hasMap: MAP_URL,
      openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '12:00', closes: '17:00' }],
      hasMenu: { '@type': 'Menu', name: t('taps.title'), inLanguage: lang, hasMenuSection: menuSections },
      acceptsReservations: false,
      sameAs: ((data.social && data.social.links) || []).map((l) => l.url).filter((u) => /^https:\/\/(www\.)?(instagram|facebook|untappd|tiktok|youtube|x|twitter|tripadvisor)\./.test(u)),
    },
    { '@type': 'WebSite', '@id': `${base}/#website`, url: base + '/', name: 'Monkey Head Brewing Co.', inLanguage: ['en', 'es'], publisher: { '@id': org } },
    { '@type': 'WebPage', '@id': url, url, name: t('page.title'), description: t('page.desc'), inLanguage: lang, isPartOf: { '@id': `${base}/#website` }, about: { '@id': org } },
  ];
  for (const e of MHBSite.upcoming(data.events)) {
    const title = (lang === 'es' && e.title_es) || e.title;
    graph.push({
      '@type': 'Event', name: title, description: (lang === 'es' && e.description_es) || e.description || undefined,
      startDate: `${e.date}T${e.start || '00:00'}:00-06:00`, ...(e.end ? { endDate: `${e.date}T${e.end}:00-06:00` } : {}),
      eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: { '@type': 'Place', name: e.venue || 'Monkey Head Brewing Co.', address: { '@type': 'PostalAddress', streetAddress: e.address || e.venue || '', addressCountry: 'CR' } },
      ...(e.image ? { image: [base + e.image] } : {}), organizer: { '@id': org }, url: `${url}#${MHBSite.eventId(e)}`,
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

function renderHome(req, lang) {
  const t = (k) => I18N.tFor(lang, k);
  const base = baseUrl(req);
  const url = base + (lang === 'es' ? '/es' : '/');
  const data = { taps: readStore('taps'), events: readStore('events'), merch: readStore('merch'), places: readStore('places'), social: readStore('social'), releases: readStore('releases'), mobiletap: readStore('mobiletap') };
  const beers = MHB.beers(data.taps).length;
  const banner = MHBSite.renderBanner(data.events, lang, t);
  const head = [
    `<meta name="description" content="${escAttr(t('page.desc'))}">`,
    `<link rel="canonical" href="${url}">`,
    `<link rel="alternate" hreflang="en" href="${base}/">`,
    `<link rel="alternate" hreflang="es" href="${base}/es">`,
    `<link rel="alternate" hreflang="x-default" href="${base}/">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Monkey Head Brewing Co.">`,
    `<meta property="og:title" content="${escAttr(t('page.title'))}">`,
    `<meta property="og:description" content="${escAttr(t('page.desc'))}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${base}/img/og-card.jpg?v=${fileHash(path.join(PUBLIC_DIR, 'img/og-card.jpg'))}">`,
    `<meta property="og:image:secure_url" content="${base}/img/og-card.jpg?v=${fileHash(path.join(PUBLIC_DIR, 'img/og-card.jpg'))}">`,
    `<meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="Monkey Head Brewing Co. — Craft beer, cider and cocktails in Liberia, Costa Rica">`,
    `<meta property="og:locale" content="${lang === 'es' ? 'es_CR' : 'en_US'}"><meta property="og:locale:alternate" content="${lang === 'es' ? 'en_US' : 'es_CR'}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image" content="${base}/img/og-card.jpg?v=${fileHash(path.join(PUBLIC_DIR, 'img/og-card.jpg'))}">`,
    `<meta name="geo.region" content="CR-G"><meta name="geo.placename" content="Liberia, Guanacaste"><meta name="geo.position" content="${GEO.lat};${GEO.lng}"><meta name="ICBM" content="${GEO.lat}, ${GEO.lng}">`,
    `<script type="application/ld+json">${jsonForScript(structuredData(lang, url, base, data))}</script>`,
  ].join('\n');

  let html = TEMPLATE
    .replace('<html lang="en">', `<html lang="${lang}">`)
    .replace('<!--@head-->', head)
    .replace('<!--@banner-->', banner)
    .replace('id="banner" role="region"', `id="banner"${banner ? '' : ' hidden'} role="region"`)
    .replace('<!--@updated-->', escAttr(`${beers} ${t('taps.onTap')}`))
    .replace('<!--@board-->', MHB.renderBoard(data.taps, lang))
    .replace('<!--@events-->', MHBSite.renderEvents(data.events, lang, t))
    .replace('<!--@places-->', MHBSite.renderPlaces(data.places, lang, t))
    .replace('<!--@merch-->', MHBSite.renderMerch(data.merch, lang, t))
    .replace('<!--@social-->', MHBSite.renderSocial(data.social))
    .replace('id="bookTap" href="https://api.whatsapp.com/send?phone=50687337046"', `id="bookTap" href="${escAttr(MHBSite.waLink(data.mobiletap, lang))}"`)
    .replace('<!--@release-->', MHBSite.renderRelease(data.releases, lang, t))
    .replace('<section class="release" id="new"', MHBSite.currentRelease(data.releases) ? '<section class="release" id="new"' : '<section class="release" id="new" hidden')
    .replace('<!--@year-->', String(new Date().getFullYear()))
    .replace('<!--@data-->', jsonForScript(data))
    .replace('id="langBtn" href="/es" hreflang="es"', lang === 'es' ? 'id="langBtn" href="/" hreflang="en"' : 'id="langBtn" href="/es" hreflang="es"');
  // Fill every data-i18n element / attribute with the right language
  html = html.replace(/(<(\w+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, tag, key, _inner, close) => open + t(key) + close);
  html = html.replace(/data-i18n-attr="([^"]+)"/g, (m, spec) => m + spec.split(';').map((p) => { const [a, k] = p.split(':'); return ` ${a}="${escAttr(t(k))}"`; }).join(''));
  return html;
}

function sitemap(req) {
  const base = baseUrl(req);
  const last = [readStore('taps').publishedAt, readStore('events').updated, readStore('merch').updated, readStore('places').updated, readStore('social').updated, readStore('releases').updated, readStore('mobiletap').updated]
    .filter(Boolean).sort().pop() || new Date().toISOString();
  const alt = `<xhtml:link rel="alternate" hreflang="en" href="${base}/"/><xhtml:link rel="alternate" hreflang="es" href="${base}/es"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url><loc>${base}/</loc><lastmod>${last.slice(0, 10)}</lastmod><changefreq>daily</changefreq><priority>1.0</priority>${alt}</url>
  <url><loc>${base}/es</loc><lastmod>${last.slice(0, 10)}</lastmod><changefreq>daily</changefreq><priority>0.9</priority>${alt}</url>
</urlset>`;
}

const MANIFEST = JSON.stringify({
  name: 'Monkey Head Brewing Co.', short_name: 'Monkey Head', start_url: '/', display: 'standalone',
  background_color: '#141210', theme_color: '#141210', lang: 'en',
  icons: [
    { src: '/img/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/img/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/img/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

// ---------- static ----------
const PAGES = { '/admin': '/admin.html', '/board': '/board.html' };
const NOT_FOUND = versionAssets(fs.readFileSync(path.join(PUBLIC_DIR, '404.html'), 'utf8'));
// Browsers asking for a page get the branded 404; images, scripts and API clients get plain text.
const notFound = (req, res) => (/text\/html/.test(req.headers.accept || '')
  ? send(req, res, 404, NOT_FOUND, MIME['.html'], { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' })
  : send(req, res, 404, 'not found', 'text/plain; charset=utf-8', { 'Cache-Control': 'no-store' }));
function serveFile(req, res, root, rel, extra = {}) {
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) return send(req, res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return notFound(req, res);
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') data = Buffer.from(versionAssets(data.toString('utf8')));
    const versioned = /[?&]v=\w+/.test(req.url) || root === UPLOAD_DIR || ext === '.woff2';
    // Versioned files never change -> cache forever. Everything else: revalidate every time (cheap 304s).
    const cacheCtl = versioned ? 'public, max-age=31536000, immutable' : ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400';
    const etag = '"' + crypto.createHash('sha1').update(data).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': cacheCtl, ...BASE_HEADERS, ...extra });
      return res.end();
    }
    send(req, res, 200, data, MIME[ext] || 'application/octet-stream', { 'Cache-Control': cacheCtl, ETag: etag, ...extra });
  });
}

// Real visitor IP: Cloudflare sets cf-connecting-ip; other proxies X-Forwarded-For.
const clientIp = (req) => req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

const server = http.createServer((req, res) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const code = res.statusCode;
    log(code >= 500 ? 'ERROR' : code >= 400 ? 'WARNING' : 'INFO', {
      method: req.method, path: req.url.split('?')[0], status_code: code,
      duration_ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100,
      client: clientIp(req), user_agent: req.headers['user-agent'] || '',
      ...(req.url.startsWith('/api/') && req.method !== 'GET' ? { admin: /^Bearer /.test(req.headers.authorization || '') } : {}),
    });
  });
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(req, res, 400, 'bad request', 'text/plain'); }
  try {
    if (p === '/healthz') {
      try { fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK); fs.accessSync(UPLOAD_DIR, fs.constants.W_OK); }
      catch (e) { log('ERROR', { message: `healthz: data dir not writable: ${e.message}` }); return send(req, res, 503, 'data dir not writable', 'text/plain', { 'Cache-Control': 'no-store' }); }
      return send(req, res, 200, 'ok', 'text/plain', { 'Cache-Control': 'no-store' });
    }
    if (p === '/api/version') return send(req, res, 200, JSON.stringify(BUILD), undefined, { 'Cache-Control': 'no-store' });
    const redirect = canonicalRedirect(req);
    if (redirect) { res.writeHead(301, { Location: redirect, 'Cache-Control': 'public, max-age=86400', ...BASE_HEADERS, ...hsts(req) }); return res.end(); }
    const api = p.match(/^\/api\/(taps|events|merch|places|social|releases|mobiletap|login|upload)$/);
    if (api) return handleApi(req, res, api[1]).catch((e) => jsonErr(req, res, 500, e.message));
    if (p === '/api/schemas') return send(req, res, 200, JSON.stringify(SCHEMAS), undefined, { 'Cache-Control': 'no-store' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'method not allowed', 'text/plain');

    if (p === '/' || p === '/index.html') return send(req, res, 200, renderHome(req, 'en'), MIME['.html'], { 'Cache-Control': 'no-cache', 'Content-Language': 'en' });
    if (p === '/es' || p === '/es/') return send(req, res, 200, renderHome(req, 'es'), MIME['.html'], { 'Cache-Control': 'no-cache', 'Content-Language': 'es' });
    if (p === '/robots.txt') {
      return send(req, res, 200, `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /board\nDisallow: /api/\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`, MIME['.txt']);
    }
    if (p === '/.well-known/security.txt' || p === '/security.txt') {
      const expires = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10) + 'T00:00:00.000Z';
      return send(req, res, 200, `Contact: ${SECURITY_CONTACT}\nExpires: ${expires}\nPreferred-Languages: en, es\nCanonical: ${baseUrl(req)}/.well-known/security.txt\n`, MIME['.txt']);
    }
    if (p === '/sitemap.xml') return send(req, res, 200, sitemap(req), MIME['.xml'], { 'Cache-Control': 'public, max-age=3600' });
    if (p === '/manifest.webmanifest') return send(req, res, 200, MANIFEST, MIME['.webmanifest'], { 'Cache-Control': 'public, max-age=86400' });
    if (p.startsWith('/uploads/')) return serveFile(req, res, UPLOAD_DIR, p.slice('/uploads/'.length));
    if (p === '/404.html') return notFound(req, res);
    if (PAGES[p]) return serveFile(req, res, PUBLIC_DIR, PAGES[p], { 'X-Robots-Tag': 'noindex, nofollow' });
    serveFile(req, res, PUBLIC_DIR, p);
  } catch (e) {
    log('ERROR', { message: e.message, stack: e.stack, path: req.url });
    send(req, res, 500, 'server error', 'text/plain');
  }
}).listen(PORT, () => log('INFO', { message: `MHB site ${BUILD.version} (${BUILD.commit}) on :${PORT}, data in ${DATA_DIR}` }));

// Graceful shutdown: stop accepting connections, let in-flight requests (e.g. a save) finish, then exit.
// Docker sends SIGTERM and SIGKILLs after 10 s, so give up after 8 s.
function shutdown(signal) {
  log('INFO', { message: `${signal} received, shutting down` });
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 8000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
