'use strict';

/**
 * tests/unit/b-utils.test.js
 *
 * js/b-utils.js (~230L) — helpers purs : image Cloudinary, prix/format,
 * sanitize XSS, carousel produit, wrappers API (getAPI/apiGet/apiPost).
 * @criticality high, @used-by all-boutique-js-modules.
 *
 * Avant cette session : aucun test dédié.
 *
 * Réel : le module lui-même (ES module, pas de mock de dépendance —
 * b-utils n'a pas de dépendance boutique interne, seulement `window.K`
 * pour apiGet/apiPost/getAPI).
 *
 * Priorité donnée à : optimizeImgUrl/promoImgUrl (branches Cloudinary vs
 * autre host, déjà optimisé vs non), sanitize (échappement XSS réel via
 * innerHTML), detectCurrency (branches Comores/Mayotte vs reste du monde
 * via mock de Intl.DateTimeFormat), fmt/fmtPrice (conversion KMF→EUR,
 * arrondi, formatage fr-FR), productEmoji, genIdempotencyKey (branche
 * crypto.randomUUID vs fallback Math.random), renderProductCarousel
 * (parsing JSON, dédoublonnage, fallback image_url, 0/1/N images, dots),
 * bindCarouselDots (idempotence via dataset.bound, scroll→dots actifs via
 * rAF, swipe touch/mouse→dataset.justSwiped), et apiGet/apiPost/getAPI
 * (guard _assertApi, transmission des options retries/signal/timeoutMs à
 * K.request, valeur par défaut retries=2).
 *
 * Laissé de côté (dette assumée) : le détail exact du throttle rAF de
 * bindCarouselDots sous scroll rapide répété (testé une fois, suffisant
 * pour couvrir la branche) ; window.KUtils / window.escHtml (compat
 * legacy posée en side-effect au chargement du module, hors périmètre
 * fonctionnel des exports ES).
 */

let utils;

function freshUtils() {
  jest.resetModules();
  delete window.K;
  // eslint-disable-next-line global-require
  utils = require('../../js/b-utils.js');
  return utils;
}

beforeEach(() => {
  freshUtils();
});

describe('b-utils — optimizeImgUrl / promoImgUrl', () => {
  test('retourne l\u2019URL telle quelle si non-Cloudinary', () => {
    expect(utils.optimizeImgUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
  });

  test('retourne l\u2019URL telle quelle si vide/undefined', () => {
    expect(utils.optimizeImgUrl('')).toBe('');
    expect(utils.optimizeImgUrl(undefined)).toBeUndefined();
  });

  test('insère f_auto,q_auto après /upload/ pour une URL Cloudinary', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/v1/pic.jpg';
    expect(utils.optimizeImgUrl(url)).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1/pic.jpg'
    );
  });

  test('ajoute w_<width> si une largeur est fournie', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/v1/pic.jpg';
    expect(utils.optimizeImgUrl(url, 400)).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_400/v1/pic.jpg'
    );
  });

  test('ne double pas la transformation si f_auto déjà présent', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1/pic.jpg';
    expect(utils.optimizeImgUrl(url)).toBe(url);
  });

  test('promoImgUrl délègue à optimizeImgUrl', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/v1/pic.jpg';
    expect(utils.promoImgUrl(url, 200)).toBe(utils.optimizeImgUrl(url, 200));
  });
});

describe('b-utils — sanitize', () => {
  test('échappe les balises HTML', () => {
    expect(utils.sanitize('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  test('chaîne sans caractères spéciaux reste inchangée', () => {
    expect(utils.sanitize('Riz Basmati')).toBe('Riz Basmati');
  });
});

describe('b-utils — detectCurrency', () => {
  test('retourne KMF si le fuseau horaire contient Comoro', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Indian/Comoro' }),
    });
    expect(utils.detectCurrency()).toBe('KMF');
    spy.mockRestore();
  });

  test('retourne KMF si le fuseau horaire contient Mayotte', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Indian/Mayotte' }),
    });
    expect(utils.detectCurrency()).toBe('KMF');
    spy.mockRestore();
  });

  test('retourne EUR pour un autre fuseau', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Europe/Paris' }),
    });
    expect(utils.detectCurrency()).toBe('EUR');
    spy.mockRestore();
  });

  test('retourne EUR si Intl lève une exception', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('unsupported');
    });
    expect(utils.detectCurrency()).toBe('EUR');
    spy.mockRestore();
  });
});

