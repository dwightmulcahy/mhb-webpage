// Chalkboard taplist renderer for TapListBuilder JSON (public site + TV board)
(typeof window !== 'undefined' ? window : globalThis).MHB = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : /^#[0-9a-fA-F]{3}$/.test(c || '') ? '#' + c.slice(1).replace(/./g, '$&$&') : '#f2b21b');
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';

  // Turn a beer's print color into a readable pastel chalk color on a dark board
  function chalk(hex) {
    const c = safeColor(hex);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (lum < 0.12) return '#f1ede4';                 // near-black (stout) → white chalk
    const mix = (v) => Math.round(v + (255 - v) * 0.42);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  }

  // Line icons (stroke = chalk color)
  const ICONS = {
    hop: '<path d="M24 6v5"/><path d="M24 11c-7 0-11 5-11 11 0 9 6 15 11 19 5-4 11-10 11-19 0-6-4-11-11-11z"/><path d="M14 19c5 4 15 4 20 0M13 27c6 5 16 5 22 0M16 34c5 4 11 4 16 0M24 11v30"/>',
    leaf: '<path d="M9 39C9 21 21 9 39 9c0 18-12 30-30 30z"/><path d="M9 39 31 17M18 30h8M22 26v-8"/>',
    citrus: '<circle cx="24" cy="26" r="13"/><circle cx="24" cy="26" r="9"/><path d="M24 17v18M15 26h18M17.6 19.6l12.8 12.8M30.4 19.6 17.6 32.4"/><path d="M24 13c0-4 3-6 7-6-1 4-3 6-7 6z"/>',
    pilsner: '<path d="M15 7h18l-3 34H18z"/><path d="M16 14h16"/><path d="M22 20c-2 4-2 10 0 14M26 20c2 4 2 10 0 14"/>',
    vanilla: '<circle cx="24" cy="17" r="3"/><path d="M24 14c-2-6 2-9 4-6s-1 6-4 6zM27 17c6-2 9 2 6 4s-6-1-6-4zM21 17c-6-2-9 2-6 4s6-1 6-4zM22 20c-4 5-2 9 1 7M26 20c4 5 2 9-1 7"/><path d="M24 22v19M24 34c-5-1-8 1-9 5M24 31c5-1 8 1 9 5"/>',
    passionfruit: '<circle cx="24" cy="26" r="14"/><circle cx="24" cy="26" r="9"/><circle cx="21" cy="23" r="1.3"/><circle cx="27" cy="23" r="1.3"/><circle cx="24" cy="28" r="1.3"/><circle cx="20" cy="29" r="1.3"/><circle cx="28" cy="29" r="1.3"/><path d="M24 12c0-3 2-5 5-6"/>',
    apple: '<path d="M24 15c-3-3-12-3-13 6-1 8 5 19 9 19 2 0 3-1 4-1s2 1 4 1c4 0 10-11 9-19-1-9-10-9-13-6z"/><path d="M24 15c0-4 1-7 3-9M25 11c3-3 6-3 8-2-2 3-5 3-8 2z"/>',
    stout: '<path d="M14 9h20l-2 32H16z"/><path d="M14 15h20"/><path d="M17 12c2-3 5-3 7-1 2-2 5-2 7 1"/>',
  };
  function icon(item) {
    if (item.hideIcon) return '';
    if (typeof item.customIcon === 'string' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(item.customIcon)) {
      return `<span class="ch-icon"><img src="${esc(item.customIcon)}" alt=""></span>`;
    }
    return `<span class="ch-icon"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[item.icon] || ICONS.hop}</svg></span>`;
  }

  const L = {
    en: { ibu: 'IBU', gf: 'Gluten free', new: 'New!', bitter: 'Bitter', crisp: 'Crisp & refreshing', balanced: 'Balanced', smooth: 'Smooth & mellow', title: 'On Tap' },
    es: { ibu: 'IBU', gf: 'Sin gluten', new: '¡Nueva!', bitter: 'Amarga', crisp: 'Fresca', balanced: 'Balanceada', smooth: 'Suave', title: 'En Tap' },
  };
  const DIVIDERS_ES = { BEERS: 'CERVEZAS', CIDERS: 'SIDRAS', SOURS: 'SOURS', SELTZERS: 'SELTZERS', COCKTAILS: 'CÓCTELES' };
  const TEXT_ES = { COCKTAILS: 'Cócteles', MERCHANDISE: 'Mercadería', WIFI: 'WiFi' };

  // BU:GU ratio → bitterness word
  function bitterness(it, t) {
    if (it.hideIbu || !has(it.ibu) || !has(it.sg)) return '';
    const gu = (parseFloat(it.sg) - 1) * 1000;
    if (!(gu > 0)) return '';
    const r = parseFloat(it.ibu) / gu;
    return r >= 0.85 ? t.bitter : r >= 0.7 ? t.crisp : r >= 0.5 ? t.balanced : t.smooth;
  }

  function tr(it, lang) {
    const x = (it.translations && it.translations[lang]) || {};
    return { name: has(x.name) ? x.name : it.name, desc: has(x.description) ? x.description : it.description };
  }

  function beer(it, lang, hn = 'h3') {
    const t = L[lang] || L.en;
    const { name, desc } = tr(it, lang);
    const meta = [esc(it.style)];
    if (!it.hideIbu && has(it.ibu)) meta.push(`${esc(it.ibu)} ${t.ibu}`);
    const b = bitterness(it, t); if (b) meta.push(b);
    return `<article class="ch-beer" style="--chalk:${chalk(it.color)}">
      <div class="ch-line">${icon(it)}<${hn} class="ch-name">${esc(name)}</${hn}><span class="leader"></span><b class="abv">${it.hideAbv || !has(it.abv) ? '' : esc(it.abv) + '%'}</b></div>
      <div class="ch-meta">${meta.filter(Boolean).join(' · ')}${it.isNew ? ` <span class="ch-new">★ ${t.new}</span>` : ''}${it.glutenFree ? ` <span class="ch-gf">${t.gf}</span>` : ''}</div>
      ${has(desc) ? `<p>${esc(desc)}</p>` : ''}
    </article>`;
  }

  // Groups items by divider so each section stays together on the board.
  // opts.page: embedded in the home page under its own <h2> — headings drop a level and the
  // hours/phone/location strip is left out (the Visit section and footer already show it).
  function renderBoard(data, lang, opts = {}) {
    const [hg, hb, hx] = opts.page ? ['h3', 'h4', 'h3'] : ['h2', 'h3', 'h4'];
    const s = data.settings || {};
    const groups = []; let cur = null; const extras = [];
    for (const it of data.items || []) {
      if (it.type === 'divider') { cur = { title: it.text, beers: [] }; groups.push(cur); }
      else if (it.type === 'beer') { if (!cur) { cur = { title: '', beers: [] }; groups.push(cur); } cur.beers.push(it); }
      else if (it.type === 'text') extras.push(...(it.columns || []));
    }
    const sections = groups.filter((g) => g.beers.length).map((g) => {
      const title = lang === 'es' ? DIVIDERS_ES[String(g.title).toUpperCase()] || g.title : g.title;
      return `<section class="ch-group">${title ? `<${hg} class="ch-h">${esc(title)}</${hg}>` : ''}${g.beers.map((b) => beer(b, lang, hb)).join('')}</section>`;
    }).join('');
    const extra = extras.length ? `<div class="ch-extras">${extras.map((c) => {
      const title = lang === 'es' ? TEXT_ES[String(c.title).toUpperCase()] || c.title : c.title;
      return `<div><${hx} class="ch-xh">${esc(title)}</${hx}><p>${esc(c.body).replace(/\n/g, '<br>')}</p></div>`;
    }).join('')}</div>` : '';
    const loc = (s.locationTranslations && s.locationTranslations[lang]) || s.location;
    const foot = opts.page ? '' : [s.taproomHours && `${esc(s.taproomLabel || 'TAPROOM:')} ${esc(s.taproomHours)}`, s.phone && esc(s.phone), loc && esc(loc)].filter(Boolean).join('  ✦  ');
    return `<div class="ch-top"><img class="ch-monkeys" src="/img/three-monkeys-chalk.png" alt="See no evil, drink good beer, hear no evil — three chalk monkeys" width="769" height="264"></div>
      <div class="ch-cols">${sections || '<p class="ch-empty">…</p>'}</div>
      ${extra}${foot ? `<div class="ch-foot">${foot}</div>` : ''}`;
  }

  const beers = (data) => (data.items || []).filter((i) => i.type === 'beer');

  function ago(iso, lang) {
    if (!iso) return '';
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    const rtf = new Intl.RelativeTimeFormat(lang || 'en', { numeric: 'auto' });
    if (m < 60) return rtf.format(-m, 'minute');
    const h = Math.round(m / 60);
    return h < 48 ? rtf.format(-h, 'hour') : new Date(iso).toLocaleDateString(lang);
  }

  async function load(url = '/api/taps') {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // Poll an endpoint; call onData(data) only when content changed
  // initial: data already rendered by the server, so the first poll doesn't redraw identical content
  function watch(onData, onError, intervalMs = 60000, url = '/api/taps', initial = null) {
    let last = initial ? JSON.stringify(initial) : '';
    async function tick() {
      try {
        const data = await load(url);
        const sig = JSON.stringify(data);
        if (sig !== last) { last = sig; onData(data); }
      } catch (e) { onError && onError(e); }
    }
    tick();
    return setInterval(tick, intervalMs);
  }

  return { esc, safeColor, has, chalk, renderBoard, beers, tr, watch, load, ago, ICONS };
})();
