// Site-wide English / Spanish strings + switch.
// Works in the browser (window.I18N) and on the server for pre-rendering (I18N.STRINGS, I18N.tFor).
// Elements with data-i18n="key" get their innerHTML from STRINGS[lang][key].
(function (g) {
  const STRINGS = {
    en: {
      'lang.switch': 'Español',
      'nav.taps': 'On Tap', 'nav.events': 'Events', 'nav.find': 'Find Us', 'nav.merch': 'Merch', 'nav.visit': 'Visit',
      'page.title': 'Monkey Head Brewing Co. | Craft Beer, Cider & Taproom in Liberia, Guanacaste, Costa Rica',
      'page.desc': 'Craft brewery and taproom near Liberia airport (LIR) in Guanacaste, Costa Rica. IPAs, pilsner, stout, sours, gluten-free fruit ciders and cocktails. Open daily noon–5 PM.',
      'banner.next': 'Next up', 'banner.see': 'Details', 'banner.close': 'Dismiss',
      'logo.swap': 'Tap the monkey to swap logos',
      'find.eyebrow': 'Beyond the taproom', 'find.title': 'Where to Find Us',
      'find.lead': 'Grab a Monkey Head at these spots around Guanacaste.',
      'find.none': 'More locations coming soon.', 'find.onTap': 'On tap', 'find.cans': 'Cans / to-go', 'find.map': 'Map', 'find.web': 'Website',
      'kind.bar': 'Bar', 'kind.restaurant': 'Restaurant', 'kind.hotel': 'Hotel', 'kind.shop': 'Shop', 'kind.taproom': 'Taproom', 'kind.other': '',
      'hero.eyebrow': 'Liberia · Guanacaste · Costa Rica',
      'hero.lead': 'Craft beer, fruit ciders and cocktails, brewed and poured in the Guanacaste heat since 2015.',
      'hero.cta1': "See what's on tap", 'hero.cta2': 'Visit the taproom',
      'fact.est': 'Established', 'fact.bbl': 'Brewhouse', 'fact.open': 'Open daily',
      'taps.eyebrow': 'Fresh from the brewhouse', 'taps.title': 'Current Taplist',
      'taps.onTap': 'on tap', 'taps.updated': 'updated', 'taps.unavailable': 'Taplist unavailable', 'taps.loading': 'Loading…',
      'more.eyebrow': 'More than beer', 'more.title': 'Beer. Cider. Cocktails.',
      'events.eyebrow': 'Come find us', 'events.title': 'Upcoming Events',
      'events.none': 'No events on the calendar right now. Check back soon, or book the mobile tap for yours.',
      'events.more': 'More info', 'events.map': 'Map',
      'ann.eyebrow': 'News from the taproom', 'ann.title': 'Announcements', 'nav.news': 'Announcements',
      'ann.until': 'Until', 'ann.more': 'More info',
      'ann.kind.news': 'News', 'ann.kind.important': 'Important', 'ann.kind.special': 'Special', 'ann.kind.closure': 'Schedule change',
      'merch.eyebrow': 'Take some home', 'merch.title': 'Merchandise',
      'merch.lead': 'Pick up Monkey Head gear and beer to-go at the taproom.',
      'merch.soldOut': 'Sold out', 'merch.none': 'New merch coming soon.',
      'merch.note': 'Designs and sizes vary — ask at the bar what’s in stock.',
      'mobile.eyebrow': 'Mobile tap', 'mobile.title': 'We bring the bar.',
      'mobile.p': 'Weddings, beach parties, festivals and private events across Guanacaste — our six-tap van pours Monkey Head beer and cider wherever you are.',
      'mobile.cta': 'Book via WhatsApp',
      'about.eyebrow': 'The brewery', 'about.title': 'Small batch.<br>Big flavor.',
      'about.p1': 'Monkey Head Brewing Co. runs a 7-barrel brewhouse just outside Liberia, Guanacaste. Small batches let us rotate styles often and experiment with local fruit.',
      'about.p2': 'Swing by the taproom, near Daniel Oduber airport, for a flight before or after your flight.',
      'visit.eyebrow': 'Come thirsty', 'visit.title': 'Visit the Taproom',
      'visit.hours': 'Hours', 'hours.daily': 'Open daily', 'hours.closed': 'Closed',
      'visit.loc': 'Location',
      'visit.maps': 'Open in Maps →', 'visit.contact': 'Contact', 'visit.wa': 'WhatsApp us',
      'foot.resp': 'Please drink responsibly',
      'foot.tagline': 'Craft beer, cider and cocktails brewed in Liberia, Guanacaste since 2015.',
      'foot.explore': 'Explore', 'foot.visit': 'Visit', 'foot.follow': 'Follow us',
      'foot.directions': 'Get directions →', 'foot.top': 'Back to top ↑', 'foot.privacy': 'Privacy',
      'rel.eyebrow': 'New beer release', 'rel.sticker': 'NEW!', 'rel.style': 'Style', 'rel.notes': 'Tasting notes',
      'rel.pair': 'Pairs with', 'rel.avail': 'Where to get it', 'rel.collab': 'In collaboration with', 'rel.cta': 'See the full taplist', 'nav.new': 'New Release',
      'tapdlg.contact': 'Contact via WhatsApp', 'tapdlg.later': 'Maybe later', 'tapdlg.close': 'Close', 'tapdlg.sign': 'OUT OF ORDER',
      'nav.more': 'Beer, Cider & Cocktails', 'nav.mobile': 'Mobile Tap', 'nav.about': 'The Brewery',
    },
    es: {
      'lang.switch': 'English',
      'nav.taps': 'En Tap', 'nav.events': 'Eventos', 'nav.find': 'Dónde', 'nav.merch': 'Tienda', 'nav.visit': 'Visítenos',
      'page.title': 'Monkey Head Brewing Co. | Cerveza Artesanal, Sidra y Taproom en Liberia, Guanacaste, Costa Rica',
      'page.desc': 'Cervecería artesanal y taproom cerca del aeropuerto de Liberia (LIR) en Guanacaste, Costa Rica. IPAs, pilsner, stout, sours, sidras de fruta sin gluten y cócteles. Abierto todos los días de mediodía a 5 PM.',
      'banner.next': 'Próximo evento', 'banner.see': 'Detalles', 'banner.close': 'Cerrar',
      'logo.swap': 'Toque el mono para cambiar el logo',
      'find.eyebrow': 'Más allá del taproom', 'find.title': 'Dónde Encontrarnos',
      'find.lead': 'Encuentre Monkey Head en estos lugares de Guanacaste.',
      'find.none': 'Pronto más lugares.', 'find.onTap': 'En tap', 'find.cans': 'Latas / para llevar', 'find.map': 'Mapa', 'find.web': 'Sitio web',
      'kind.bar': 'Bar', 'kind.restaurant': 'Restaurante', 'kind.hotel': 'Hotel', 'kind.shop': 'Tienda', 'kind.taproom': 'Taproom', 'kind.other': '',
      'hero.eyebrow': 'Liberia · Guanacaste · Costa Rica',
      'hero.lead': 'Cerveza artesanal, sidras de fruta y cócteles, hechos y servidos bajo el sol de Guanacaste desde 2015.',
      'hero.cta1': 'Vea qué hay en tap', 'hero.cta2': 'Visite el taproom',
      'fact.est': 'Fundada', 'fact.bbl': 'Cervecería', 'fact.open': 'Abierto diario',
      'taps.eyebrow': 'Recién salida de la cervecería', 'taps.title': 'En Tap Hoy',
      'taps.onTap': 'en tap', 'taps.updated': 'actualizado', 'taps.unavailable': 'Lista no disponible', 'taps.loading': 'Cargando…',
      'more.eyebrow': 'Más que cerveza', 'more.title': 'Cerveza. Sidra. Cócteles.',
      'events.eyebrow': 'Venga a buscarnos', 'events.title': 'Próximos Eventos',
      'events.none': 'No hay eventos en el calendario por ahora. Vuelva pronto, o reserve el tap móvil para el suyo.',
      'events.more': 'Más info', 'events.map': 'Mapa',
      'ann.eyebrow': 'Noticias del taproom', 'ann.title': 'Anuncios', 'nav.news': 'Anuncios',
      'ann.until': 'Hasta', 'ann.more': 'Más info',
      'ann.kind.news': 'Noticia', 'ann.kind.important': 'Importante', 'ann.kind.special': 'Especial', 'ann.kind.closure': 'Cambio de horario',
      'merch.eyebrow': 'Llévese un recuerdo', 'merch.title': 'Mercadería',
      'merch.lead': 'Consiga artículos de Monkey Head y cerveza para llevar en el taproom.',
      'merch.soldOut': 'Agotado', 'merch.none': 'Pronto tendremos nueva mercadería.',
      'merch.note': 'Diseños y tallas varían — pregunte en la barra qué hay disponible.',
      'mobile.eyebrow': 'Tap móvil', 'mobile.title': 'Llevamos el bar.',
      'mobile.p': 'Bodas, fiestas en la playa, festivales y eventos privados en todo Guanacaste — nuestra buseta de seis taps sirve cerveza y sidra Monkey Head donde usted esté.',
      'mobile.cta': 'Reservar por WhatsApp',
      'about.eyebrow': 'La cervecería', 'about.title': 'Lotes pequeños.<br>Gran sabor.',
      'about.p1': 'Monkey Head Brewing Co. opera una cervecería de 7 barriles a las afueras de Liberia, Guanacaste. Los lotes pequeños nos permiten rotar estilos seguido y experimentar con fruta local.',
      'about.p2': 'Pase por el taproom, cerca del aeropuerto Daniel Oduber, por un flight antes o después de su vuelo.',
      'visit.eyebrow': 'Venga con sed', 'visit.title': 'Visite el Taproom',
      'visit.hours': 'Horario', 'hours.daily': 'Abierto todos los días', 'hours.closed': 'Cerrado',
      'visit.loc': 'Ubicación',
      'visit.maps': 'Abrir en Maps →', 'visit.contact': 'Contacto', 'visit.wa': 'Escríbanos por WhatsApp',
      'foot.resp': 'Tome con moderación',
      'foot.tagline': 'Cerveza artesanal, sidra y cócteles hechos en Liberia, Guanacaste desde 2015.',
      'foot.explore': 'Explorar', 'foot.visit': 'Visítenos', 'foot.follow': 'Síganos',
      'foot.directions': 'Cómo llegar →', 'foot.top': 'Volver arriba ↑', 'foot.privacy': 'Privacidad',
      'rel.eyebrow': 'Nuevo lanzamiento', 'rel.sticker': '¡NUEVA!', 'rel.style': 'Estilo', 'rel.notes': 'Notas de cata',
      'rel.pair': 'Marida con', 'rel.avail': 'Dónde conseguirla', 'rel.collab': 'En colaboración con', 'rel.cta': 'Ver toda la lista', 'nav.new': 'Nuevo Lanzamiento',
      'tapdlg.contact': 'Contactar por WhatsApp', 'tapdlg.later': 'Quizás luego', 'tapdlg.close': 'Cerrar', 'tapdlg.sign': 'FUERA DE SERVICIO',
      'nav.more': 'Cerveza, Sidra y Cócteles', 'nav.mobile': 'Tap Móvil', 'nav.about': 'La Cervecería',
    },
  };


  const tFor = (lang, k) => (STRINGS[lang] && STRINGS[lang][k]) ?? STRINGS.en[k] ?? k;
  const isBrowser = typeof document !== 'undefined';
  if (!isBrowser) { g.I18N = { STRINGS, tFor, t: (k) => tFor('en', k), lang: 'en' }; return; }

  const KEY = 'mhb_lang';
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ } },
  };
  const ok = (l) => l === 'en' || l === 'es';
  // The server pre-renders "/" in English and "/es" in Spanish; an explicit earlier choice wins.
  const served = document.documentElement.lang;
  const fromUrl = new URLSearchParams(location.search).get('lang');
  let lang = [fromUrl, store.get()].find(ok) || (ok(served) ? served : null)
    || ((navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en');

  const t = (k) => tFor(lang, k);
  function syncUrl() {
    if (!/^\/(es\/?)?$/.test(location.pathname)) return;           // only on the home page
    const path = lang === 'es' ? '/es' : '/';
    if (location.pathname !== path) history.replaceState(null, '', path + location.hash);
  }
  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split(';').forEach((pair) => { const [a, k] = pair.split(':'); el.setAttribute(a, t(k)); });
    });
    document.title = t('page.title');
    syncUrl();
    document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
  }
  function set(l) { lang = l; store.set(l); apply(); }
  const toggle = () => set(lang === 'en' ? 'es' : 'en');

  g.I18N = { STRINGS, tFor, t, set, toggle, apply, get lang() { return lang; }, get changed() { return lang !== served; } };
})(typeof window !== 'undefined' ? window : globalThis);
