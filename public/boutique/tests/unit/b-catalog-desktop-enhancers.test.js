'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-catalog-desktop-enhancers.test.js
 *
 * Lot 4 du plan de couverture boutique — js/b-catalog-desktop-enhancers.js
 * (508L). Point d'entrée unique : setupCatalogDesktopEnhancers().
 *
 * État réel du module (lu en source, cf. commentaires ENTRY POINT) :
 *   - setupSubcatOnHover()          → ACTIF (hover chip → aperçu sous-cats)
 *   - setupPromoStrip()             → DÉSACTIVÉ (`return;` inconditionnel
 *                                      après le guard desktop — code mort
 *                                      conservé, non testé au-delà du no-op)
 *   - setupHomepageMerchandising()  → DÉSACTIVÉ (même pattern)
 *   - setupHeroSearchBar()          → DÉSACTIVÉ (`return;` avant même le
 *                                      guard desktop)
 *   - setupNavStackVar()            → ACTIF (variable CSS --nav-stack-h)
 *   - setupCardHoverObserver()      → jamais appelé (ligne commentée)
 *   - _setupViewChangedGuard()      → ACTIF (bus 'view:changed')
 *
 * Périmètre couvert :
 *   - court-circuit total mobile (!isDesktop()) : aucun listener, aucune
 *     variable CSS posée.
 *   - setupSubcatOnHover : hover chip ≠ activeCat → aperçu différé (80ms)
 *     via renderSubcatRail/syncRailActiveState ; hover chip === activeCat
 *     → no-op ; hover 'all' ou sans data-cat → ignoré ; mouseleave après
 *     aperçu actif → restauration de l'univers actif ; mouseleave sans
 *     aperçu actif → no-op ; absence de .k-cats → pas de crash.
 *   - fonctions désactivées : aucun élément injecté même si les ancres DOM
 *     existent (confirme le code mort, comportement de non-régression).
 *   - setupNavStackVar : pose --nav-stack-h au montage et au resize ;
 *     absence de #k-sticky-bar → pas de variable posée, pas de crash.
 *   - _setupViewChangedGuard : bus 'view:changed' bascule l'affichage de
 *     .k-home-merch / .k-promo-strip / .k-scroll-top selon l'onglet.
 *
 * shop-schema.js, b-catalog.js, controllers/home-controller.js et
 * b-scroll-owner.js sont mockés (dépendances hors périmètre direct, déjà/à
 * couvrir dans leurs propres suites — pattern déjà utilisé dans
 * b-desktop-upgrade.test.js pour ce même fichier vu d'un niveau au-dessus).
 * b-bus.js et b-store.js restent réels (mêmes raisons que les autres
 * fichiers du lot : bus.emit() nécessaire pour simuler 'view:changed',
 * state.activeCat est un simple champ lu par setupSubcatOnHover).
 */

jest.mock('../../js/shop-schema.js', () => ({
  getCategorySectionEmoji: jest.fn(() => '🛍️'),
  getSubcategories: jest.fn(() => []),
  getRailCategories: jest.fn(() => []),
}));
jest.mock('../../js/b-catalog.js', () => ({
  setActiveCat: jest.fn(),
}));
jest.mock('../../js/controllers/home-controller.js', () => ({
  syncRailActiveState: jest.fn(),
  renderSubcatRail: jest.fn(),
}));
jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(),
  scrollPageToTop: jest.fn(),
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
}));

const { trackWindowListeners } = require('./helpers/boutiqueTestKit.js');

function setRectHeight(el, height) {
  el.getBoundingClientRect = () => ({
    top: 0, left: 0, right: 0, bottom: height, width: 0, height,
    x: 0, y: 0, toJSON() {},
  });
}

