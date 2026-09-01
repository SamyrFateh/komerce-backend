'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/home-controller.test.js
 *
 * Lot 4 du plan de couverture boutique — js/controllers/home-controller.js
 * (339L). Contrôleur de navigation home/catalogue : rail de catégories
 * (chips), rail contextuel de sous-catégories desktop, sync sidebar legacy,
 * et sélection de catégorie (bind des clics + logique de branchement
 * mobile/desktop/pager).
 *
 * Périmètre couvert :
 *   - renderSubcatRail : no-op mobile / no-op DOM absent, masquage 'all',
 *     rendu header+pills, cache du compteur, échappement HTML, clics
 *     (retour catégories / sélection-toggle sous-cat).
 *   - centerRailChip : gardes (chip/#k-cats absents, desktop), scrollTo mobile.
 *   - syncRailActiveState : toggle classe active, centrage par défaut/désactivé,
 *     valeur de retour.
 *   - renderCategoryRail : #k-cats absent, rail déjà en sync (no-op), rail
 *     désynchronisée (clés ou image) → régénération + reset du guard `bound`.
 *   - syncDesktopSidebar : no-op mobile, sync desktop.
 *   - setupHomeController + sélection de catégorie (handleCategorySelection,
 *     non exportée, exercée via clic sur les chips) : idempotence du bind,
 *     branche flatSubcat (reset + rAF), branche pager mobile (succès/échec
 *     de scrollPagerToCat), cat==='all', bascule all→cat, re-clic même cat
 *     (desktop vs mobile), changement direct entre deux catégories,
 *     centrage de la chip active en fin de setup.
 *
 * state/dom viennent du vrai b-store.js. Dépendances lourdes mockées :
 * render-categories.js, shop-schema.js, b-catalog.js, b-scroll-owner.js.
 * setActiveCat est mocké mais reproduit les effets de bord du vrai (mutation
 * de state.activeCat/activeSubcat/flatSubcat/page), comme pratiqué dans
 * b-desktop-sidebar.test.js, car handleCategorySelection lit ces valeurs
 * juste après l'appel pour décider des branches suivantes.
 */

jest.mock('../../js/render/render-categories.js', () => ({
  renderCategoryRailMarkup: jest.fn(() => ''),
}));

jest.mock('../../js/shop-schema.js', () => ({
  getSubcategories: jest.fn(),
  getRailCategories: jest.fn(),
  getCategorySectionEmoji: jest.fn(),
  getCategoryLabel: jest.fn(),
  normalizeCategoryKey: jest.fn((key) => key),
  matchesSubcategory: jest.fn((cat, sub, productSub) => sub === productSub),
}));

jest.mock('../../js/b-catalog.js', () => ({
  renderGrid: jest.fn(),
  setActiveCat: jest.fn(),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  scrollPageToTop: jest.fn(),
  scrollPageToElement: jest.fn(),
}));

const { mountFixture, resetState, resetBodyState } = require('./helpers/boutiqueTestKit.js');

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true });
}