describe('b-utils — fmt / fmtPrice', () => {
  // toLocaleString('fr-FR') utilise une espace fine insécable (U+202F) comme
  // séparateur de milliers, pas une espace normale — on la reconstruit ici
  // plutôt que de la coller en dur dans chaque assertion.
  const NBSP = '\u202f';

  test('fmt convertit en EUR par défaut (rate 495) et formate fr-FR', () => {
    expect(utils.fmt(495000, 'EUR')).toBe(`1${NBSP}000 €`);
  });

  test('fmt en KMF ne convertit pas et ajoute le suffixe KMF', () => {
    expect(utils.fmt(12345, 'KMF')).toBe(`12${NBSP}345 KMF`);
  });

  test('fmt arrondit au plus proche', () => {
    expect(utils.fmt(500, 'EUR')).toBe('1 €'); // 500/495 ≈ 1.01 → arrondi à 1
  });

  test('fmt utilise la devise détectée si aucune n\u2019est fournie', () => {
    expect(utils.fmt(495000)).toBe(utils.fmt(495000, utils._currency));
  });

  test('fmtPrice formate toujours en KMF quelle que soit la devise locale', () => {
    expect(utils.fmtPrice(12500)).toBe(`12${NBSP}500 KMF`);
  });
});

describe('b-utils — productEmoji', () => {
  test('retourne l\u2019emoji du produit si présent', () => {
    expect(utils.productEmoji({ emoji: '🍎' })).toBe('🍎');
  });

  test('retourne 📦 par défaut', () => {
    expect(utils.productEmoji({})).toBe('📦');
  });
});

describe('b-utils — genIdempotencyKey', () => {
  test('utilise crypto.randomUUID si disponible', () => {
    const spy = jest.spyOn(crypto, 'randomUUID').mockReturnValue('fixed-uuid');
    expect(utils.genIdempotencyKey()).toBe('fixed-uuid');
    spy.mockRestore();
  });

  test('retombe sur un UUID v4 généré manuellement si randomUUID indisponible', () => {
    // randomUUID vit sur le prototype de `crypto` (jsdom) : `delete` sur
    // l'instance ne retire rien. On masque la méthode en posant une valeur
    // undefined en propriété propre, puis on la retire pour révéler à
    // nouveau la méthode du prototype.
    crypto.randomUUID = undefined;
    const key = utils.genIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    delete crypto.randomUUID;
  });
});

describe('b-utils — renderProductCarousel', () => {
  test('image unique via image_url si pas de tableau images → rendue comme slide carousel à 1 image', () => {
    const html = utils.renderProductCarousel({ name: 'Riz', image_url: 'riz.jpg' });
    expect(html).toContain('k-card-carousel');
    expect(html).toContain('riz.jpg');
    expect(html).not.toContain('k-card-dots'); // une seule image → pas de dots
  });

  test('image vide si ni images ni image_url', () => {
    const html = utils.renderProductCarousel({ name: 'Riz' });
    expect(html).toContain('src=""');
  });

  test('parse un champ images en JSON string', () => {
    const html = utils.renderProductCarousel({ name: 'Riz', images: JSON.stringify(['a.jpg', 'b.jpg']) });
    expect(html).toContain('k-card-carousel');
    expect(html).toContain('a.jpg');
    expect(html).toContain('b.jpg');
  });

  test('JSON invalide dans images retombe sur image_url', () => {
    const html = utils.renderProductCarousel({ name: 'Riz', images: '{not valid', image_url: 'fallback.jpg' });
    expect(html).toContain('fallback.jpg');
  });

  test('dédoublonne les URLs identiques dans le tableau images', () => {
    const html = utils.renderProductCarousel({ name: 'Riz', images: ['a.jpg', 'a.jpg', 'b.jpg'] });
    const matches = html.match(/a\.jpg/g) || [];
    expect(matches).toHaveLength(1);
  });

  test('ignore les entrées vides/whitespace dans le tableau images', () => {
    const html = utils.renderProductCarousel({ name: 'Riz', images: ['', '  ', 'a.jpg'] });
    expect(html).toContain('a.jpg');
    expect(html).not.toContain('k-card-dots'); // une seule image valide après filtrage → pas de dots
  });

  test('une seule image → pas de dots', () => {
    const html = utils.renderProductCarousel({ name: 'Riz', images: ['a.jpg'] });
    expect(html).not.toContain('k-card-dots');
  });

  test('plusieurs images → dots avec le premier actif', () => {
    const html = utils.renderProductCarousel({ name: 'Riz', images: ['a.jpg', 'b.jpg'] });
    expect(html).toContain('k-card-dots');
    expect(html).toContain('k-card-dot active');
  });

  test('échappe le nom du produit dans les alt', () => {
    const html = utils.renderProductCarousel({ name: '<b>Riz</b>', images: ['a.jpg'] });
    expect(html).not.toContain('<b>Riz</b>');
    expect(html).toContain('&lt;b&gt;Riz&lt;/b&gt;');
  });
});