describe('b-catalog-desktop-enhancers', () => {
  let state;
  let bus;
  let isDesktop;
  let renderSubcatRail;
  let syncRailActiveState;
  let setupCatalogDesktopEnhancers;
  let restoreWindowListeners;

  beforeEach(() => {
    // jest.resetModules() : aucune des fonctions internes n'a de guard
    // d'idempotence (pas de flag `_installed`, contrairement à
    // b-product-open-contract.js) — setupNavStackVar repose un listener
    // 'resize' et setupSubcatOnHover un mouseenter/mouseleave sur .k-cats
    // à chaque appel. On repart d'une instance fraîche à chaque test et on
    // isole les listeners `window` (le seul EventTarget qui survit à
    // resetModules ; .k-cats/#k-sticky-bar sont recréés via innerHTML='').
    restoreWindowListeners = trackWindowListeners();
    jest.resetModules();
    document.body.innerHTML = '';
    document.documentElement.style.removeProperty('--nav-stack-h');
    global.requestAnimationFrame = (cb) => { cb(); return 0; };

    ({ state } = require('../../js/b-store.js'));
    ({ bus } = require('../../js/b-bus.js'));
    ({ isDesktop } = require('../../js/b-scroll-owner.js'));
    ({ renderSubcatRail, syncRailActiveState } =
      require('../../js/controllers/home-controller.js'));
    ({ setupCatalogDesktopEnhancers } =
      require('../../js/b-catalog-desktop-enhancers.js'));

    state.activeCat = 'all';
    isDesktop.mockReturnValue(true);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    restoreWindowListeners();
  });

  describe('court-circuit mobile', () => {
    it('!isDesktop() : ne pose aucun listener ni variable CSS', () => {
      isDesktop.mockReturnValue(false);
      document.body.innerHTML = `
        <div class="k-cats"><button class="k-chip" data-cat="Tech">Tech</button></div>
        <div id="k-sticky-bar"></div>
      `;
      const addSpy = jest.spyOn(window, 'addEventListener');

      setupCatalogDesktopEnhancers();

      expect(document.documentElement.style.getPropertyValue('--nav-stack-h')).toBe('');
      expect(addSpy).not.toHaveBeenCalledWith('resize', expect.any(Function), expect.anything());
      addSpy.mockRestore();
    });
  });

  describe('setupSubcatOnHover (aperçu sous-cats au hover)', () => {
    it('absence de .k-cats : pas de crash', () => {
      document.body.innerHTML = '';
      expect(() => setupCatalogDesktopEnhancers()).not.toThrow();
    });

    it('hover chip ≠ activeCat : aperçu différé (80ms) → renderSubcatRail + syncRailActiveState', () => {
      state.activeCat = 'all';
      document.body.innerHTML = `
        <div class="k-cats"><button class="k-chip" data-cat="Tech">Tech</button></div>
      `;
      setupCatalogDesktopEnhancers();

      const chip = document.querySelector('.k-chip');
      chip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

      // Avant l'échéance du délai anti-flash : rien encore.
      jest.advanceTimersByTime(79);
      expect(renderSubcatRail).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(renderSubcatRail).toHaveBeenCalledWith('Tech');
      expect(syncRailActiveState).toHaveBeenCalledWith('Tech', { center: false });
    });

    it('hover chip === activeCat : no-op (déjà le bon rendu)', () => {
      state.activeCat = 'Tech';
      document.body.innerHTML = `
        <div class="k-cats"><button class="k-chip" data-cat="Tech">Tech</button></div>
      `;
      setupCatalogDesktopEnhancers();

      document.querySelector('.k-chip')
        .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      jest.advanceTimersByTime(200);

      expect(renderSubcatRail).not.toHaveBeenCalled();
    });

    it("hover chip data-cat='all' : ignoré", () => {
      document.body.innerHTML = `
        <div class="k-cats"><button class="k-chip" data-cat="all">Tout</button></div>
      `;
      setupCatalogDesktopEnhancers();

      document.querySelector('.k-chip')
        .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      jest.advanceTimersByTime(200);

      expect(renderSubcatRail).not.toHaveBeenCalled();
    });

    it('hover en dehors de toute chip (pas de closest .k-chip) : ignoré, pas de crash', () => {
      document.body.innerHTML = `<div class="k-cats"><span>texte</span></div>`;
      setupCatalogDesktopEnhancers();

      expect(() => document.querySelector('span')
        .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))).not.toThrow();
      expect(renderSubcatRail).not.toHaveBeenCalled();
    });

    it("mouseleave après aperçu actif : restaure l'univers actif sélectionné", () => {
      state.activeCat = 'Mode';
      document.body.innerHTML = `
        <div class="k-cats"><button class="k-chip" data-cat="Tech">Tech</button></div>
      `;
      setupCatalogDesktopEnhancers();
      const catsEl = document.querySelector('.k-cats');

      catsEl.querySelector('.k-chip')
        .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      jest.advanceTimersByTime(80);
      expect(renderSubcatRail).toHaveBeenCalledWith('Tech');

      renderSubcatRail.mockClear();
      syncRailActiveState.mockClear();
      catsEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

      expect(renderSubcatRail).toHaveBeenCalledWith('Mode');
      expect(syncRailActiveState).toHaveBeenCalledWith('Mode', { center: false });
    });

    it("mouseleave sans aperçu actif préalable : no-op", () => {
      document.body.innerHTML = `<div class="k-cats"></div>`;
      setupCatalogDesktopEnhancers();

      document.querySelector('.k-cats')
        .dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

      expect(renderSubcatRail).not.toHaveBeenCalled();
      expect(syncRailActiveState).not.toHaveBeenCalled();
    });

    it('un second hover avant échéance annule le premier timer (anti-flash)', () => {
      document.body.innerHTML = `
        <div class="k-cats">
          <button class="k-chip" data-cat="Tech">Tech</button>
          <button class="k-chip" data-cat="Mode">Mode</button>
        </div>
      `;
      setupCatalogDesktopEnhancers();
      const [tech, mode] = document.querySelectorAll('.k-chip');

      tech.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      jest.advanceTimersByTime(40);
      mode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      jest.advanceTimersByTime(80);

      expect(renderSubcatRail).toHaveBeenCalledTimes(1);
      expect(renderSubcatRail).toHaveBeenCalledWith('Mode');
    });
  });

  describe('fonctions désactivées (code mort confirmé)', () => {
    it("n'injecte ni promo strip, ni merchandising, ni barre de recherche héro même avec les ancres présentes", () => {
      document.body.innerHTML = `
        <div id="k-desktop-catalog-wrap"></div>
        <div id="k-hero-fixed-wrap"><div class="k-hero-media"></div></div>
      `;
      setupCatalogDesktopEnhancers();

      expect(document.querySelector('.k-promo-strip')).toBeNull();
      expect(document.querySelector('.k-home-merch')).toBeNull();
      expect(document.getElementById('k-optionb-search')).toBeNull();
    });
  });

  describe('setupNavStackVar (variable CSS --nav-stack-h)', () => {
    beforeEach(() => {
      // Pas de debounce à observer ici (contrairement au hover 80ms) : on
      // repasse en vrais timers pour laisser notre stub synchrone de
      // requestAnimationFrame (posé en amont) s'exécuter immédiatement —
      // les fake timers modernes de Jest interceptent aussi rAF et
      // nécessiteraient sinon un tick dédié difficile à calibrer.
      jest.useRealTimers();
    });

    it('absence de #k-sticky-bar : ne pose pas la variable, pas de crash', () => {
      document.body.innerHTML = '';
      expect(() => setupCatalogDesktopEnhancers()).not.toThrow();
      expect(document.documentElement.style.getPropertyValue('--nav-stack-h')).toBe('');
    });

    it('pose --nav-stack-h = hauteur header + barre au montage', () => {
      document.body.innerHTML = `
        <header class="k-header"></header>
        <div id="k-sticky-bar"></div>
      `;
      setRectHeight(document.querySelector('.k-header'), 72);
      setRectHeight(document.getElementById('k-sticky-bar'), 48);

      setupCatalogDesktopEnhancers();
      expect(document.documentElement.style.getPropertyValue('--nav-stack-h')).toBe('120px');
    });

    it('sans .k-header : utilise le fallback 72 pour la hauteur header', () => {
      document.body.innerHTML = `<div id="k-sticky-bar"></div>`;
      setRectHeight(document.getElementById('k-sticky-bar'), 40);

      setupCatalogDesktopEnhancers();
      expect(document.documentElement.style.getPropertyValue('--nav-stack-h')).toBe('112px');
    });

    it('resize : recalcule --nav-stack-h', () => {
      document.body.innerHTML = `
        <header class="k-header"></header>
        <div id="k-sticky-bar"></div>
      `;
      const bar = document.getElementById('k-sticky-bar');
      setRectHeight(document.querySelector('.k-header'), 72);
      setRectHeight(bar, 48);

      setupCatalogDesktopEnhancers();
      expect(document.documentElement.style.getPropertyValue('--nav-stack-h')).toBe('120px');

      setRectHeight(bar, 96); // ligne sous-cats apparue → barre plus haute
      window.dispatchEvent(new Event('resize'));
      expect(document.documentElement.style.getPropertyValue('--nav-stack-h')).toBe('168px');
    });
  });

  describe("_setupViewChangedGuard (bus 'view:changed')", () => {
    function mountViewChangedAnchors() {
      document.body.innerHTML = `
        <div class="k-home-merch"></div>
        <div class="k-promo-strip"></div>
        <div class="k-scroll-top"></div>
      `;
    }

    it("tab !== 'shop' : masque merch/promo, ne montre pas scroll-top", () => {
      mountViewChangedAnchors();
      setupCatalogDesktopEnhancers();

      bus.emit('view:changed', 'favs');

      expect(document.querySelector('.k-home-merch').style.display).toBe('none');
      expect(document.querySelector('.k-promo-strip').style.display).toBe('none');
      expect(document.querySelector('.k-scroll-top').classList.contains('is-visible')).toBe(false);
    });

    it("tab === 'shop' : réaffiche merch/promo", () => {
      mountViewChangedAnchors();
      setupCatalogDesktopEnhancers();

      bus.emit('view:changed', 'favs');
      bus.emit('view:changed', 'shop');

      expect(document.querySelector('.k-home-merch').style.display).toBe('');
      expect(document.querySelector('.k-promo-strip').style.display).toBe('');
    });

    it("tab === 'shop' + scroll > 600 : ajoute is-visible sur scroll-top", () => {
      mountViewChangedAnchors();
      getScrollYMock().mockReturnValue(650);
      setupCatalogDesktopEnhancers();

      bus.emit('view:changed', 'shop');

      expect(document.querySelector('.k-scroll-top').classList.contains('is-visible')).toBe(true);
    });

    it('éléments absents du DOM : pas de crash', () => {
      document.body.innerHTML = '';
      setupCatalogDesktopEnhancers();

      expect(() => bus.emit('view:changed', 'shop')).not.toThrow();
    });

    function getScrollYMock() {
      // eslint-disable-next-line global-require
      return require('../../js/b-scroll-owner.js').getScrollY;
    }
  });
});
