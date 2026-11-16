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
const net = require('net');

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
  info: { file: 'info.json', schema: 'info' },
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
  snapshot(name, data);
}

// ---------- version history ----------
// Every save is also kept as DATA_DIR/history/<store>/<time>.json (newest HISTORY_KEEP per store), so staff
// can look back and restore an earlier version from /admin.
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const HISTORY_KEEP = Number(process.env.HISTORY_KEEP || 50);
const HIST_ID = /^\d{8}T\d{9}Z(-\d+)?$/;
function snapshot(name, data) {
  try {
    const dir = path.join(HISTORY_DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    let id = stamp, n = 0;
    while (fs.existsSync(path.join(dir, id + '.json'))) id = `${stamp}-${++n}`;
    writeAtomic(path.join(dir, id + '.json'), JSON.stringify(data));
    const all = listHistory(name);
    for (const old of all.slice(HISTORY_KEEP)) fs.unlinkSync(path.join(dir, old.id + '.json'));
  } catch (e) { log('WARNING', { message: `history snapshot failed: ${e.message}`, store: name }); }
}
function listHistory(name) {
  const dir = path.join(HISTORY_DIR, name);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && HIST_ID.test(f.slice(0, -5))); } catch { return []; }
  return files.map((f) => {
    const id = f.slice(0, -5);
    const st = fs.statSync(path.join(dir, f));
    return { id, savedAt: st.mtime.toISOString(), bytes: st.size };
  }).sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
}
// First run with this feature: record the current state so there's something to go back to.
for (const name of Object.keys(STORES)) if (!listHistory(name).length) snapshot(name, readStore(name));

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
  coord: [/^(-?\d{1,3}(\.\d+)?)?$/, 'must be a number like 10.58 or -85.57'],
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
  if (schemaName === 'info') {
    const order = sc.fields.find((f) => f.k === 'day').options;
    out.sort((a, b) => order.indexOf(a.day) - order.indexOf(b.day) || a.opens.localeCompare(b.opens));
    out.forEach((r, i) => { if (!r.closed && (!r.opens || !r.closes)) throw new Error(`Hours ${i + 1} (${r.day}): set Opens and Closes, or tick Closed`); });
  }
  // Top-level settings for collections that have them (e.g. mobiletap)
  const settings = {};
  for (const f of sc.settings || []) {
    const v = input[f.k];
    if (f.type === 'bool') { settings[f.k] = v === undefined ? !!f.def : !!v; continue; }
    let s = typeof v === 'string' ? v.trim().slice(0, f.type === 'textarea' ? 1000 : 300) : '';
    if (f.type === 'pick' && s !== 'random' && !out.some((r) => r.id === s)) s = 'random';
    if (f.k === 'phone' || f.type === 'digits') { s = s.replace(/\D/g, ''); if (!/^\d{8,15}$/.test(s)) throw new Error(`${f.label}: 8–15 digits including country code`); }
    const rule = FIELD_RULES[f.type];
    if (rule && s && !rule[0].test(s)) throw new Error(`${f.label} ${rule[1]}`);
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
// Persisted so a container restart doesn't hand an attacker a fresh 10 tries.
const FAILS_FILE = path.join(DATA_DIR, '.lockouts.json');
try {
  const now = Date.now();
  for (const [ip, f] of Object.entries(JSON.parse(fs.readFileSync(FAILS_FILE, 'utf8')))) if (f && f.reset > now) FAILS.set(ip, f);
} catch { /* none yet */ }
let failsTimer = null;
function saveFails() {
  if (failsTimer) return;
  failsTimer = setTimeout(() => {
    failsTimer = null;
    const now = Date.now();
    try { writeAtomic(FAILS_FILE, JSON.stringify(Object.fromEntries([...FAILS].filter(([, f]) => f.reset > now)))); }
    catch (e) { log('WARNING', { message: `could not save lockouts: ${e.message}` }); }
  }, 500);
  failsTimer.unref();
}
function lockedOut(req) {
  const f = FAILS.get(clientIp(req));
  if (f && Date.now() > f.reset) { FAILS.delete(clientIp(req)); saveFails(); return false; }
  return !!f && f.n >= FAIL_LIMIT;
}
function noteFail(req) {
  const ip = clientIp(req), now = Date.now();
  const f = FAILS.get(ip);
  if (!f || now > f.reset) FAILS.set(ip, { n: 1, reset: now + FAIL_WINDOW }); else f.n++;
  if (FAILS.size > 10000) for (const [k, v] of FAILS) if (now > v.reset) FAILS.delete(k);
  if (FAILS.get(ip).n >= FAIL_LIMIT) log('WARNING', { message: 'login locked out', client: ip });
  saveFails();
}
// ---------- staff accounts, sessions, audit log ----------
// Accounts live in DATA_DIR/users.json (scrypt hashes). ADMIN_PASSWORD stays as the built-in "admin" owner, so
// existing setups keep working and an owner can never be locked out of creating accounts.
// Logging in returns a random session token; the password itself is never sent again.
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESS_FILE = path.join(DATA_DIR, '.sessions.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
const ROLES = ['owner', 'editor'];
const SESSION_IDLE = Number(process.env.SESSION_IDLE_HOURS || 12) * 3600e3;
const SESSION_MAX = Number(process.env.SESSION_MAX_DAYS || 7) * 864e5;
const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${crypto.scryptSync(pw, salt, 32, SCRYPT).toString('base64')}`;
}
function checkPw(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), 32, SCRYPT), want = Buffer.from(hash, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const DUMMY_HASH = hashPw(crypto.randomBytes(8).toString('hex')); // equalizes timing for unknown names
const sameSecret = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

let USERS = [];
try { USERS = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users || []; } catch { /* no accounts yet */ }
const saveUsers = () => writeAtomic(USERS_FILE, JSON.stringify({ updated: new Date().toISOString(), users: USERS }, null, 2));
const findUser = (name) => USERS.find((u) => u.name.toLowerCase() === String(name || '').trim().toLowerCase());
if (!ADMIN_PASSWORD && !USERS.some((u) => u.role === 'owner')) log('WARNING', { message: 'ADMIN_PASSWORD not set and no owner account — editing disabled' });

function verifyLogin(name, pw) {
  name = String(name || '').trim();
  if ((!name || name.toLowerCase() === 'admin') && ADMIN_PASSWORD && !findUser('admin')) {
    return sameSecret(pw, ADMIN_PASSWORD) ? { name: 'admin', role: 'owner' } : null;
  }
  const u = findUser(name);
  const ok = checkPw(pw, u ? u.hash : DUMMY_HASH);
  return u && ok ? { name: u.name, role: u.role } : null;
}

// Sessions: only the SHA-256 of each token is kept (memory + .sessions.json, so restarts don't log staff out).
const SESSIONS = new Map(); // sha256(token) -> { name, role, created, seen }
const tokenKey = (t) => crypto.createHash('sha256').update(t).digest('hex');
try {
  const now = Date.now();
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SESS_FILE, 'utf8')))) if (v && now - v.seen < SESSION_IDLE && now - v.created < SESSION_MAX) SESSIONS.set(k, v);
} catch { /* none yet */ }
let sessTimer = null;
function saveSessions() {
  if (sessTimer) return;
  sessTimer = setTimeout(() => {
    sessTimer = null;
    try { writeAtomic(SESS_FILE, JSON.stringify(Object.fromEntries(SESSIONS))); } catch (e) { log('WARNING', { message: `could not save sessions: ${e.message}` }); }
  }, 1000);
  sessTimer.unref();
}
function newSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  SESSIONS.set(tokenKey(token), { name: user.name, role: user.role, created: now, seen: now });
  saveSessions();
  return token;
}
const bearer = (req) => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : ''; };
function sessionFor(req) {
  const t = bearer(req); if (!t) return null;
  const k = tokenKey(t), s = SESSIONS.get(k), now = Date.now();
  if (!s) return null;
  // Expired, or the account was deleted/changed role since login -> session is gone.
  const u = s.name === 'admin' && !findUser('admin') ? (ADMIN_PASSWORD ? { name: 'admin', role: 'owner' } : null) : findUser(s.name);
  if (!u || now - s.seen > SESSION_IDLE || now - s.created > SESSION_MAX || u.sessionsAfter > s.created) { SESSIONS.delete(k); saveSessions(); return null; }
  s.role = u.role;
  if (now - s.seen > 60e3) { s.seen = now; saveSessions(); }
  return { key: k, ...s };
}
// Returns the session user, or sends 401/403 and returns null.
function requireAuth(req, res, role) {
  const s = sessionFor(req);
  if (!s) { jsonErr(req, res, 401, 'unauthorized'); return null; }
  if (role === 'owner' && s.role !== 'owner') { jsonErr(req, res, 403, 'owners only'); return null; }
  req.user = s.name;
  return s;
}

// Audit log: one JSON object per line. Trimmed to the newest AUDIT_KEEP lines when it grows past ~1 MB.
const AUDIT_KEEP = 3000;
function audit(req, action, fields = {}) {
  const entry = { time: new Date().toISOString(), user: req.user || fields.user || null, action, ip: clientIp(req), ...fields };
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
    if (fs.statSync(AUDIT_FILE).size > 1_000_000) writeAtomic(AUDIT_FILE, readAudit(AUDIT_KEEP).reverse().map((e) => JSON.stringify(e)).join('\n') + '\n');
  } catch (e) { log('WARNING', { message: `audit write failed: ${e.message}` }); }
  log('INFO', { message: 'audit', ...entry });
}
function readAudit(limit) {
  let lines = [];
  try { lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n'); } catch { return []; }
  return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
// What changed, in a few words, for the audit log.
function summarize(name, before, after) {
  if (name === 'taps') return `${MHB.beers(after).length} on tap (was ${before ? MHB.beers(before).length : '?'})`;
  const key = STORES[name].schema && SCHEMAS[STORES[name].schema].listKey;
  const n = (d) => (d && Array.isArray(d[key]) ? d[key].length : 0);
  return key ? `${n(after)} item(s) (was ${n(before)})` : 'saved';
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
    if (lockedOut(req)) return jsonErr(req, res, 429, 'too many attempts, try again later');
    let body = {};
    try { const raw = (await readBody(req, 10_000)).toString('utf8'); body = raw ? JSON.parse(raw) : {}; } catch { return jsonErr(req, res, 400, 'bad request'); }
    // {user, password} in the body; "Authorization: Bearer <password>" still works for the built-in admin.
    const pw = typeof body.password === 'string' ? body.password : bearer(req);
    const user = pw ? verifyLogin(body.user, pw) : null;
    if (!user) {
      noteFail(req);
      audit(req, 'login_failed', { user: String(body.user || 'admin').slice(0, 40) });
      return jsonErr(req, res, 401, 'wrong name or password');
    }
    if (FAILS.delete(clientIp(req))) saveFails();
    req.user = user.name;
    audit(req, 'login');
    return send(req, res, 200, JSON.stringify({ ok: true, token: newSession(user), user: user.name, role: user.role, idleHours: SESSION_IDLE / 3600e3 }), undefined, { 'Cache-Control': 'no-store' });
  }
  if (route === 'logout') {
    if (req.method !== 'POST') return jsonErr(req, res, 405, 'method not allowed');
    const sess = sessionFor(req);
    if (sess) { req.user = sess.name; SESSIONS.delete(sess.key); saveSessions(); audit(req, 'logout'); }
    return send(req, res, 200, '{"ok":true}');
  }
  if (route === 'me') {
    const sess = requireAuth(req, res); if (!sess) return;
    if (req.method === 'GET') return send(req, res, 200, JSON.stringify({ user: sess.name, role: sess.role, builtin: sess.name === 'admin' && !findUser('admin') }), undefined, { 'Cache-Control': 'no-store' });
    if (req.method !== 'PUT') return jsonErr(req, res, 405, 'method not allowed');
    // Change my own password: { current, password }
    let b; try { b = JSON.parse((await readBody(req, 10_000)).toString('utf8')); } catch { return jsonErr(req, res, 400, 'bad request'); }
    const u = findUser(sess.name);
    if (!u) return jsonErr(req, res, 400, 'the built-in admin password is set with ADMIN_PASSWORD on the server');
    if (!checkPw(b.current, u.hash)) return jsonErr(req, res, 400, 'current password is wrong');
    if (typeof b.password !== 'string' || b.password.length < 10) return jsonErr(req, res, 400, 'new password: at least 10 characters');
    u.hash = hashPw(b.password); u.sessionsAfter = Date.now() - 1; saveUsers();
    audit(req, 'password_changed', { target: u.name });
    // Other sessions of this user end; this one continues with a fresh token.
    return send(req, res, 200, JSON.stringify({ ok: true, token: newSession(u) }));
  }
  if (route === 'users') {
    const sess = requireAuth(req, res, 'owner'); if (!sess) return;
    const pub = () => USERS.map((u) => ({ name: u.name, role: u.role, created: u.created, updated: u.updated }));
    if (req.method === 'GET') return send(req, res, 200, JSON.stringify({ users: pub(), builtinAdmin: !!ADMIN_PASSWORD && !findUser('admin') }), undefined, { 'Cache-Control': 'no-store' });
    if (req.method !== 'PUT') return jsonErr(req, res, 405, 'method not allowed');
    // Full list: [{ name, role, password? }]. A password is required for new accounts and optional (reset) for existing ones.
    let b; try { b = JSON.parse((await readBody(req, 100_000)).toString('utf8')); } catch { return jsonErr(req, res, 400, 'bad request'); }
    if (!Array.isArray(b.users) || b.users.length > 50) return jsonErr(req, res, 400, 'expected a "users" array (max 50)');
    const seen = new Set(), next = [], now = new Date().toISOString(), changes = [];
    for (const [i, x] of b.users.entries()) {
      const name = String((x && x.name) || '').trim();
      if (!/^[\p{L}\p{N} ._-]{2,30}$/u.test(name)) return jsonErr(req, res, 400, `user ${i + 1}: name must be 2–30 letters, numbers, spaces, . _ -`);
      if (seen.has(name.toLowerCase())) return jsonErr(req, res, 400, `duplicate name "${name}"`);
      seen.add(name.toLowerCase());
      if (!ROLES.includes(x.role)) return jsonErr(req, res, 400, `${name}: role must be owner or editor`);
      const old = findUser(name), pw = x.password ? String(x.password) : '';
      if (pw && pw.length < 10) return jsonErr(req, res, 400, `${name}: password must be at least 10 characters`);
      if (!old && !pw) return jsonErr(req, res, 400, `${name}: new accounts need a password`);
      const u = old ? { ...old, name } : { name, created: now };
      if (pw) { u.hash = hashPw(pw); u.sessionsAfter = Date.now(); changes.push(old ? `reset password for ${name}` : `added ${name} (${x.role})`); }
      if (old && old.role !== x.role) { u.sessionsAfter = Date.now(); changes.push(`${name}: ${old.role} → ${x.role}`); }
      u.role = x.role; u.updated = now;
      next.push(u);
    }
    for (const u of USERS) if (!seen.has(u.name.toLowerCase())) changes.push(`removed ${u.name}`);
    if (!ADMIN_PASSWORD && !next.some((u) => u.role === 'owner')) return jsonErr(req, res, 400, 'keep at least one owner (or set ADMIN_PASSWORD)');
    USERS = next; saveUsers();
    if (changes.length) audit(req, 'users', { detail: changes.join('; ').slice(0, 500) });
    return send(req, res, 200, JSON.stringify({ users: pub(), builtinAdmin: !!ADMIN_PASSWORD && !findUser('admin') }));
  }
  if (route === 'audit') {
    if (!requireAuth(req, res, 'owner')) return;
    const limit = Math.min(1000, Math.max(1, parseInt(new URL(req.url, 'http://x').searchParams.get('limit') || '200', 10) || 200));
    return send(req, res, 200, JSON.stringify(readAudit(limit)), undefined, { 'Cache-Control': 'no-store' });
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
    audit(req, 'upload', { file: name, bytes: buf.length });
    return send(req, res, 200, JSON.stringify({ path: `/uploads/${name}` }));
  }
  if (route === 'backup') {
    if (req.method !== 'GET') return jsonErr(req, res, 405, 'method not allowed');
    if (!requireAuth(req, res)) return;
    const stores = Object.fromEntries(Object.keys(STORES).map((n) => [n, readStore(n)]));
    const stamp = new Date().toISOString().slice(0, 10);
    return send(req, res, 200, JSON.stringify({ format: 'mhb-backup', version: 1, createdAt: new Date().toISOString(), app: BUILD.version, stores }, null, 2),
      undefined, { 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="mhb-backup-${stamp}.json"` });
  }
  const hist = route.match(/^history\/(\w+)(?:\/([\w-]+))?$/);
  if (hist) {
    if (req.method !== 'GET') return jsonErr(req, res, 405, 'method not allowed');
    if (!STORES[hist[1]]) return jsonErr(req, res, 404, 'not found');
    if (!requireAuth(req, res)) return;
    if (!hist[2]) return send(req, res, 200, JSON.stringify(listHistory(hist[1])), undefined, { 'Cache-Control': 'no-store' });
    if (!HIST_ID.test(hist[2])) return jsonErr(req, res, 404, 'not found');
    const f = path.join(HISTORY_DIR, hist[1], hist[2] + '.json');
    if (!fs.existsSync(f)) return jsonErr(req, res, 404, 'not found');
    return send(req, res, 200, fs.readFileSync(f), undefined, { 'Cache-Control': 'no-store' });
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
      const before = readStore(route);
      writeStore(route, clean);
      audit(req, 'save', { store: route, detail: summarize(route, before, clean) });
      return send(req, res, 200, JSON.stringify(clean));
    } catch (e) {
      return jsonErr(req, res, 400, e.message);
    }
  }
  jsonErr(req, res, 405, 'method not allowed');
}