describe('b-utils — bindCarouselDots', () => {
  function mountCard(dotCount) {
    const card = document.createElement('div');
    card.className = 'k-card';
    const carousel = document.createElement('div');
    carousel.className = 'k-card-carousel';
    card.appendChild(carousel);
    for (let i = 0; i < dotCount; i++) {
      const dot = document.createElement('span');
      dot.className = 'k-card-dot';
      card.appendChild(dot);
    }
    document.body.appendChild(card);
    return card;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('ne fait rien si aucun .k-card-carousel présent', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);
    expect(() => utils.bindCarouselDots(card)).not.toThrow();
  });

  test('est idempotent (dataset.bound empêche un double-bind)', () => {
    const card = mountCard(2);
    const carousel = card.querySelector('.k-card-carousel');
    const addSpy = jest.spyOn(carousel, 'addEventListener');
    utils.bindCarouselDots(card);
    utils.bindCarouselDots(card);
    // Le second appel ne doit pas re-poser de listeners (dataset.bound déjà '1')
    const scrollCalls = addSpy.mock.calls.filter(([type]) => type === 'scroll').length;
    expect(scrollCalls).toBe(1);
  });

  test('scroll met à jour le dot actif via rAF', () => {
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => { cb(); return 1; };
    const card = mountCard(2);
    const carousel = card.querySelector('.k-card-carousel');
    Object.defineProperty(carousel, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(carousel, 'scrollLeft', { value: 100, configurable: true, writable: true });
    utils.bindCarouselDots(card);
    carousel.dispatchEvent(new Event('scroll'));
    const dots = card.querySelectorAll('.k-card-dot');
    expect(dots[1].classList.contains('active')).toBe(true);
    window.requestAnimationFrame = originalRaf;
  });

  test('un swipe (touch) marque card.dataset.justSwiped puis le retire après délai', () => {
    jest.useFakeTimers();
    const card = mountCard(1);
    const carousel = card.querySelector('.k-card-carousel');
    utils.bindCarouselDots(card);

    carousel.dispatchEvent(new Event('touchstart', { bubbles: true }));
    // jsdom ne peuple pas `touches`, on simule directement via mousedown/mousemove/mouseup
    // qui partagent la même logique onStart/onMove/onEnd dans le module.
    carousel.dispatchEvent(Object.assign(new Event('mousedown'), { clientX: 0, clientY: 0 }));
    const moveEvt = Object.assign(new Event('mousemove'), { clientX: 50, clientY: 0, buttons: 1 });
    carousel.dispatchEvent(moveEvt);
    carousel.dispatchEvent(new Event('mouseup'));

    expect(card.dataset.justSwiped).toBe('1');
    jest.advanceTimersByTime(250);
    expect(card.dataset.justSwiped).toBeUndefined();
    jest.useRealTimers();
  });

  test('un simple clic (sans déplacement) ne marque pas justSwiped', () => {
    const card = mountCard(1);
    const carousel = card.querySelector('.k-card-carousel');
    utils.bindCarouselDots(card);

    carousel.dispatchEvent(Object.assign(new Event('mousedown'), { clientX: 10, clientY: 10 }));
    carousel.dispatchEvent(new Event('mouseup'));

    expect(card.dataset.justSwiped).toBeUndefined();
  });
});

describe('b-utils — getAPI / apiGet / apiPost', () => {
  test('getAPI lève si K global non défini', () => {
    expect(() => utils.getAPI()).toThrow(/non chargé/);
  });

  test('getAPI retourne K si défini', () => {
    global.K = { request: jest.fn() };
    expect(utils.getAPI()).toBe(global.K);
    delete global.K;
  });

  test('apiGet lève si window.K.request absent', () => {
    expect(() => utils.apiGet('/x')).toThrow(/komerce-api\.js manquant/);
  });

  test('apiGet appelle window.K.request en GET avec retries=2 par défaut', () => {
    window.K = { request: jest.fn().mockResolvedValue({ ok: true }) };
    utils.apiGet('/products');
    expect(window.K.request).toHaveBeenCalledWith('/products', 'GET', null, 2, {});
  });

  test('apiGet transmet les options (signal, timeoutMs, retries) à K.request', () => {
    window.K = { request: jest.fn().mockResolvedValue({}) };
    const signal = {};
    utils.apiGet('/products', { signal, timeoutMs: 5000, retries: 0 });
    expect(window.K.request).toHaveBeenCalledWith('/products', 'GET', null, 0, { signal, timeoutMs: 5000, retries: 0 });
  });

  test('apiPost appelle window.K.request en POST avec le body fourni', () => {
    window.K = { request: jest.fn().mockResolvedValue({}) };
    utils.apiPost('/cart', { qty: 2 });
    expect(window.K.request).toHaveBeenCalledWith('/cart', 'POST', { qty: 2 }, 2, {});
  });

  test('apiPost body null par défaut si non fourni', () => {
    window.K = { request: jest.fn().mockResolvedValue({}) };
    utils.apiPost('/cart');
    expect(window.K.request).toHaveBeenCalledWith('/cart', 'POST', null, 2, {});
  });

  test('apiPost lève si window.K.request absent', () => {
    expect(() => utils.apiPost('/cart', {})).toThrow(/komerce-api\.js manquant/);
  });
});
