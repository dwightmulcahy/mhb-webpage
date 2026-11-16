// Zero-dependency lint: syntax-check every JS file and catch CSP-breaking inline handlers in HTML.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'data' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
let failed = 0;
for (const f of walk(ROOT)) {
  const rel = path.relative(ROOT, f);
  if (f.endsWith('.js')) {
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { failed++; console.error(`✗ ${rel}\n${e.stderr}`); }
  }
  if (f.endsWith('.html')) {
    const html = fs.readFileSync(f, 'utf8');
    const m = html.match(/<[^>]+\son[a-z]+\s*=\s*["']/i);
    if (m) { failed++; console.error(`✗ ${rel}: inline event handler (blocked by CSP): ${m[0]}`); }
    if (/javascript:/i.test(html)) { failed++; console.error(`✗ ${rel}: javascript: URL (blocked by CSP)`); }
  }
  if (f.endsWith('.json') && !rel.startsWith('node_modules')) {
    try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { failed++; console.error(`✗ ${rel}: ${e.message}`); }
  }
}
if (failed) { console.error(`\n${failed} problem(s)`); process.exit(1); }
console.log('lint ok');