// ---------- unused upload cleanup ----------
// Posters/photos that no store references any more are moved to DATA_DIR/uploads-trash after a grace period
// (an upload may sit in an unsaved admin draft), then deleted from the trash later. Runs at startup and daily.
const TRASH_DIR = path.join(DATA_DIR, 'uploads-trash');
const DAY = 864e5;
const ORPHAN_GRACE_DAYS = Number(process.env.ORPHAN_GRACE_DAYS || 7);
const TRASH_KEEP_DAYS = Number(process.env.TRASH_KEEP_DAYS || 30);
function cleanUploads(now = Date.now()) {
  const used = new Set();
  for (const name of Object.keys(STORES)) {
    for (const m of JSON.stringify(readStore(name)).matchAll(/\/uploads\/([\w.-]+)/g)) used.add(m[1]);
  }
  let moved = 0, purged = 0;
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    const full = path.join(UPLOAD_DIR, f);
    const st = fs.statSync(full);
    if (!st.isFile() || used.has(f) || now - st.mtimeMs < ORPHAN_GRACE_DAYS * DAY) continue;
    fs.mkdirSync(TRASH_DIR, { recursive: true });
    fs.renameSync(full, path.join(TRASH_DIR, f));
    fs.utimesSync(path.join(TRASH_DIR, f), new Date(now), new Date(now)); // trash age counts from the move
    moved++;
  }
  if (fs.existsSync(TRASH_DIR)) {
    for (const f of fs.readdirSync(TRASH_DIR)) {
      const full = path.join(TRASH_DIR, f);
      if (now - fs.statSync(full).mtimeMs >= TRASH_KEEP_DAYS * DAY) { fs.unlinkSync(full); purged++; }
    }
  }
  if (moved || purged) log('INFO', { message: `uploads cleanup: ${moved} unused moved to uploads-trash, ${purged} purged` });
  return { moved, purged };
}
function safeClean() { try { cleanUploads(); } catch (e) { log('WARNING', { message: `uploads cleanup failed: ${e.message}` }); } }
setTimeout(safeClean, 5000).unref();
setInterval(safeClean, DAY).unref();

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
const versionAssets = (html) => html.replace(/(\b(?:src|srcset|href)=")(\/[\w./-]+\.(?:css|js|png|jpe?g|ico|webp|svg))(")/g, (m, a, p, z) => {
  const v = fileHash(path.join(PUBLIC_DIR, p));
  return v ? `${a}${p}?v=${v}${z}` : m;
});
const TEMPLATE = versionAssets(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8'));
const escAttr = MHBSite.esc;
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');

function structuredData(lang, url, base, data) {
  const t = (k) => I18N.tFor(lang, k);
  const info = data.info || {};
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
      description: t('page.desc'), foundingDate: '2015', servesCuisine: 'Craft beer',
      ...(info.tel ? { telephone: info.tel } : {}),
      address: { '@type': 'PostalAddress', streetAddress: info.street || '', addressLocality: info.locality || '', addressRegion: info.region || '', postalCode: info.postal || '', addressCountry: 'CR' },
      ...(info.lat && info.lng ? { geo: { '@type': 'GeoCoordinates', latitude: Number(info.lat), longitude: Number(info.lng) } } : {}),
      ...(info.map ? { hasMap: info.map } : {}),
      openingHoursSpecification: MHBSite.hoursGroups(info).filter((g) => !g.closed).map((g) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: g.days, opens: g.opens, closes: g.closes })),
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
  const data = { taps: readStore('taps'), events: readStore('events'), merch: readStore('merch'), places: readStore('places'), social: readStore('social'), releases: readStore('releases'), mobiletap: readStore('mobiletap'), info: readStore('info') };
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
    `<meta name="geo.region" content="CR-G"><meta name="geo.placename" content="${escAttr([data.info.locality, data.info.region].filter(Boolean).join(', '))}">` +
      (data.info.lat && data.info.lng ? `<meta name="geo.position" content="${escAttr(data.info.lat)};${escAttr(data.info.lng)}"><meta name="ICBM" content="${escAttr(data.info.lat)}, ${escAttr(data.info.lng)}">` : ''),
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
    .replace('<!--@factOpen-->', MHBSite.renderFactOpen(data.info, lang, t))
    .replace('<!--@visit-->', MHBSite.renderVisit(data.info, lang, t))
    .replace('<!--@footVisit-->', MHBSite.renderFootVisit(data.info, lang, t))
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
  const last = [readStore('taps').publishedAt, readStore('events').updated, readStore('merch').updated, readStore('places').updated, readStore('social').updated, readStore('releases').updated, readStore('mobiletap').updated, readStore('info').updated]
    .filter(Boolean).sort().pop() || new Date().toISOString();
  const alt = `<xhtml:link rel="alternate" hreflang="en" href="${base}/"/><xhtml:link rel="alternate" hreflang="es" href="${base}/es"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url><loc>${base}/</loc><lastmod>${last.slice(0, 10)}</lastmod><changefreq>daily</changefreq><priority>1.0</priority>${alt}</url>
  <url><loc>${base}/es</loc><lastmod>${last.slice(0, 10)}</lastmod><changefreq>daily</changefreq><priority>0.9</priority>${alt}</url>
  <url><loc>${base}/privacy</loc><changefreq>yearly</changefreq><priority>0.1</priority></url>
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
const PUBLIC_PAGES = { '/privacy': '/privacy.html' };
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

// Real visitor IP. CF-Connecting-IP / X-Forwarded-For are only believed when the connection comes from a
// trusted proxy (cloudflared, the NAS reverse proxy); otherwise anyone could rotate the header to dodge the
// login lockout. TRUSTED_PROXIES: comma-separated IPs/CIDRs, "*" = trust everyone, default = loopback + private.
const TRUSTED = (() => {
  const spec = (process.env.TRUSTED_PROXIES || '127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7,fe80::/10').trim();
  if (spec === '*') return null;
  const bl = new net.BlockList();
  for (const part of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [addr, bits] = part.split('/');
    const type = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
    if (!net.isIP(addr)) { log('WARNING', { message: `TRUSTED_PROXIES: ignoring "${part}"` }); continue; }
    if (bits === undefined) bl.addAddress(addr, type); else bl.addSubnet(addr, parseInt(bits, 10), type);
  }
  return bl;
})();
function fromTrustedProxy(req) {
  if (!TRUSTED) return true;
  let a = req.socket.remoteAddress || '';
  if (a.startsWith('::ffff:') && net.isIPv4(a.slice(7))) a = a.slice(7);
  return net.isIP(a) ? TRUSTED.check(a, net.isIPv6(a) ? 'ipv6' : 'ipv4') : false;
}
const clientIp = (req) => (fromTrustedProxy(req) && (req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim())) || req.socket.remoteAddress;

const server = http.createServer((req, res) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const code = res.statusCode;
    log(code >= 500 ? 'ERROR' : code >= 400 ? 'WARNING' : 'INFO', {
      method: req.method, path: req.url.split('?')[0], status_code: code,
      duration_ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100,
      client: clientIp(req), user_agent: req.headers['user-agent'] || '',
      ...(req.url.startsWith('/api/') && req.method !== 'GET' ? { admin: /^Bearer /.test(req.headers.authorization || '') } : {}),
      ...(req.user ? { user: req.user } : {}),
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
    const api = p.match(/^\/api\/(taps|events|merch|places|social|releases|mobiletap|info|login|logout|me|users|audit|upload|backup|history\/\w+(?:\/[\w-]+)?)$/);
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
    if (PUBLIC_PAGES[p]) return serveFile(req, res, PUBLIC_DIR, PUBLIC_PAGES[p]);
    if (p === '/es/privacy') { res.writeHead(301, { Location: '/privacy#es', ...BASE_HEADERS }); return res.end(); }
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
