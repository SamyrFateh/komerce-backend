'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-subcat.test.js
 *
 * Lot 5 — js/b-subcat.js (673 L, 9 exports).
 * Exports :
 *   initFlatSubcat          — point d'entrée public (orchestrateur)
 *   renderSubcatChips       — stub no-op documenté : rendu inline dans b-modal.js
 *   _setupFlatSubcatPager   — pose le layout flat + listeners scroll/touch/drag
 *   _renderFlatSubcat       — retourne le HTML des pages du pager
 *   _mountFlatSubcatChrome  — injecte le chrome (header + tabs) au-dessus du grid
 *   _unmountFlatSubcatChrome — retire le chrome (cleanup)
 *   _bindFlatSubcatControls — wire bouton ✕ et clics tabs
 *   _scrollFlatPagerToSub   — scrolle le grid vers une sous-cat
 *   _syncFlatActiveTab      — met à jour le tab actif + label + compteur
 *   _recalcPagerHeight      — recalcule --pager-h (CSS var)
 *
 * Dépendances mockées : b-scroll-owner, b-pager, b-catalog, b-modal, b-cart,
 *   b-cart-core, shop-schema. b-utils et b-bus restent réels (fonctions pures,
 *   pas d'effet réseau).
 */

/* ── Mocks (hoistés avant les imports) ── */

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false),
  getScrollY: jest.fn(() => 0),
  DESKTOP_BREAKPOINT: 900,
}));

jest.mock('../../js/b-pager.js', () => ({
  _setupMobilePager: jest.fn(),
  destroyMobilePager: jest.fn(),
}));

jest.mock('../../js/b-catalog.js', () => ({
  _renderCard: jest.fn((p) => `<div class="k-card" data-id="${p.id}">${p.name}</div>`),
  renderGrid: jest.fn(),
}));

jest.mock('../../js/b-modal.js', () => ({
  openModal: jest.fn(),
}));

jest.mock('../../js/b-cart.js', () => ({
  toggleFav: jest.fn(),
  quickAdd:   jest.fn(),
  quickRemove: jest.fn(),
}));

jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
  updateCartBadge: jest.fn(),
  saveCart: jest.fn(),
  cartQty: jest.fn(() => 0),
  cartTotal: jest.fn(() => 0),
}));

jest.mock('../../js/shop-schema.js', () => ({
  getSubcategories: jest.fn(() => [
    { key: 'fruits',  label: 'Fruits',   icon: '🍎', shortLabel: 'Fruits' },
    { key: 'legumes', label: 'Légumes',  icon: '🥦', shortLabel: 'Légumes' },
  ]),
  normalizeCategoryKey: jest.fn((k) => k),
  matchesSubcategory: jest.fn((category, key, value) => key === value),
}));

jest.mock('../../js/b-utils.js', () => ({
  sanitize:      jest.fn((s) => String(s || '')),
  fmt:           jest.fn((n) => String(n)),
  bindCarouselDots: jest.fn(),
  fmtPrice:      jest.fn((n) => String(n)),
  optimizeImgUrl: jest.fn((url) => url),
}));

/* ── Requires après mocks ── */

const { state, dom } = require('../../js/b-store.js');
const { isDesktop }  = require('../../js/b-scroll-owner.js');
const { destroyMobilePager } = require('../../js/b-pager.js');
const { renderGrid } = require('../../js/b-catalog.js');
const {
  renderSubcatChips,
  _setupFlatSubcatPager,
  _renderFlatSubcat,
  _mountFlatSubcatChrome,
  _unmountFlatSubcatChrome,
  _bindFlatSubcatControls,
  _scrollFlatPagerToSub,
  _syncFlatActiveTab,
  _recalcPagerHeight,
} = require('../../js/b-subcat.js');

/* ── Helpers ── */

