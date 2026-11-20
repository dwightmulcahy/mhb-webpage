// Public site behaviour. The server pre-renders everything; this keeps it live and handles EN/ES.
(() => {
  const $ = (s) => document.querySelector(s);
  const t = (k) => I18N.t(k);
  let data = {};
  try { data = JSON.parse($('#__DATA__').textContent || '{}'); } catch { /* fall back to polling */ }
  const S = MHBSite;

  // ---------- language ----------
  const langBtn = $('#langBtn');
  const syncLangBtn = () => {
    const other = I18N.lang === 'en' ? 'es' : 'en';
    langBtn.href = other === 'es' ? '/es' : '/';
    langBtn.hreflang = other;
    langBtn.setAttribute('aria-label', other === 'es' ? 'Cambiar a español' : 'Switch to English');
  };
  langBtn.addEventListener('click', (e) => { e.preventDefault(); I18N.toggle(); });

  // ---------- renderers ----------
  const drawTaps = () => {
    const d = data.taps; if (!d) return;
    $('#board').innerHTML = MHB.renderBoard(d, I18N.lang);
    $('#updated').textContent = `${MHB.beers(d).length} ${t('taps.onTap')}${d.publishedAt ? ' · ' + t('taps.updated') + ' ' + MHB.ago(d.publishedAt, I18N.lang) : ''}`;
  };
  const drawEvents = () => {
    if (!data.events) return;
    $('#eventList').innerHTML = S.renderEvents(data.events, I18N.lang, t);
    drawBanner();
  };
  const drawAnnounce = () => {
    if (!data.announcements) return;
    $('#annList').innerHTML = S.renderAnnouncements(data.announcements, I18N.lang, t);
    $('#news').hidden = !S.currentAnnouncements(data.announcements).length;
  };
  const drawMerch = () => { if (data.merch) $('#merchList').innerHTML = S.renderMerch(data.merch, I18N.lang, t); };
  const drawPlaces = () => { if (data.places) $('#placeList').innerHTML = S.renderPlaces(data.places, I18N.lang, t); };
  const drawSocial = () => { if (data.social) $('#socialList').innerHTML = S.renderSocial(data.social); };
  const drawInfo = () => {
    if (!data.info) return;
    $('#factOpen').innerHTML = S.renderFactOpen(data.info, I18N.lang, t);
    $('#visitCards').innerHTML = S.renderVisit(data.info, I18N.lang, t);
    $('#footVisit').innerHTML = S.renderFootVisit(data.info, I18N.lang, t);
  };
  const drawRelease = () => {
    if (!data.releases) return;
    $('#releaseBox').innerHTML = S.renderRelease(data.releases, I18N.lang, t);
    $('#new').hidden = !S.currentRelease(data.releases);
  };

  // ---------- next-event banner ----------
  const DISMISS = 'mhb_banner_dismissed';
  const dismissed = () => { try { return sessionStorage.getItem(DISMISS); } catch { return null; } };
  function drawBanner() {
    const el = $('#banner');
    const next = S.upcoming(data.events)[0];
    const id = next && S.eventId(next);
    el.innerHTML = next && dismissed() !== id ? S.renderBanner(data.events, I18N.lang, t) : '';
    el.hidden = !el.innerHTML.trim();
  }
  $('#banner').addEventListener('click', (e) => {
    if (e.target.closest('.banner-x')) {
      const a = $('#banner .banner-link');
      try { sessionStorage.setItem(DISMISS, a && a.dataset.event); } catch { /* ignore */ }
      $('#banner').hidden = true;
      return;
    }
    const link = e.target.closest('.banner-link');
    if (link) {
      const target = document.getElementById(link.dataset.event);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
        history.replaceState(null, '', '#' + link.dataset.event);
      }
    }
  });

  // ---------- logo swap: click the monkey's face ----------
  const swap = $('#logoSwap');
  const flip = () => {
    const on = swap.classList.toggle('flipped');
    swap.querySelector('.face-hit').tabIndex = on ? -1 : 0;
    swap.querySelector('.logo-back').tabIndex = on ? 0 : -1;
  };
  swap.querySelector('.face-hit').addEventListener('click', flip);
  swap.querySelector('.logo-back').addEventListener('click', flip);

  // ---------- Mobile Tap: "van in the shop" popup ----------
  const book = $('#bookTap'), dlg = $('#tapDlg');
  const syncBook = () => { if (data.mobiletap) book.href = S.waLink(data.mobiletap, I18N.lang); };
  book.addEventListener('click', (e) => {
    const d = data.mobiletap;
    if (!d || !d.inShop || !dlg || typeof dlg.showModal !== 'function') return;  // straight to WhatsApp
    const msg = S.pickTapMessage(d);
    if (!msg) return;
    e.preventDefault();
    $('#tapBox').innerHTML = S.renderTapDialog(d, msg, I18N.lang, t);
    dlg.showModal();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();   // backdrop or close buttons
    else if (e.target.closest('.wa')) setTimeout(() => dlg.close(), 300);
  });
  // ?tapdemo=<message id|random> opens the popup straight away (used by the admin "Preview" button)
  const demo = new URLSearchParams(location.search).get('tapdemo');
  if (demo && data.mobiletap) {
    const d = { ...data.mobiletap, inShop: true, pick: demo };
    $('#tapBox').innerHTML = S.renderTapDialog(d, S.pickTapMessage(d), I18N.lang, t);
    document.getElementById('mobile').scrollIntoView();
    dlg.showModal();
  }

  // ---------- live updates ----------
  MHB.watch((d) => { data.taps = d; drawTaps(); }, () => { $('#updated').textContent = t('taps.unavailable'); }, 60000, '/api/taps', data.taps);
  MHB.watch((d) => { data.events = d; drawEvents(); }, null, 300000, '/api/events', data.events);
  MHB.watch((d) => { data.announcements = d; drawAnnounce(); }, null, 300000, '/api/announcements', data.announcements);
  MHB.watch((d) => { data.merch = d; drawMerch(); }, null, 600000, '/api/merch', data.merch);
  MHB.watch((d) => { data.places = d; drawPlaces(); }, null, 600000, '/api/places', data.places);
  MHB.watch((d) => { data.social = d; drawSocial(); }, null, 600000, '/api/social', data.social);
  MHB.watch((d) => { data.releases = d; drawRelease(); }, null, 300000, '/api/releases', data.releases);
  MHB.watch((d) => { data.mobiletap = d; syncBook(); }, null, 600000, '/api/mobiletap', data.mobiletap);
  MHB.watch((d) => { data.info = d; drawInfo(); }, null, 600000, '/api/info', data.info);

  document.addEventListener('langchange', () => { syncLangBtn(); drawTaps(); drawEvents(); drawAnnounce(); drawMerch(); drawPlaces(); drawRelease(); drawInfo(); syncBook(); });
  $('#yr').textContent = new Date().getFullYear();
  if (I18N.changed) I18N.apply(); else { syncLangBtn(); drawBanner(); syncBook(); }
})();
