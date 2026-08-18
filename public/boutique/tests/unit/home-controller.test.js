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
 *     rendu header+objets, cache du compteur, échappement HTML, clics
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

    it('rend le header + les objets quand des sous-catégories existent', () => {
      setViewport(1200);
      mountFixture('<div id="k-subcats-wrap"></div>');
      getCategoryLabel.mockReturnValue('Mode & Vêtements');
      getCategorySectionEmoji.mockReturnValue('👗');
      getSubcategories.mockReturnValue([
        { key: 'chaussures', shortLabel: 'Chaussures', icon: '👟' },
        { key: 'sacs', label: 'Sacs à main' },
      ]);
      state.activeSubcat = 'chaussures';

      renderSubcatRail('mode', { count: 42 });

      const wrap = document.getElementById('k-subcats-wrap');
      expect(wrap.style.display).toBe('');
      expect(wrap.dataset.parentCat).toBe('mode');
      expect(wrap.dataset.catCount).toBe('42');
      expect(wrap.textContent).toContain('Mode & Vêtements');
      expect(wrap.textContent).toContain('42');
      expect(wrap.querySelectorAll('.k-subcutout').length).toBe(3);
      const activeChip = wrap.querySelector('.k-subcutout.active');
      expect(activeChip.textContent).toContain('Chaussures');
    });

    it('réutilise le compteur en cache (dataset.catCount) si opts.count absent', () => {
      setViewport(1200);
      mountFixture('<div id="k-subcats-wrap" data-cat-count="7"></div>');
      renderSubcatRail('mode');
      expect(document.getElementById('k-subcats-wrap').textContent).toContain('7');
    });

    it('pas de sous-catégories : seule la ligne titre est rendue (pas de rail objets)', () => {
      setViewport(1200);
      mountFixture('<div id="k-subcats-wrap"></div>');
      getSubcategories.mockReturnValue([]);
      renderSubcatRail('mode');
      expect(document.querySelector('.k-subcutout-rail')).toBeNull();
      expect(document.querySelector('.k-subcutout-context')).not.toBeNull();
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
}