function setupFlatState(cat = 'alimentation', sub = 'fruits') {
  state.flatSubcat = { cat, sub };
  state.filtered = [
    { id: 1, name: 'Banane', category: 'alimentation', subcategory: 'fruits', price_kmf: 500 },
    { id: 2, name: 'Pomme',  category: 'alimentation', subcategory: 'fruits', price_kmf: 600 },
    { id: 3, name: 'Carotte',category: 'alimentation', subcategory: 'legumes', price_kmf: 300 },
  ];
  state.pageSize = 20;
}

function mountCatalogSection(extraHtml = '') {
  document.body.innerHTML = `
    <div id="k-catalog-section">
      <div id="k-grid">${extraHtml}</div>
    </div>`;
  return {
    section: document.getElementById('k-catalog-section'),
    grid: document.getElementById('k-grid'),
  };
}

beforeEach(() => {
  isDesktop.mockReturnValue(false);
  destroyMobilePager.mockClear();
  renderGrid.mockClear();
  state.flatSubcat  = null;
  state.filtered    = [];
  state.pageSize    = 20;
  state.sectionSubcats = {};
  state.page = 0;
  dom.pageScroll = null;
  document.body.innerHTML = '';
  document.documentElement.style.removeProperty('--pager-h');
});

/* ═══════════════════════════════════════════════════════════════════════════ */

