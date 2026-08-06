'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-cart-pill.test.js
 *
 * Lot 5 du plan de couverture boutique — js/b-cart-pill.js (318L).
 * Premier des 3 fichiers "sans export" du lot (pattern validé ici) : le
 * module s'auto-initialise selon `document.readyState`, sans jamais rien
 * exporter.
 *
 * Gate d'activation réelle (lue en source) :
 *   - `_shouldInit()` = page catalogue (#k-grid OU #k-catalog-section)
 *     ET mobile (`!isDesktop()`, dérivé de `window.innerWidth`).
 *   - Au chargement du module : si `document.readyState === 'loading'`,
 *     attend 'DOMContentLoaded' ; sinon exécute `_shouldInit()` tout de
 *     suite. jsdom expose `readyState === 'complete'` par défaut → la
 *     branche immédiate s'exécute au `require()`, à condition que le DOM
 *     attendu soit déjà monté (cf. `mountAndRequireAutoInit` du kit).
 *   - Filet de secours : `bus.on('cart:update', ...)` ré-évalue la même
 *     gate et appelle `_init()` paresseusement si jamais loupé au chargement
 *     initial (page pas encore catalogue au moment du require, par ex.).
 *
 * Dépendances : b-bus.js et b-store.js réels (bus.emit indispensable pour
 * simuler 'cart:update', state.cart lu directement par _buildPopover/
 * cartQty/cartTotal). b-cart-core.js et b-utils.js réels aussi : fonctions
 * pures déterministes (cartQty/cartTotal ne font que réduire state.cart,
 * fmt/sanitize n'ont pas d'effet de bord), mock inutile ici. isDesktop()
 * (b-scroll-owner.js) n'est PAS mocké : il lit `window.innerWidth`
 * directement, donc `setViewportWidth()` du kit suffit à le piloter sans
 * mock de module.
 *
 * jsdom ne fournit ni vrai layout (`offsetWidth`/`offsetHeight` valent 0
 * pour tout élément détaché de layout réel) ni `ResizeObserver` : les
 * calculs de snap qui en dépendent sont vérifiés avec pw=ph=0 (constant et
 * prévisible), pas avec des dimensions réalistes.
 */

const {
  trackDocumentListeners, trackWindowListeners,
  resetLocalStorage, setViewportWidth,
  mountAndRequireAutoInit,
} = require('./helpers/boutiqueTestKit.js');

const SNAP_MARGIN = 14;
const MOBILE_W = 375;
const MOBILE_H = 800;
const DESKTOP_W = 1280;

function setViewportHeight(height) {
  Object.defineProperty(window, 'innerHeight', {
    writable: true, configurable: true, value: height,
  });
}

function requireFreshPillModule(fixtureHtml = '') {
  return mountAndRequireAutoInit(
    () => require('../../js/b-cart-pill.js'),
    fixtureHtml,
  );
}

describe('b-cart-pill', () => {
  let state;
  let bus;
  let restoreDocListeners;
  let restoreWindowListeners;

  beforeEach(() => {
    // Piège documenté dans boutiqueTestKit.js (trackDocumentListeners /
    // trackWindowListeners) : `document.addEventListener('click', ...)` et
    // `window.addEventListener('resize', ...)` sont posés par `_init()`
    // sans jamais être retirés (pas de guard au-delà de `_pillInited`, qui
    // lui repart à zéro à chaque `jest.resetModules()` — mais `document`/
    // `window` eux-mêmes ne sont jamais recréés).
    restoreDocListeners = trackDocumentListeners();
    restoreWindowListeners = trackWindowListeners();

    jest.resetModules();
    jest.useFakeTimers();
    document.body.innerHTML = '';
    resetLocalStorage();
    setViewportWidth(DESKTOP_W);
    setViewportHeight(MOBILE_H);

    ({ state } = require('../../js/b-store.js'));
    ({ bus } = require('../../js/b-bus.js'));
    state.cart = [];
  });

  afterEach(() => {
    jest.useRealTimers();
    restoreDocListeners();
    restoreWindowListeners();
  });

  describe('gate d\'activation (catalogue × desktop/mobile)', () => {
    it('catalogue (#k-grid) + mobile : crée la pill immédiatement au require', () => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-grid"></div>');
      expect(document.querySelector('.kpill')).not.toBeNull();
      expect(document.querySelector('.kpill-pop')).not.toBeNull();
    });

    it('catalogue (#k-catalog-section) + mobile : crée la pill (sélecteur alternatif)', () => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-catalog-section"></div>');
      expect(document.querySelector('.kpill')).not.toBeNull();
    });

    it('hors catalogue : ne crée pas la pill même sur mobile', () => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-other-page"></div>');
      expect(document.querySelector('.kpill')).toBeNull();
    });

    it('desktop : ne crée pas la pill même sur le catalogue', () => {
      setViewportWidth(DESKTOP_W);
      requireFreshPillModule('<div id="k-grid"></div>');
      expect(document.querySelector('.kpill')).toBeNull();
    });
  });

  describe('filet de secours bus (\'cart:update\')', () => {
    beforeEach(() => {
      // document.readyState vaut 'complete' par défaut dans jsdom : pour
      // observer la branche paresseuse (_init() déclenché depuis le
      // handler bus, pas au require), on force la branche différée du
      // module en simulant un chargement en cours.
      Object.defineProperty(document, 'readyState', {
        value: 'loading', configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(document, 'readyState', {
        value: 'complete', configurable: true,
      });
    });

    it('mobile + catalogue : cart:update initialise la pill paresseusement puis la rend', () => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-grid"></div>');
      expect(document.querySelector('.kpill')).toBeNull();

      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 2 }];
      bus.emit('cart:update');

      const pill = document.querySelector('.kpill');
      expect(pill).not.toBeNull();
      expect(pill.classList.contains('kpill--visible')).toBe(true);
    });

    it('desktop : cart:update ignoré, aucune pill créée', () => {
      setViewportWidth(DESKTOP_W);
      requireFreshPillModule('<div id="k-grid"></div>');
      bus.emit('cart:update');
      expect(document.querySelector('.kpill')).toBeNull();
    });

    it('hors catalogue : cart:update ignoré, aucune pill créée', () => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-other-page"></div>');
      bus.emit('cart:update');
      expect(document.querySelector('.kpill')).toBeNull();
    });
  });

  describe('rendu de la pill (_renderPill)', () => {
    beforeEach(() => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-grid"></div>');
    });

    it('panier vide : pill présente mais non visible, popover fermé', () => {
      bus.emit('cart:update');
      const pill = document.querySelector('.kpill');
      expect(pill.classList.contains('kpill--visible')).toBe(false);
      expect(document.querySelector('.kpill-pop').classList.contains('kpill-pop--open')).toBe(false);
    });

    it('panier non vide : affiche quantité totale et total formaté', () => {
      state.cart = [
        { product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 2 },
        { product: { id: 2, name: 'Huile', price_kmf: 2500 }, qty: 1 },
      ];
      bus.emit('cart:update');

      const pill = document.querySelector('.kpill');
      expect(pill.classList.contains('kpill--visible')).toBe(true);
      expect(pill.querySelector('.kpill-badge').textContent).toBe('3');
      // total = 2*1000 + 1*2500 = 4500 KMF
      expect(pill.querySelector('.kpill-total').textContent).toContain('4');
      expect(pill.querySelector('.kpill-total').textContent).toContain('500');
    });

    it('panier qui repasse à vide : masque la pill et ferme le popover ouvert', () => {
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];
      bus.emit('cart:update');
      const popover = document.querySelector('.kpill-pop');
      popover.classList.add('kpill-pop--open'); // simule un popover resté ouvert

      state.cart = [];
      bus.emit('cart:update');

      expect(document.querySelector('.kpill').classList.contains('kpill--visible')).toBe(false);
      expect(popover.classList.contains('kpill-pop--open')).toBe(false);
    });
  });

  describe('tap (clic sans drag) : ouverture/fermeture du popover', () => {
    let pill;

    beforeEach(() => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-grid"></div>');
      state.cart = [{ product: { id: 1, name: 'Riz basmati', price_kmf: 1000 }, qty: 2 }];
      bus.emit('cart:update');
      pill = document.querySelector('.kpill');
    });

    function tap(x = 10, y = 10) {
      pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
    }

    it('premier tap : ouvre le popover avec le contenu du panier', () => {
      tap();
      const popover = document.querySelector('.kpill-pop');
      expect(popover.classList.contains('kpill-pop--open')).toBe(true);
      expect(popover.textContent).toContain('Riz basmati');
      expect(popover.querySelector('.kpill-pop-qty').textContent).toBe('2');
    });

    it('second tap : referme le popover déjà ouvert', () => {
      tap();
      tap();
      expect(document.querySelector('.kpill-pop').classList.contains('kpill-pop--open')).toBe(false);
    });

    it('clic sur le bouton de fermeture du popover : le referme', () => {
      tap();
      document.querySelector('.kpill-pop-close').click();
      expect(document.querySelector('.kpill-pop').classList.contains('kpill-pop--open')).toBe(false);
    });

    it('clic en dehors de la pill et du popover : referme le popover ouvert', () => {
      tap();
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(document.querySelector('.kpill-pop').classList.contains('kpill-pop--open')).toBe(false);
    });

    it('panier vidé pendant que le popover est ouvert : _buildPopover le referme (liste vide)', () => {
      tap();
      state.cart = [];
      bus.emit('cart:update');
      // Le popover reste marqué ouvert par _renderPill (early return sur
      // !hasItems → _closePopover), donc il finit fermé lui aussi.
      expect(document.querySelector('.kpill-pop').classList.contains('kpill-pop--open')).toBe(false);
    });
  });

  describe('drag (déplacement au-delà du seuil anti-tap)', () => {
    let pill;

    beforeEach(() => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-grid"></div>');
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];
      bus.emit('cart:update');
      pill = document.querySelector('.kpill');
    });

    it('déplacement > 6px : ne déclenche pas le tap (popover reste fermé)', () => {
      pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 200, clientY: 100 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 100 }));

      expect(document.querySelector('.kpill-pop').classList.contains('kpill-pop--open')).toBe(false);
    });

    it('fin de drag : se snappe sur le bord le plus proche (pw/ph=0 en jsdom)', () => {
      // Position initiale posée par _init() (pas de position sauvegardée) :
      // left = innerWidth - 140 - SNAP_MARGIN = 375 - 140 - 14 = 221.
      pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 100, clientY: 0 }));
      // left glissé à 221+100=321, > vw/2=187.5 → snap sur le bord droit :
      // vw - pw(0) - SNAP_MARGIN = 375 - 14 = 361.
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 0 }));

      expect(pill.style.left).toBe('361px');
    });

    it('drag vers la gauche : se snappe sur le bord gauche (SNAP_MARGIN)', () => {
      pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: -200, clientY: 0 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: -200, clientY: 0 }));

      expect(pill.style.left).toBe(`${SNAP_MARGIN}px`);
    });
  });

  describe('resize', () => {
    it('recalcule le snap de la pill au resize de la fenêtre', () => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-grid"></div>');
      const pill = document.querySelector('.kpill');
      // Position initiale à droite (vw=375).
      expect(pill.style.left).toBe(`${375 - 140 - SNAP_MARGIN}px`);

      setViewportWidth(1000); // toujours mobile pour ce module (gate figée à l'init)
      window.dispatchEvent(new Event('resize'));

      // left actuel (221) reste < nouvelle moitié d'écran (500) → re-snap
      // sur le bord gauche cette fois.
      expect(pill.style.left).toBe(`${SNAP_MARGIN}px`);
    });

    it('popover ouvert au resize : repositionné sans crash', () => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-grid"></div>');
      state.cart = [{ product: { id: 1, name: 'Riz', price_kmf: 1000 }, qty: 1 }];
      bus.emit('cart:update');
      const pill = document.querySelector('.kpill');
      pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 10 }));
      expect(document.querySelector('.kpill-pop').classList.contains('kpill-pop--open')).toBe(true);

      expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
      expect(document.querySelector('.kpill-pop').classList.contains('kpill-pop--open')).toBe(true);
    });
  });

  describe('persistance de position (localStorage kmrc_pill_pos)', () => {
    it('premier montage sans position sauvegardée : position par défaut (droite, milieu)', () => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-grid"></div>');
      const pill = document.querySelector('.kpill');
      expect(pill.style.left).toBe(`${MOBILE_W - 140 - SNAP_MARGIN}px`);
      expect(pill.style.top).toBe(`${Math.round(MOBILE_H / 2)}px`);
    });

    it('un drag persiste la position en localStorage, relue au montage suivant', () => {
      setViewportWidth(MOBILE_W);
      requireFreshPillModule('<div id="k-grid"></div>');
      let pill = document.querySelector('.kpill');

      // Drag vers la gauche → snap sur le bord gauche (14px = SNAP_MARGIN).
      // jsdom retourne offsetWidth=0 pour la pill → la clamp au reload est
      // _clamp(14, 0, vw-120=255) = 14 : pas de troncature, restauration exacte.
      pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: -300, clientY: 0 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: -300, clientY: 0 }));
      const savedLeft = pill.style.left; // '14px' = SNAP_MARGIN

      const saved = JSON.parse(localStorage.getItem('kmrc_pill_pos'));
      expect(saved.left).toBe(parseFloat(savedLeft));

      // Nouveau montage (nouvelle page) : la position sauvegardée est relue
      // et appliquée (bornée par _clamp), sans nouveau drag.
      restoreDocListeners();
      restoreWindowListeners();
      restoreDocListeners = trackDocumentListeners();
      restoreWindowListeners = trackWindowListeners();
      jest.resetModules();
      document.body.innerHTML = '';
      ({ state } = require('../../js/b-store.js'));
      ({ bus } = require('../../js/b-bus.js'));
      requireFreshPillModule('<div id="k-grid"></div>');
      pill = document.querySelector('.kpill');
      expect(pill.style.left).toBe(savedLeft);
    });
  });
});
