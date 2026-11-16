const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let s;
before(async () => { s = await startServer(); });
after(() => s.stop());

const put = (body) => s.req('/api/info', { method: 'PUT', headers: s.auth({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
const ld = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'][0];

test('seed info renders the same hours/contact as before', async () => {
  const html = await (await s.req('/')).text();
  assert.match(html, /<div id="factOpen">12–5<small>Open daily<\/small><\/div>/);
  assert.match(html, /Open daily · 12 PM – 5 PM/);
  assert.match(html, /<a href="tel:\+50687337046">\+506 8733 7046<\/a>/);
  assert.match(html, /Ruta 21, 3 km west of Daniel Oduber<br>International Airport/);
  const b = ld(html);
  assert.equal(b.telephone, '+506 8733 7046');
  assert.deepEqual(b.openingHoursSpecification, [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '12:00', closes: '17:00' }]);
  assert.equal(b.geo.latitude, 10.580565);
  const es = await (await s.req('/es')).text();
  assert.match(es, /Abierto todos los días · /);
  assert.match(es, /3 km al oeste del Aeropuerto/);
});

test('staff edits: grouped days, closed day, split hours, new phone — everywhere', async () => {
  const cur = await (await s.req('/api/info')).json();
  const hours = ['Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day) => ({ day, opens: '14:00', closes: '22:00' }))
    .concat([{ day: 'Saturday', opens: '12:00', closes: '15:00' }, { day: 'Saturday', opens: '17:00', closes: '23:00' }, { day: 'Monday', closed: true }]);
  const r = await put({ ...cur, tel: '+506 2222 3333', hoursNote: 'Closed Dec 25', hours });
  assert.equal(r.status, 200);
  const saved = await r.json();
  assert.deepEqual(saved.hours.map((h) => h.day), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Saturday'], 'sorted by weekday');
  const html = await (await s.req('/')).text();
  assert.match(html, /Mon · Closed/);
  assert.match(html, /Tue–Fri · 2 PM – 10 PM/);
  assert.match(html, /Sat · 12 PM – 3 PM, 5 PM – 11 PM/);
  assert.match(html, /Sun · Closed/, 'missing day = closed');
  assert.match(html, /<small>Closed Dec 25<\/small>/);
  assert.match(html, /<div id="factOpen">2–10<small>Hours<\/small><\/div>/);
  assert.match(html, /tel:\+50622223333/);
  const spec = ld(html).openingHoursSpecification;
  assert.deepEqual(spec.map((x) => [x.dayOfWeek.join(','), x.opens, x.closes]), [
    ['Tuesday,Wednesday,Thursday,Friday', '14:00', '22:00'], ['Saturday', '12:00', '15:00'], ['Saturday', '17:00', '23:00']]);
  assert.equal(ld(html).telephone, '+506 2222 3333');
});

test('info validation', async () => {
  const cur = await (await s.req('/api/info')).json();
  for (const [patch, msg] of [
    [{ whatsapp: '12' }, /8–15 digits/],
    [{ lat: 'north' }, /Latitude must be a number/],
    [{ map: 'maps.google.com' }, /must start with http/],
    [{ hours: [{ day: 'Monday', opens: '', closes: '' }] }, /set Opens and Closes, or tick Closed/],
  ]) {
    const r = await put({ ...cur, ...patch });
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.match((await r.json()).error, msg);
  }
});