describe('renderSubcatChips (stub no-op)', () => {
  it('est exporté, ne lève pas d\'erreur et retourne undefined', () => {
    expect(typeof renderSubcatChips).toBe('function');
    // Le rendu réel est inline dans b-modal.js/renderSuggestions.
    // Ce stub est conservé pour compatibilité d'import.
    expect(renderSubcatChips('alimentation')).toBeUndefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('_recalcPagerHeight', () => {
  it('pose --pager-h sur documentElement', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    _recalcPagerHeight();
    const val = document.documentElement.style.getPropertyValue('--pager-h');
    expect(val).toBeTruthy();
    expect(val.endsWith('px')).toBe(true);
  });

  it('ne lève pas d\'erreur si les éléments header/hero/cats sont absents', () => {
    expect(() => _recalcPagerHeight()).not.toThrow();
  });

  it('soustrait la hauteur des éléments fixés du viewport', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    // Sans éléments : usedH = 0 → --pager-h devrait être proche de 800
    _recalcPagerHeight();
    const val = parseInt(document.documentElement.style.getPropertyValue('--pager-h'), 10);
    expect(val).toBeGreaterThan(0);
    expect(val).toBeLessThanOrEqual(800);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('_unmountFlatSubcatChrome', () => {
  it('retire #k-flat-subcat-chrome du DOM s\'il existe', () => {
    const chrome = document.createElement('div');
    chrome.id = 'k-flat-subcat-chrome';
    document.body.appendChild(chrome);

    _unmountFlatSubcatChrome();

    expect(document.getElementById('k-flat-subcat-chrome')).toBeNull();
  });

  it('sans chrome dans le DOM : ne lève pas d\'erreur', () => {
    expect(() => _unmountFlatSubcatChrome()).not.toThrow();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('_mountFlatSubcatChrome', () => {
  it('insère #k-flat-subcat-chrome AVANT #k-grid dans #k-catalog-section', () => {
    setupFlatState();
    // Générer le headerHtml d'abord via _renderFlatSubcat
    _renderFlatSubcat();
    const { section, grid } = mountCatalogSection();

    _mountFlatSubcatChrome();

    const chrome = document.getElementById('k-flat-subcat-chrome');
    expect(chrome).not.toBeNull();
    expect(section.children[0]).toBe(chrome);
    expect(section.children[1]).toBe(grid);
  });

  it('appelle destroyMobilePager pour couper le pager principal', () => {
    setupFlatState();
    _renderFlatSubcat();
    mountCatalogSection();

    _mountFlatSubcatChrome();

    expect(destroyMobilePager).toHaveBeenCalled();
  });

  it('sans #k-catalog-section : ne lève pas d\'erreur', () => {
    expect(() => _mountFlatSubcatChrome()).not.toThrow();
  });

  it('une deuxième invocation remplace l\'ancien chrome (idempotence)', () => {
    setupFlatState();
    _renderFlatSubcat();
    mountCatalogSection();

    _mountFlatSubcatChrome();
    _mountFlatSubcatChrome();

    expect(document.querySelectorAll('#k-flat-subcat-chrome').length).toBe(1);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('_renderFlatSubcat', () => {
  it('sans state.flatSubcat : retourne une chaîne vide', () => {
    state.flatSubcat = null;
    expect(_renderFlatSubcat()).toBe('');
  });

  it('avec flatSubcat valide : retourne du HTML contenant des .k-flat-subcat-page', () => {
    setupFlatState();
    const html = _renderFlatSubcat();
    expect(html).toContain('k-flat-subcat-page');
    expect(html).toContain('data-flat-sub="fruits"');
    expect(html).toContain('data-flat-sub="legumes"');
  });

  it('peuple state._flatSubcatHeaderHtml avec le chrome header + tabs', () => {
    setupFlatState();
    _renderFlatSubcat();
    expect(state._flatSubcatHeaderHtml).toContain('k-flat-subcat-header');
    expect(state._flatSubcatHeaderHtml).toContain('k-flat-subcat-tabs');
    expect(state._flatSubcatHeaderHtml).toContain('data-flat-sub="fruits"');
    expect(state._flatSubcatHeaderHtml).toContain('k-shelf-emoji-fallback');
    expect(state._flatSubcatHeaderHtml).toContain('k-flat-subcat-tab-icon');
  });

  it('la page fruits inclut un k-sec-grid (produits disponibles)', () => {
    setupFlatState();
    const html = _renderFlatSubcat();
    // Fruits a 2 produits → grille non vide
    expect(html).toContain('k-sec-grid');
  });

  it('la page legumes avec 1 produit : grille générée', () => {
    setupFlatState();
    const html = _renderFlatSubcat();
    expect(html).toContain('k-flat-page-sentinel');
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('_syncFlatActiveTab', () => {
  function mountTabsUI() {
    document.body.innerHTML = `
      <div id="k-flat-subcat-tabs">
        <button class="k-flat-subcat-tab" data-flat-sub="fruits">🍎 Fruits</button>
        <button class="k-flat-subcat-tab" data-flat-sub="legumes">🥦 Légumes</button>
      </div>
      <span id="k-flat-subcat-sub-label"></span>
      <span id="k-flat-subcat-count"></span>`;
    // Polyfill jsdom : offsetLeft/clientWidth = 0 → scrollTo serait NaN → mock
    const bar = document.getElementById('k-flat-subcat-tabs');
    bar.scrollTo = jest.fn();
  }

  it('met is-active sur le bon tab', () => {
    setupFlatState('alimentation', 'fruits');
    mountTabsUI();

    _syncFlatActiveTab('legumes');

    const tabs = document.querySelectorAll('.k-flat-subcat-tab');
    expect(tabs[0].classList.contains('is-active')).toBe(false);  // fruits
    expect(tabs[1].classList.contains('is-active')).toBe(true);   // legumes
  });

  it('met à jour state.flatSubcat.sub', () => {
    setupFlatState('alimentation', 'fruits');
    mountTabsUI();

    _syncFlatActiveTab('legumes');

    expect(state.flatSubcat.sub).toBe('legumes');
  });

  it('met à jour le label et le compteur produits', () => {
    setupFlatState('alimentation', 'fruits');
    mountTabsUI();

    _syncFlatActiveTab('fruits');

    const lbl = document.getElementById('k-flat-subcat-sub-label');
    const cnt = document.getElementById('k-flat-subcat-count');
    // Le label contient l'icône + le libellé de sous-cat
    expect(lbl.textContent).toContain('Fruits');
    // Le compteur reflète les produits filtrés (2 fruits dans state.filtered)
    expect(cnt.textContent).toContain('2');
  });

  it('sans state.flatSubcat : ne lève pas d\'erreur', () => {
    state.flatSubcat = null;
    expect(() => _syncFlatActiveTab('fruits')).not.toThrow();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('_scrollFlatPagerToSub', () => {
  function mountPagerGrid() {
    document.body.innerHTML = `
      <div id="k-grid">
        <div class="k-flat-subcat-page" data-flat-sub="fruits"></div>
        <div class="k-flat-subcat-page" data-flat-sub="legumes"></div>
      </div>`;
    const grid = document.getElementById('k-grid');
    grid.scrollTo = jest.fn();
    return grid;
  }

  it('appelle grid.scrollTo avec la position de la page cible', () => {
    setupFlatState();
    const grid = mountPagerGrid();

    _scrollFlatPagerToSub('legumes');

    expect(grid.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  });

  it('sous-cat absente du DOM : ne lève pas d\'erreur', () => {
    setupFlatState();
    mountPagerGrid();
    expect(() => _scrollFlatPagerToSub('inexistante')).not.toThrow();
  });

  it('sans #k-grid : ne lève pas d\'erreur', () => {
    expect(() => _scrollFlatPagerToSub('fruits')).not.toThrow();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('_bindFlatSubcatControls', () => {
  function mountControlsUI() {
    setupFlatState();
    const { grid } = mountCatalogSection();
    grid.scrollTo = jest.fn();

    // Simuler le chrome monté avec les boutons
    const chrome = document.createElement('div');
    chrome.id = 'k-flat-subcat-chrome';
    chrome.innerHTML = `
      <button id="k-flat-subcat-close" aria-label="Fermer">✕</button>
      <button class="k-flat-subcat-tab" data-flat-sub="fruits">Fruits</button>
      <button class="k-flat-subcat-tab" data-flat-sub="legumes">Légumes</button>`;
    document.getElementById('k-catalog-section').insertBefore(chrome, grid);

    return grid;
  }

  it('le bouton de fermeture déclenche renderGrid et reset state.flatSubcat', () => {
    const grid = mountControlsUI();
    const ps = document.createElement('div');
    ps.scrollTo = jest.fn();
    dom.pageScroll = ps;

    _bindFlatSubcatControls();

    document.getElementById('k-flat-subcat-close').click();

    expect(state.flatSubcat).toBeNull();
    expect(renderGrid).toHaveBeenCalled();
  });

  it('clic tab : appelle _scrollFlatPagerToSub via grid.scrollTo', () => {
    const grid = mountControlsUI();
    // Ajouter des pages dans le grid pour que scrollFlatPagerToSub fonctionne
    grid.innerHTML = `
      <div class="k-flat-subcat-page" data-flat-sub="fruits"></div>
      <div class="k-flat-subcat-page" data-flat-sub="legumes"></div>`;

    _bindFlatSubcatControls();

    document.querySelector('.k-flat-subcat-tab[data-flat-sub="legumes"]').click();

    expect(grid.scrollTo).toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('_setupFlatSubcatPager', () => {
  it('sans #k-grid : ne lève pas d\'erreur', () => {
    setupFlatState();
    expect(() => _setupFlatSubcatPager()).not.toThrow();
  });

  it('sans state.flatSubcat : retourne immédiatement', () => {
    state.flatSubcat = null;
    mountCatalogSection();
    expect(() => _setupFlatSubcatPager()).not.toThrow();
  });

  it('avec grid et flatSubcat : ajoute class k-grid-flat-subcat', () => {
    setupFlatState();
    const { grid } = mountCatalogSection(`
      <div class="k-flat-subcat-page" data-flat-sub="fruits"></div>
      <div class="k-flat-subcat-page" data-flat-sub="legumes"></div>`);
    grid.scrollTo = jest.fn();

    _setupFlatSubcatPager();

    expect(grid.classList.contains('k-grid-flat-subcat')).toBe(true);
  });

  it('avec grid et flatSubcat : nettoie les styles inline du pager principal', () => {
    setupFlatState();
    const { grid } = mountCatalogSection();
    grid.scrollTo = jest.fn();
    grid.style.transform = 'translateX(-375px)';

    _setupFlatSubcatPager();

    expect(grid.style.transform).toBe('');
  });
});
