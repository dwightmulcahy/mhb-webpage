// Starts server.js on a free port with a throwaway DATA_DIR. No dependencies.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.join(__dirname, '..');
const PASSWORD = 'test-password-123';

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function startServer(env = {}) {
  const port = await freePort();
  const dataDir = env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'mhb-test-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD: PASSWORD, SITE_URL: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error('server exited:\n' + out);
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    base, dataDir, logs: () => out,
    req: (p, opts = {}) => fetch(base + p, { redirect: 'manual', ...opts }),
    auth: (extra = {}) => ({ Authorization: 'Bearer ' + PASSWORD, ...extra }),
    async stop() {
      if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise((r) => child.once('exit', r)); }
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// fetch() can't reliably override Host, so header-sensitive tests use node:http directly.
function rawGet(base, p, headers = {}) {
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    http.get(base + p, { headers, agent: false }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

module.exports = { startServer, rawGet, PASSWORD, ROOT };
