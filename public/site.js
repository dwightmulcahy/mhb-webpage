// Renderers for events, the next-event banner, merch and "where to find".
// Shared by the browser and the server (pre-rendering for SEO), so keep them pure: data in, HTML out.
(function (g) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'America/Costa_Rica';
  const loc = (lang) => (lang === 'es' ? 'es-CR' : 'en-US');
  const pick = (o, k, lang) => (lang === 'es' && o[k + '_es']) || o[k] || '';
  const todayCR = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
  const day = (ymd) => new Date(ymd + 'T12:00:00Z');
  const fmtDate = (ymd, lang, opts) => day(ymd).toLocaleDateString(loc(lang), { timeZone: 'UTC', ...opts });
  function fmtTime(hm, lang) {
    if (!hm) return '';
    const [h, m] = hm.split(':').map(Number);
    return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(loc(lang), { timeZone: 'UTC', hour: 'numeric', minute: m ? '2-digit' : undefined });
  }
  const mapLink = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const upcoming = (doc) => ((doc && doc.events) || []).filter((e) => e.date >= todayCR());
  const eventId = (e) => 'event-' + String(e.id || e.date).replace(/[^\w-]/g, '');

  function renderEvents(doc, lang, t) {
    const up = upcoming(doc);
    if (!up.length) return `<p class="none">${t('events.none')}</p>`;
    return up.map((e) => {
      const title = pick(e, 'title', lang), desc = pick(e, 'description', lang);
      const time = [fmtTime(e.start, lang), fmtTime(e.end, lang)].filter(Boolean).join(' – ');
      const where = [e.venue, e.address].filter(Boolean).join(' · ');
      return `<article class="event" id="${eventId(e)}">
        ${e.image ? `<a class="poster" href="${esc(e.image)}" target="_blank" rel="noopener"><img src="${esc(e.image)}" alt="${esc(title)} poster" loading="lazy" decoding="async" width="600" height="900"></a>` : ''}
        <div class="ev-body">
          <div class="date"><span>${fmtDate(e.date, lang, { month: 'short' })}</span><b>${Number(e.date.slice(8))}</b><small>${fmtDate(e.date, lang, { weekday: 'long' })}</small></div>
          <h3>${esc(title)}</h3>
          <div class="ev-meta">${time ? `<span>🕓 <time datetime="${esc(e.date)}T${esc(e.start || '00:00')}">${esc(time)}</time></span>` : ''}${where ? `<span>📍 ${esc(where)}</span>` : ''}</div>
          ${desc ? `<p>${esc(desc)}</p>` : ''}
          <div class="btns">${e.link ? `<a class="btn primary" href="${esc(e.link)}" target="_blank" rel="noopener">${t('events.more')}</a>` : ''}${where ? `<a class="btn ghost" href="${mapLink(where)}" target="_blank" rel="noopener">${t('events.map')}</a>` : ''}</div>
        </div>
      </article>`;
    }).join('');
  }

  function renderBanner(doc, lang, t) {
    const e = upcoming(doc)[0];
    if (!e) return '';
    const when = fmtDate(e.date, lang, { weekday: 'short', month: 'short', day: 'numeric' }) + (e.start ? ' · ' + fmtTime(e.start, lang) : '');
    return `<a class="banner-link" href="#${eventId(e)}" data-event="${esc(eventId(e))}">
        <span class="banner-tag">★ ${t('banner.next')}</span>
        <span class="banner-when">${esc(when)}</span>
        <strong class="banner-title">${esc(pick(e, 'title', lang))}</strong>
        ${e.venue ? `<span class="banner-venue">${esc(e.venue)}</span>` : ''}
        <span class="banner-cta">${t('banner.see')} →</span>
      </a>
      <button class="banner-x" type="button" aria-label="${t('banner.close')}">×</button>`;
  }

  // Announcements: shown while "Show on site" is ticked and today (Costa Rica) is within from..until (either optional).
  function currentAnnouncements(doc) {
    const today = todayCR();
    return ((doc && doc.announcements) || []).filter((a) => a.active !== false && (!a.from || a.from <= today) && (!a.until || a.until >= today));
  }
  const ANN_ICON = { news: '📣', important: '⚠️', special: '🍻', closure: '🔒' };
  function renderAnnouncements(doc, lang, t) {
    return currentAnnouncements(doc).map((a) => {
      const kind = ANN_ICON[a.kind] ? a.kind : 'news';
      const title = pick(a, 'title', lang), body = pick(a, 'body', lang);
      const until = a.until ? `${t('ann.until')} ${fmtDate(a.until, lang, { weekday: 'short', month: 'short', day: 'numeric' })}` : '';
      return `<article class="ann ann-${kind}">
        <span class="ann-icon" aria-hidden="true">${ANN_ICON[kind]}</span>
        <div class="ann-body">
          <div class="ann-meta"><span class="ann-tag">${t('ann.kind.' + kind)}</span>${until ? `<span>${esc(until)}</span>` : ''}</div>
          <h3>${esc(title)}</h3>
          ${body ? `<p>${esc(body).replace(/\n/g, '<br>')}</p>` : ''}
          ${a.link ? `<a class="btn primary" href="${esc(a.link)}" target="_blank" rel="noopener">${esc(pick(a, 'linkText', lang) || t('ann.more'))}</a>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  function renderMerch(doc, lang, t) {
    const items = (doc && doc.items) || [];
    if (!items.length) return `<p class="none">${t('merch.none')}</p>`;
    return items.map((m) => {
      const name = pick(m, 'name', lang), desc = pick(m, 'description', lang);
      return `<article class="merch-card${m.available === false ? ' sold' : ''}">
        <div class="merch-img">${m.image ? `<img src="${esc(m.image)}" alt="${esc(name)}" loading="lazy" decoding="async" width="600" height="600">` : ''}${m.available === false ? `<span class="sold-tag">${t('merch.soldOut')}</span>` : ''}</div>
        <div class="merch-body"><h3>${esc(name)}</h3>${m.price ? `<span class="price">${esc(m.price)}</span>` : ''}${desc ? `<p>${esc(desc)}</p>` : ''}</div>
      </article>`;
    }).join('');
  }

  const KIND_ICON = { bar: '🍺', restaurant: '🍽️', hotel: '🏨', shop: '🛍️', taproom: '🐒', other: '📍' };
  function renderPlaces(doc, lang, t) {
    const places = (doc && doc.places) || [];
    if (!places.length) return `<p class="none">${t('find.none')}</p>`;
    return places.map((p) => {
      const note = pick(p, 'note', lang);
      const map = p.map || (p.address || p.town ? mapLink([p.name, p.address, p.town].filter(Boolean).join(', ')) : '');
      const kind = t('kind.' + (p.kind || 'other'));
      return `<article class="place">
        <div class="place-img">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async" width="160" height="160">` : `<span aria-hidden="true">${KIND_ICON[p.kind] || KIND_ICON.other}</span>`}</div>
        <div class="place-body">
          <h3>${esc(p.name)}</h3>
          <div class="place-meta">${[kind, p.town].filter(Boolean).map(esc).join(' · ')}</div>
          <div class="place-tags">${p.onTap ? `<span>${t('find.onTap')}</span>` : ''}${p.cans ? `<span>${t('find.cans')}</span>` : ''}</div>
          ${note ? `<p>${esc(note)}</p>` : ''}
          ${p.address ? `<p class="addr">${esc(p.address)}</p>` : ''}
          <div class="place-links">${map ? `<a href="${esc(map)}" target="_blank" rel="noopener">${t('find.map')} →</a>` : ''}${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener">${t('find.web')} →</a>` : ''}</div>
        </div>
      </article>`;
    }).join('');
  }

  // ---------- NEW BEER RELEASE ----------
  const currentRelease = (doc) => ((doc && doc.releases) || []).find((r) => r.active) || null;
  function renderRelease(doc, lang, t) {
    const r = currentRelease(doc);
    if (!r) return '';
    const color = /^#[0-9a-fA-F]{6}$/.test(r.color || '') ? r.color : '#f2b21b';
    const name = pick(r, 'name', lang), tagline = pick(r, 'tagline', lang), desc = pick(r, 'description', lang);
    const notes = pick(r, 'notes', lang).split(',').map((s) => s.trim()).filter(Boolean);
    const pairing = pick(r, 'pairing', lang), avail = pick(r, 'availability', lang);
    const stats = [[r.abv && r.abv + '%', 'ABV'], [r.ibu, 'IBU'], [r.style, t('rel.style')]].filter(([v]) => v);
    return `<div class="rel-card" style="--rc:${color}">
        <div class="rel-media">
          ${r.image ? `<img src="${esc(r.image)}" alt="${esc(name)}" loading="lazy" decoding="async" width="1000" height="600">` : ''}
          <span class="rel-sticker">${t('rel.sticker')}</span>
        </div>
        <div class="rel-body">
          <div class="eyebrow">${t('rel.eyebrow')}${r.released ? ` · ${esc(fmtDate(r.released, lang, { month: 'long', day: 'numeric', year: 'numeric' }))}` : ''}</div>
          <h2 class="rel-name" id="rel-h">${esc(name)}</h2>
          ${tagline ? `<p class="rel-tag">${esc(tagline)}</p>` : ''}
          ${stats.length ? `<div class="rel-stats">${stats.map(([v, l]) => `<div><b>${esc(v)}</b><small>${esc(l)}</small></div>`).join('')}</div>` : ''}
          ${desc ? `<p class="rel-desc">${esc(desc)}</p>` : ''}
          ${notes.length ? `<h3>${t('rel.notes')}</h3><ul class="rel-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          <dl class="rel-facts">
            ${pairing ? `<div><dt>${t('rel.pair')}</dt><dd>${esc(pairing)}</dd></div>` : ''}
            ${avail ? `<div><dt>${t('rel.avail')}</dt><dd>${esc(avail)}</dd></div>` : ''}
            ${r.collab ? `<div><dt>${t('rel.collab')}</dt><dd>${esc(r.collab)}</dd></div>` : ''}
          </dl>
          <div class="btns"><a class="btn primary" href="#taps">${t('rel.cta')}</a><a class="btn ghost" href="#visit">${t('hero.cta2')}</a></div>
        </div>
      </div>`;
  }

  // ---------- Mobile Tap "van in the shop" popup ----------
  function waLink(doc, lang) {
    const phone = String((doc && doc.phone) || '50687337046').replace(/\D/g, '');
    const text = (doc && (lang === 'es' ? doc.prefill_es || doc.prefill : doc.prefill)) || '';
    return waUrl(phone, text);
  }
  // api.whatsapp.com: wa.me is on some DNS blocklists and fails to resolve there
  function waUrl(phone, text) {
    return `https://api.whatsapp.com/send?phone=${String(phone).replace(/\D/g, '')}${text ? '&text=' + encodeURIComponent(text) : ''}`;
  }
  function fixWa(url) {
    const m = String(url || '').match(/^https?:\/\/wa\.me\/(\d+)\/?(?:\?text=(.*))?$/);
    return m ? waUrl(m[1], m[2] ? decodeURIComponent(m[2]) : '') : url;
  }
  // Specific message, or a random one from those marked "Include in random"
  function pickTapMessage(doc, rnd = Math.random) {
    const list = (doc && doc.messages) || [];
    if (!list.length) return null;
    if (doc.pick && doc.pick !== 'random') return list.find((m) => m.id === doc.pick) || list[0];
    const pool = list.filter((m) => m.active !== false);
    const from = pool.length ? pool : list;
    return from[Math.floor(rnd() * from.length)];
  }
  function renderTapDialog(doc, msg, lang, t) {
    if (!msg) return '';
    const title = pick(msg, 'title', lang), body = pick(msg, 'body', lang);
    return `<button class="tap-x" type="button" data-close aria-label="${t('tapdlg.close')}">×</button>
      ${msg.style === 'sign'
        ? `<div class="tap-sign-wrap"><img src="/img/mobile-tap.jpg" alt="" width="1200" height="843"><span class="tap-sign">${t('tapdlg.sign')}</span></div>`
        : `<div class="tap-emoji" aria-hidden="true">${esc(msg.emoji || '🔧')}</div>`}
      <h3 id="tapdlg-title">${esc(title)}</h3>
      ${body ? `<p>${esc(body)}</p>` : ''}
      <div class="tap-actions">
        <a class="btn primary wa" href="${esc(waLink(doc, lang))}" target="_blank" rel="noopener">${t('tapdlg.contact')}</a>
        <button class="btn ghost" type="button" data-close>${t('tapdlg.later')}</button>
      </div>`;
  }

  // ---------- opening hours, address, contact (info.json) ----------
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dayName = (i, lang) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(loc(lang), { weekday: 'short', timeZone: 'UTC' }); // 2024-01-01 = Monday
  // Consecutive days with identical hours -> one group: { days: [...names], from, to, opens, closes, closed, split }
  function hoursGroups(info) {
    const rows = (info && info.hours) || [];
    const key = DAYS.map((d) => {
      const r = rows.filter((x) => x.day === d && !x.closed && x.opens && x.closes).sort((a, b) => a.opens.localeCompare(b.opens));
      return r.length ? r.map((x) => `${x.opens}-${x.closes}`).join(',') : 'closed';
    });
    const groups = [];
    key.forEach((k, i) => {
      const g = groups[groups.length - 1];
      if (g && g.key === k) { g.to = i; g.days.push(DAYS[i]); return; }
      const spans = k === 'closed' ? [] : k.split(',').map((x) => x.split('-'));
      groups.push({ key: k, from: i, to: i, days: [DAYS[i]], closed: k === 'closed', spans, opens: spans[0] && spans[0][0], closes: spans[0] && spans[spans.length - 1][1] });
    });
    // schema.org needs one spec per span; split hours become extra groups there
    return groups.flatMap((g) => (g.spans.length > 1 ? g.spans.map(([o, c]) => ({ ...g, opens: o, closes: c })) : [g]));
  }
  function hoursLines(info, lang, t) {
    const seen = new Set();
    const groups = hoursGroups(info).filter((g) => (seen.has(g.key + g.from) ? false : seen.add(g.key + g.from)));
    const span = (g) => g.spans.map(([o, c]) => `${fmtTime(o, lang)} – ${fmtTime(c, lang)}`).join(', ');
    if (groups.length === 1 && !groups[0].closed) return [`${t('hours.daily')} · ${span(groups[0])}`];
    return groups.map((g) => `${g.from === g.to ? dayName(g.from, lang) : `${dayName(g.from, lang)}–${dayName(g.to, lang)}`} · ${g.closed ? t('hours.closed') : span(g)}`);
  }
  const short = (hm) => { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}`; };
  function renderFactOpen(info, lang, t) {
    const open = hoursGroups(info).filter((g) => !g.closed);
    if (!open.length) return `—<small>${t('hours.closed')}</small>`;
    const daily = open.length === 1 && open[0].days.length === 7;
    const g = open.slice().sort((a, b) => b.days.length - a.days.length)[0];
    return `${short(g.opens)}–${short(g.closes)}<small>${daily ? t('fact.open') : t('visit.hours')}</small>`;
  }
  const lines = (s) => esc(s).replace(/\r?\n/g, '<br>');
  const telHref = (tel) => 'tel:+' + String(tel || '').replace(/\D/g, '');
  function renderVisit(info, lang, t) {
    info = info || {};
    const note = pick(info, 'hoursNote', lang);
    const addr = pick(info, 'address', lang);
    return `<div class="card"><h3>${t('visit.hours')}</h3><p>${hoursLines(info, lang, t).map(esc).join('<br>')}${note ? `<br><small>${esc(note)}</small>` : ''}</p></div>
      <address class="card"><h3>${t('visit.loc')}</h3><p>${lines(addr)}${info.map ? `<br><a href="${esc(info.map)}" target="_blank" rel="noopener">${t('visit.maps')}</a>` : ''}</p></address>
      <address class="card"><h3>${t('visit.contact')}</h3><p>${info.tel ? `<a href="${esc(telHref(info.tel))}">${esc(info.tel)}</a>` : ''}${info.whatsapp ? `<br><a href="${esc(waUrl(info.whatsapp, ''))}" rel="noopener">${t('visit.wa')}</a>` : ''}</p></address>`;
  }
  function renderFootVisit(info, lang, t) {
    info = info || {};
    return `<h3>${t('foot.visit')}</h3>
      <p>${hoursLines(info, lang, t).map(esc).join('<br>')}<br>${lines(pick(info, 'footAddress', lang) || pick(info, 'address', lang))}</p>
      <p>${info.map ? `<a href="${esc(info.map)}" target="_blank" rel="noopener">${t('foot.directions')}</a><br>` : ''}${info.tel ? `<a href="${esc(telHref(info.tel))}">${esc(info.tel)}</a>` : ''}</p>`;
  }

  // Simple line icons (24x24, stroke = currentColor)
  const SOCIAL_ICONS = {
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor"/>',
    facebook: '<path d="M14 21v-8h3l.5-3.5H14V7.8c0-1 .3-1.8 1.8-1.8h1.8V3a24 24 0 0 0-2.6-.1C12.4 2.9 10.6 4.5 10.6 7.4v2.1H7.5V13h3.1v8"/>',
    untappd: '<path d="M6 8h9v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M15 10h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2"/><path d="M6 8c0-2 1.5-3 3-3 .5-1.5 2-2 3-1.5C13 2.5 15 3 15 5c1 0 1.5 1.5 0 3"/>',
    tiktok: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.5 2.5 2.5 4.5 5 4.5"/>',
    youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10 9.5 5 2.5-5 2.5z" fill="currentColor"/>',
    x: '<path d="M4 4l16 16M20 4 4 20"/>',
    tripadvisor: '<circle cx="7" cy="13" r="3.5"/><circle cx="17" cy="13" r="3.5"/><path d="M3.5 9C6 7 9 6 12 6s6 1 8.5 3M12 6v3"/><circle cx="7" cy="13" r=".8" fill="currentColor"/><circle cx="17" cy="13" r=".8" fill="currentColor"/>',
    whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8c-1-.5-1.8-1.3-2.3-2.3l.8-1-1-2z"/>',
    google: '<path d="M12 21s-6-5.5-6-10.5a6 6 0 0 1 12 0C18 15.5 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
    website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z"/>',
  };
  const PLATFORM_NAME = { instagram: 'Instagram', facebook: 'Facebook', untappd: 'Untappd', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', tripadvisor: 'Tripadvisor', whatsapp: 'WhatsApp', google: 'Google Maps', email: 'Email', website: 'Website' };
  function renderSocial(doc) {
    const links = (doc && doc.links) || [];
    return links.map((l) => {
      const name = PLATFORM_NAME[l.platform] || l.platform;
      const url = fixWa(l.url);
      const ext = /^https?:/.test(url);
      return `<a class="social" href="${esc(url)}"${ext ? ' target="_blank" rel="noopener me"' : ''} aria-label="${esc(name)}${l.label ? ': ' + esc(l.label) : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SOCIAL_ICONS[l.platform] || SOCIAL_ICONS.website}</svg>
        <span>${esc(l.label || name)}</span></a>`;
    }).join('');
  }

  g.MHBSite = { esc, todayCR, upcoming, eventId, fmtDate, fmtTime, renderEvents, renderBanner, currentAnnouncements, renderAnnouncements, renderMerch, renderPlaces, renderSocial, renderRelease, currentRelease, waLink, waUrl, fixWa, pickTapMessage, renderTapDialog, hoursGroups, hoursLines, renderFactOpen, renderVisit, renderFootVisit };
})(typeof window !== 'undefined' ? window : globalThis);