describe('home-controller', () => {
  let state;
  let dom;
  let renderCategoryRailMarkup;
  let getSubcategories;
  let getRailCategories;
  let getCategorySectionEmoji;
  let getCategoryLabel;
  let renderGrid;
  let setActiveCat;
  let scrollPageToTop;
  let scrollPageToElement;
  let renderSubcatRail;
  let centerRailChip;
  let syncRailActiveState;
  let renderCategoryRail;
  let syncDesktopSidebar;
  let setupHomeController;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    resetBodyState();
    window.requestAnimationFrame = (cb) => { cb(); return 0; };

    ({ renderCategoryRailMarkup } = require('../../js/render/render-categories.js'));
    ({
      getSubcategories, getRailCategories, getCategorySectionEmoji, getCategoryLabel,
    } = require('../../js/shop-schema.js'));
    ({ renderGrid, setActiveCat } = require('../../js/b-catalog.js'));
    ({ scrollPageToTop, scrollPageToElement } = require('../../js/b-scroll-owner.js'));
    ({ state, dom } = require('../../js/b-store.js'));
    resetState(state);
    dom.pageScroll = null;

    getSubcategories.mockReturnValue([]);
    getRailCategories.mockReturnValue([]);
    getCategorySectionEmoji.mockReturnValue('');
    getCategoryLabel.mockImplementation((k) => k);
    renderCategoryRailMarkup.mockReturnValue('');
    // Reproduit les effets de bord du vrai b-catalog.js:setActiveCat, dont
    // handleCategorySelection a besoin pour ses branches suivantes.
    setActiveCat.mockImplementation((cat, sub = null) => {
      state.activeCat = cat;
      state.activeSubcat = sub;
      state.flatSubcat = null;
      state.page = 0;
    });

    ({
      renderSubcatRail, centerRailChip, syncRailActiveState,
      renderCategoryRail, syncDesktopSidebar, setupHomeController,
    } = require('../../js/controllers/home-controller.js'));
  });

  afterEach(() => {
    setViewport(ORIGINAL_INNER_WIDTH);
  });

  describe('renderSubcatRail', () => {
    it('no-op en mobile (<900px)', () => {
      setViewport(500);
      mountFixture('<div id="k-subcats-wrap"></div>');
      renderSubcatRail('mode');
      expect(document.getElementById('k-subcats-wrap').innerHTML).toBe('');
    });

    it('no-op si #k-subcats-wrap absent (pas de throw)', () => {
      setViewport(1200);
      mountFixture('');
      expect(() => renderSubcatRail('mode')).not.toThrow();
    });

    it('catKey null/"all" : masque la barre et nettoie le cache', () => {
      setViewport(1200);
      mountFixture('<div id="k-subcats-wrap" data-parent-cat="mode" data-cat-count="5" style="display:block"></div>');
      document.documentElement.style.setProperty('--sidebar-top', '40px');

      renderSubcatRail('all');

      const wrap = document.getElementById('k-subcats-wrap');
      expect(wrap.style.display).toBe('none');
      expect(wrap.innerHTML).toBe('');
      expect(wrap.dataset.parentCat).toBeUndefined();
      expect(wrap.dataset.catCount).toBeUndefined();
      expect(document.documentElement.style.getPropertyValue('--sidebar-top')).toBe('');
    });

    it('rend le header + les objets détourés quand des sous-catégories existent', () => {
      setViewport(1200);
      mountFixture('<div id="k-subcats-wrap"></div>');
      getCategoryLabel.mockReturnValue('Mode & Vêtements');
      getCategorySectionEmoji.mockReturnValue('👗');
      getSubcategories.mockReturnValue([
        { key: 'chaussures', shortLabel: 'Chaussures', icon: '👟' },
        { key: 'sacs', label: 'Sacs à main' },
      ]);
      state.activeSubcat = 'chaussures';
      state.products = [
        { id: 'p-photo', product_ref: 'PHOTO-001', category: 'mode', subcategory: 'chaussures', image_url: 'https://cdn.example.test/chaussure.webp', sort_order: 1 },
      ];

      renderSubcatRail('mode', { count: 42 });

      const wrap = document.getElementById('k-subcats-wrap');
      expect(wrap.style.display).toBe('');
      expect(wrap.dataset.parentCat).toBe('mode');
      expect(wrap.dataset.catCount).toBe('42');
      expect(wrap.textContent).toContain('Mode & Vêtements');
      expect(wrap.textContent).toContain('42');
      // "Tout voir" + 2 sous-catégories
      expect(wrap.querySelectorAll('.k-subcutout').length).toBe(3);
      const activeChip = wrap.querySelector('.k-subcutout.active');
      expect(activeChip.textContent).toContain('Chaussures');
      expect(activeChip.dataset.shelfMedia).toBe('product');
      expect(activeChip.querySelector('img.k-shelf-product-photo')?.getAttribute('src')).toBe('https://cdn.example.test/chaussure.webp');
    });

    it('réutilise le compteur en cache (dataset.catCount) si opts.count absent', () => {
      setViewport(1200);
      mountFixture('<div id="k-subcats-wrap" data-cat-count="7"></div>');
      renderSubcatRail('mode');
      expect(document.getElementById('k-subcats-wrap').textContent).toContain('7');
    });

    it('pas de sous-catégories : seule la ligne titre est rendue (pas de .k-subcats-rail)', () => {
      setViewport(1200);
      mountFixture('<div id="k-subcats-wrap"></div>');
      getSubcategories.mockReturnValue([]);
      renderSubcatRail('mode');
      expect(document.querySelector('.k-subcats-rail')).toBeNull();
      expect(document.querySelector('.k-subcats-context')).not.toBeNull();
    });

    it('échappe les valeurs injectées dans le label (anti-XSS)', () => {
      setViewport(1200);
      mountFixture('<div id="k-subcats-wrap"></div>');
      getCategoryLabel.mockReturnValue('<script>x</script>');
      renderSubcatRail('mode');
      expect(document.getElementById('k-subcats-wrap').innerHTML).not.toContain('<script>');
    });

    it('clic sur le bouton retour : bascule vers "all" et scrolle en haut', () => {
      setViewport(1200);
      mountFixture('<div id="k-subcats-wrap"></div>');
      renderSubcatRail('mode');
      document.querySelector('[data-back-all="1"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(setActiveCat).toHaveBeenCalledWith('all');
      expect(scrollPageToTop).toHaveBeenCalledWith('smooth');
    });

    it('clic sur une sous-cat inactive : la sélectionne et re-render grille+rail', () => {
      setViewport(1200);
      mountFixture('<div id="k-subcats-wrap"></div>');
      getSubcategories.mockReturnValue([{ key: 'chaussures', label: 'Chaussures' }]);
      state.activeSubcat = null;
      renderSubcatRail('mode');
      document.querySelector('.k-subcutout[data-subcat="chaussures"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(state.activeSubcat).toBe('chaussures');
      expect(renderGrid).toHaveBeenCalled();
    });

    it('clic sur la sous-cat déjà active : toggle vers null', () => {
      setViewport(1200);
      mountFixture('<div id="k-subcats-wrap"></div>');
      getSubcategories.mockReturnValue([{ key: 'chaussures', label: 'Chaussures' }]);
      state.activeSubcat = 'chaussures';
      renderSubcatRail('mode');
      document.querySelector('.k-subcutout[data-subcat="chaussures"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(state.activeSubcat).toBeNull();
    });
  });

  describe('centerRailChip', () => {
    it('no-op si chip absent', () => {
      mountFixture('<div id="k-cats"></div>');
      expect(() => centerRailChip(null)).not.toThrow();
    });

    it('no-op si #k-cats absent', () => {
      mountFixture('');
      const fakeChip = document.createElement('div');
      expect(() => centerRailChip(fakeChip)).not.toThrow();
    });

    it('no-op en desktop (>=900px)', () => {
      setViewport(1200);
      mountFixture('<div id="k-cats"><div class="k-chip"></div></div>');
      const catsEl = document.getElementById('k-cats');
      catsEl.scrollTo = jest.fn();
      centerRailChip(document.querySelector('.k-chip'));
      expect(catsEl.scrollTo).not.toHaveBeenCalled();
    });

    it('centre la chip via scrollTo en mobile', () => {
      setViewport(500);
      mountFixture('<div id="k-cats"><div class="k-chip"></div></div>');
      const catsEl = document.getElementById('k-cats');
      catsEl.scrollTo = jest.fn();
      centerRailChip(document.querySelector('.k-chip'));
      expect(catsEl.scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ left: expect.any(Number), behavior: 'smooth' }),
      );
    });
  });

  describe('syncRailActiveState', () => {
    function mountChips() {
      mountFixture(`
        <div id="k-cats">
          <div class="k-chip" data-cat="all"></div>
          <div class="k-chip" data-cat="mode"></div>
        </div>
      `);
    }

    it('active la chip correspondante et désactive les autres', () => {
      mountChips();
      syncRailActiveState('mode', { center: false });
      const chips = document.querySelectorAll('.k-chip');
      expect(chips[0].classList.contains('active')).toBe(false);
      expect(chips[1].classList.contains('active')).toBe(true);
    });

    it('retourne null si aucune chip ne correspond, sinon la chip', () => {
      mountChips();
      expect(syncRailActiveState('inconnu', { center: false })).toBeNull();
      expect(syncRailActiveState('mode', { center: false })).not.toBeNull();
    });

    it('centre par défaut (center non fourni)', () => {
      setViewport(500);
      mountChips();
      const catsEl = document.getElementById('k-cats');
      catsEl.scrollTo = jest.fn();
      syncRailActiveState('mode');
      expect(catsEl.scrollTo).toHaveBeenCalled();
    });

    it('ne centre pas si center:false', () => {
      setViewport(500);
      mountChips();
      const catsEl = document.getElementById('k-cats');
      catsEl.scrollTo = jest.fn();
      syncRailActiveState('mode', { center: false });
      expect(catsEl.scrollTo).not.toHaveBeenCalled();
    });
  });

  describe('renderCategoryRail', () => {
    it('retourne null si #k-cats absent', () => {
      mountFixture('');
      expect(renderCategoryRail()).toBeNull();
    });

    it('régénère le markup si la rail n\'est pas encore en sync', () => {
      mountFixture('<div id="k-cats"></div>');
      getRailCategories.mockReturnValue([{ key: 'mode', image: '' }]);
      renderCategoryRailMarkup.mockReturnValue('<div class="k-chip" data-cat="mode"></div>');

      const catsEl = renderCategoryRail();

      expect(renderCategoryRailMarkup).toHaveBeenCalledWith(state.activeCat);
      expect(catsEl.querySelectorAll('.k-chip').length).toBe(1);
      expect(catsEl.dataset.bound).toBeUndefined();
    });

    it('ne régénère pas si déjà en sync (mêmes clés, pas d\'image attendue)', () => {
      mountFixture('<div id="k-cats" data-bound="1"><div class="k-chip" data-cat="mode"></div></div>');
      getRailCategories.mockReturnValue([{ key: 'mode', image: '' }]);

      renderCategoryRail();

      expect(renderCategoryRailMarkup).not.toHaveBeenCalled();
      expect(document.getElementById('k-cats').dataset.bound).toBe('1');
    });

    it('régénère si une image attendue diffère de celle en place', () => {
      mountFixture(`<div id="k-cats" data-bound="1">
        <div class="k-chip" data-cat="mode"><span class="k-chip-photo"><img src="old.jpg"></span></div>
      </div>`);
      getRailCategories.mockReturnValue([{ key: 'mode', image: 'new.jpg' }]);
      renderCategoryRailMarkup.mockReturnValue('<div class="k-chip" data-cat="mode"></div>');

      renderCategoryRail();

      expect(renderCategoryRailMarkup).toHaveBeenCalled();
      expect(document.getElementById('k-cats').dataset.bound).toBeUndefined();
    });
  });

  describe('syncDesktopSidebar', () => {
    it('no-op en mobile', () => {
      setViewport(500);
      mountFixture('<div class="k-sidebar-cat" data-cat="mode"></div>');
      syncDesktopSidebar('mode');
      expect(document.querySelector('.k-sidebar-cat').classList.contains('is-active')).toBe(false);
    });

    it('active l\'item correspondant en desktop, désactive les autres', () => {
      setViewport(1200);
      mountFixture(`
        <div class="k-sidebar-cat" data-cat="mode"></div>
        <div class="k-sidebar-cat" data-cat="maison"></div>
      `);
      syncDesktopSidebar('mode');
      const items = document.querySelectorAll('.k-sidebar-cat');
      expect(items[0].classList.contains('is-active')).toBe(true);
      expect(items[1].classList.contains('is-active')).toBe(false);
    });
  });

  describe('setupHomeController / sélection de catégorie', () => {
    function makeDeps() {
      return {
        renderGrid: jest.fn(),
        scrollPagerToCat: jest.fn(() => false),
        scrollToCategorySection: jest.fn(),
      };
    }

    function mountRail(cats) {
      mountFixture(`<div id="k-cats">${cats.map((c) => `<div class="k-chip" data-cat="${c}"></div>`).join('')}</div>`);
      getRailCategories.mockReturnValue(cats.map((key) => ({ key, image: '' })));
      // jsdom n'implémente pas Element.prototype.scrollTo : centerRailChip()
      // (mobile) y fait un appel réel dès qu'un clic change la catégorie
      // active. On stub systématiquement ici pour ne pas faire dépendre
      // chaque test mobile d'un stub manuel — les tests qui veulent espionner
      // l'appel remplacent déjà catsEl.scrollTo eux-mêmes après mountRail().
      document.getElementById('k-cats').scrollTo = jest.fn();
    }

    it('no-op si #k-cats absent', () => {
      mountFixture('');
      expect(() => setupHomeController(makeDeps())).not.toThrow();
    });

    it('ne re-bind pas les listeners si déjà bound', () => {
      setViewport(1200);
      mountRail(['all', 'mode']);
      const deps = makeDeps();
      setupHomeController(deps);
      const chip = document.querySelector('.k-chip[data-cat="mode"]');
      const addSpy = jest.spyOn(chip, 'addEventListener');
      setupHomeController(deps);
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('centre la chip .k-chip.active si présente à l\'issue du setup', () => {
      setViewport(500);
      mountRail(['all', 'mode']);
      document.querySelector('.k-chip[data-cat="mode"]').classList.add('active');
      const catsEl = document.getElementById('k-cats');
      catsEl.scrollTo = jest.fn();
      setupHomeController(makeDeps());
      expect(catsEl.scrollTo).toHaveBeenCalled();
    });

    it('flatSubcat actif : le réinitialise, re-render la grille (deps) et relance la sélection via rAF', () => {
      setViewport(1200);
      mountRail(['all', 'mode']);
      state.activeCat = 'all';
      state.flatSubcat = 'promo';
      const deps = makeDeps();
      setupHomeController(deps);

      document.querySelector('.k-chip[data-cat="mode"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(state.flatSubcat).toBeNull();
      expect(deps.renderGrid).toHaveBeenCalled();
      // rAF synchrone dans les tests → la sélection relancée aboutit bien à mode
      expect(setActiveCat).toHaveBeenCalledWith('mode');
    });

    it("cat === 'all' déjà actif : scroll top uniquement, pas de changement d'état", () => {
      setViewport(1200);
      mountRail(['all', 'mode']);
      state.activeCat = 'all';
      setupHomeController(makeDeps());

      document.querySelector('.k-chip[data-cat="all"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(scrollPageToTop).toHaveBeenCalledWith('smooth');
      expect(setActiveCat).not.toHaveBeenCalled();
    });

    it("bascule all → cat (desktop) : setActiveCat + renderSubcatRail + scroll catalogue", () => {
      setViewport(1200);
      mountRail(['all', 'mode']);
      document.body.insertAdjacentHTML('beforeend', '<div id="k-grid"></div>');
      state.activeCat = 'all';
      setupHomeController(makeDeps());

      document.querySelector('.k-chip[data-cat="mode"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(setActiveCat).toHaveBeenCalledWith('mode');
      expect(state.activeSubcat).toBeNull();
      expect(scrollPageToElement).toHaveBeenCalled();
    });

    it('re-clic sur la catégorie déjà active en desktop : pas de changement d\'état, scroll catalogue', () => {
      setViewport(1200);
      mountRail(['all', 'mode']);
      document.body.insertAdjacentHTML('beforeend', '<div id="k-grid"></div>');
      state.activeCat = 'mode';
      setupHomeController(makeDeps());

      document.querySelector('.k-chip[data-cat="mode"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(setActiveCat).not.toHaveBeenCalled();
      expect(scrollPageToElement).toHaveBeenCalled();
    });

    it('re-clic sur la catégorie déjà active en mobile : reset vers "all"', () => {
      setViewport(500);
      mountRail(['all', 'mode']);
      state.activeCat = 'mode';
      setupHomeController(makeDeps());

      document.querySelector('.k-chip[data-cat="mode"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(setActiveCat).toHaveBeenCalledWith('all');
    });

    it('changement direct entre deux catégories non "all"', () => {
      setViewport(1200);
      mountRail(['all', 'mode', 'maison']);
      state.activeCat = 'mode';
      setupHomeController(makeDeps());

      document.querySelector('.k-chip[data-cat="maison"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(setActiveCat).toHaveBeenCalledWith('maison');
      expect(state.activeSubcat).toBeNull();
    });

    it('pager mobile actif et scrollPagerToCat réussit : court-circuite (pas de setActiveCat catalogue)', () => {
      setViewport(500);
      mountRail(['all', 'mode']);
      document.body.insertAdjacentHTML('beforeend', '<div id="k-grid" class="k-grid-cat-pager"></div>');
      dom.pageScroll = document.createElement('div');
      dom.pageScroll.classList.add('k-pager-active');
      state.activeCat = 'all';
      const deps = makeDeps();
      deps.scrollPagerToCat = jest.fn(() => true);
      setupHomeController(deps);

      document.querySelector('.k-chip[data-cat="mode"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(deps.scrollPagerToCat).toHaveBeenCalledWith('mode');
      // setActiveCatState (b-store réel) a bien posé l'état, sans passer par
      // b-catalog.js:setActiveCat (mocké) puisque le early-return coupe le flow.
      expect(state.activeCat).toBe('mode');
      expect(setActiveCat).not.toHaveBeenCalled();
    });

    it('pager mobile actif mais scrollPagerToCat échoue : le flow continue (fallback reset "all")', () => {
      setViewport(500);
      mountRail(['all', 'mode']);
      document.body.insertAdjacentHTML('beforeend', '<div id="k-grid" class="k-grid-cat-pager"></div>');
      dom.pageScroll = document.createElement('div');
      dom.pageScroll.classList.add('k-pager-active');
      state.activeCat = 'all';
      const deps = makeDeps();
      deps.scrollPagerToCat = jest.fn(() => false);
      setupHomeController(deps);

      document.querySelector('.k-chip[data-cat="mode"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(deps.scrollPagerToCat).toHaveBeenCalledWith('mode');
      // setActiveCatState a déjà posé activeCat='mode' avant l'échec du scroll ;
      // cat === state.activeCat déclenche alors la branche "re-clic mobile"
      // qui réinitialise vers 'all' via b-catalog.js:setActiveCat (mocké).
      expect(setActiveCat).toHaveBeenCalledWith('all');
    });
  });
});
