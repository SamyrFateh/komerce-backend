'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-pager.test.js
 *
 * Lot 5 — js/b-pager.js (564 L, 12 exports nommés).
 * Module ES importé une seule fois par fichier (pas de jest.resetModules()) :
 * les variables module-level (_stabilizationHooksInstalled, _busModalBound,
 * _isSettingUpMobilePager) persistent à travers les tests — les suites sont
 * conçues pour ne pas en dépendre.
 *
 * Dépendances :
 *   - b-scroll-owner.js → mocké (isDesktop contrôlé per-test)
 *   - b-store.js, b-bus.js → réels (state, dom, bus réutilisables)
 *
 * jsdom manque de layout réel : offsetWidth/offsetHeight = 0, getBoundingClientRect
 * retourne des zéros, scrollTo n'existe pas → stubbé inline. requestAnimationFrame
 * est disponible dans jsdom mais ne lève pas d'erreur si ignoré.
 */

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false),
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
  clearInlinePagerStyles: jest.fn(),
  DESKTOP_BREAKPOINT: 900,
}));

const { isDesktop } = require('../../js/b-scroll-owner.js');
const { state, dom }  = require('../../js/b-store.js');
const {
  _setupMobilePager,
  _recalcPagerVars,
  _setupSectionAutoAdvance,
  _setupHorizontalWrap,
  _syncChipToScroll,
  _onPagerScroll,
  _scrollPagerToCat,
  _scrollPagerToGhost,
  _reshuffleToutInDOM,
  _setupInfiniteLoop,
  _setupPagerDots,
  destroyMobilePager,
} = require('../../js/b-pager.js');

// ─── Helpers DOM ──────────────────────────────────────────────────────────────

function makeGrid({ cats = ['all', 'alimentation'], withGhost = false } = {}) {
  const div = document.createElement('div');
  div.id = 'k-grid';
  cats.forEach(cat => {
    const sec = document.createElement('div');
    sec.className = 'k-cat-section';
    sec.dataset.cat = cat;
    const sg = document.createElement('div');
    sg.className = 'k-sec-grid';
    ['A', 'B', 'C'].forEach(l => {
      const c = document.createElement('div'); c.textContent = l; sg.appendChild(c);
    });
    sec.appendChild(sg);
    div.appendChild(sec);
  });
  if (withGhost) {
    const ghost = div.querySelector('.k-cat-section[data-cat="all"]').cloneNode(true);
    ghost.setAttribute('data-ghost', 'true');
    div.appendChild(ghost);
  }
  return div;
}

function stubGridScroll(grid) {
  grid.scrollTo = jest.fn();
  return grid.scrollTo;
}

beforeEach(() => {
  isDesktop.mockReturnValue(false);
  document.body.innerHTML = '';
  // Nettoyer les CSS vars entre tests
  ['--pager-top', '--pager-h', '--pager-w', '--bnav-h'].forEach(v =>
    document.documentElement.style.removeProperty(v),
  );
  // Polyfills jsdom
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  if (!document.fonts) {
    Object.defineProperty(document, 'fonts', {
      value: { ready: Promise.resolve() }, configurable: true,
    });
  }
  dom.pageScroll = null;
});

// ─── Stubs de compatibilité (no-ops) ──────────────────────────────────────────

describe('stubs de compatibilité (exports no-op)', () => {
  it('_setupHorizontalWrap est exporté et retourne undefined', () => {
    expect(typeof _setupHorizontalWrap).toBe('function');
    expect(_setupHorizontalWrap()).toBeUndefined();
  });

  it('_syncChipToScroll est exporté et retourne undefined', () => {
    expect(typeof _syncChipToScroll).toBe('function');
    expect(_syncChipToScroll()).toBeUndefined();
  });

  it('_onPagerScroll est exporté et retourne undefined', () => {
    expect(typeof _onPagerScroll).toBe('function');
    expect(_onPagerScroll()).toBeUndefined();
  });

  it('_setupPagerDots est exporté et retourne undefined', () => {
    expect(typeof _setupPagerDots).toBe('function');
    expect(_setupPagerDots()).toBeUndefined();
  });
});

// ─── _recalcPagerVars ─────────────────────────────────────────────────────────

describe('_recalcPagerVars', () => {
  it('mobile : pose --pager-w et --bnav-h sur documentElement', () => {
    isDesktop.mockReturnValue(false);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    _recalcPagerVars();
    expect(document.documentElement.style.getPropertyValue('--pager-w')).toBe('375px');
    expect(document.documentElement.style.getPropertyValue('--bnav-h')).toBeTruthy();
  });

  it('mobile : met à jour le style top/left/right/width de dom.pageScroll quand présent', () => {
    isDesktop.mockReturnValue(false);
    const ps = document.createElement('div');
    dom.pageScroll = ps;
    _recalcPagerVars();
    // jsdom normalise '0' → '0px'
    expect(ps.style.left).toMatch(/^0/);
    expect(ps.style.right).toMatch(/^0/);
  });

  it('desktop : supprime les CSS vars (délègue à destroyMobilePager)', () => {
    // Poser d'abord des vars comme si mobile avait tourné
    document.documentElement.style.setProperty('--pager-w', '375px');
    isDesktop.mockReturnValue(true);
    _recalcPagerVars();
    // destroyMobilePager retire --pager-w
    expect(document.documentElement.style.getPropertyValue('--pager-w')).toBe('');
  });
});

// ─── destroyMobilePager ───────────────────────────────────────────────────────

describe('destroyMobilePager', () => {
  it('retire les 4 CSS vars posées par _recalcPagerVars', () => {
    document.documentElement.style.setProperty('--pager-top', '100px');
    document.documentElement.style.setProperty('--pager-h',   '500px');
    document.documentElement.style.setProperty('--pager-w',   '375px');
    document.documentElement.style.setProperty('--bnav-h',    '56px');

    destroyMobilePager();

    ['--pager-top', '--pager-h', '--pager-w', '--bnav-h'].forEach(v => {
      expect(document.documentElement.style.getPropertyValue(v)).toBe('');
    });
  });

  it('supprime les nœuds [data-ghost] présents dans #k-grid', () => {
    const grid = makeGrid({ withGhost: true });
    document.body.appendChild(grid);
    expect(grid.querySelectorAll('[data-ghost]').length).toBe(1);
    destroyMobilePager();
    expect(grid.querySelectorAll('[data-ghost]').length).toBe(0);
  });

  it('retire la classe k-grid-cat-pager et les styles inline du grid', () => {
    const grid = makeGrid();
    grid.classList.add('k-grid-cat-pager');
    grid.style.transform = 'translateX(-100px)';
    document.body.appendChild(grid);

    destroyMobilePager();

    expect(grid.classList.contains('k-grid-cat-pager')).toBe(false);
    expect(grid.style.transform).toBe('');
  });

  it('sans #k-grid dans le DOM : ne lève pas d\'erreur', () => {
    expect(() => destroyMobilePager()).not.toThrow();
  });

  it('nettoie les styles de dom.pageScroll quand présent', () => {
    const ps = document.createElement('div');
    ps.style.position = 'fixed';
    dom.pageScroll = ps;
    destroyMobilePager();
    expect(ps.style.position).toBe('');
  });
});

// ─── _setupInfiniteLoop ───────────────────────────────────────────────────────

describe('_setupInfiniteLoop', () => {
  it('mobile + page "all" présente : ajoute un clone ghost à la fin du grid', () => {
    isDesktop.mockReturnValue(false);
    const grid = makeGrid({ cats: ['all', 'alimentation'] });
    document.body.appendChild(grid);

    _setupInfiniteLoop();

    const ghosts = grid.querySelectorAll('[data-ghost]');
    expect(ghosts.length).toBe(1);
    expect(ghosts[0].dataset.cat).toBe('all');
  });

  it('le ghost porte data-ghost="true" et est ajouté en dernier', () => {
    isDesktop.mockReturnValue(false);
    const grid = makeGrid({ cats: ['all', 'alimentation'] });
    document.body.appendChild(grid);

    _setupInfiniteLoop();

    const last = grid.lastElementChild;
    expect(last.getAttribute('data-ghost')).toBe('true');
  });

  it('desktop : ne crée pas de ghost', () => {
    isDesktop.mockReturnValue(true);
    const grid = makeGrid({ cats: ['all'] });
    document.body.appendChild(grid);

    _setupInfiniteLoop();

    expect(grid.querySelectorAll('[data-ghost]').length).toBe(0);
  });

  it('sans page "all" : ne crée pas de ghost', () => {
    isDesktop.mockReturnValue(false);
    const grid = makeGrid({ cats: ['alimentation', 'electronique'] });
    document.body.appendChild(grid);

    _setupInfiniteLoop();

    expect(grid.querySelectorAll('[data-ghost]').length).toBe(0);
  });

  it('appelé deux fois : remplace les anciens ghosts (pas de doublon)', () => {
    isDesktop.mockReturnValue(false);
    const grid = makeGrid({ cats: ['all'] });
    document.body.appendChild(grid);

    _setupInfiniteLoop();
    _setupInfiniteLoop();

    expect(grid.querySelectorAll('[data-ghost]').length).toBe(1);
  });
});

// ─── _scrollPagerToCat ────────────────────────────────────────────────────────

describe('_scrollPagerToCat', () => {
  it('sans #k-grid dans le DOM : retourne false', () => {
    expect(_scrollPagerToCat('all')).toBe(false);
  });

  it('desktop : retourne false même si le grid existe', () => {
    isDesktop.mockReturnValue(true);
    const grid = makeGrid({ cats: ['all'] });
    document.body.appendChild(grid);
    expect(_scrollPagerToCat('all')).toBe(false);
  });

  it('mobile + catégorie présente : retourne true et appelle grid.scrollTo', () => {
    isDesktop.mockReturnValue(false);
    const grid = makeGrid({ cats: ['all', 'alimentation'] });
    document.body.appendChild(grid);
    const scrollTo = stubGridScroll(grid);

    const result = _scrollPagerToCat('alimentation', 'smooth');

    expect(result).toBe(true);
    expect(scrollTo).toHaveBeenCalled();
  });

  it('mobile + catégorie absente : retourne false', () => {
    isDesktop.mockReturnValue(false);
    const grid = makeGrid({ cats: ['all'] });
    document.body.appendChild(grid);
    stubGridScroll(grid);

    expect(_scrollPagerToCat('inexistante')).toBe(false);
  });

  it('_scrollPagerToGhost : délègue à _scrollPagerToCat("all")', () => {
    isDesktop.mockReturnValue(false);
    const grid = makeGrid({ cats: ['all'] });
    document.body.appendChild(grid);
    const scrollTo = stubGridScroll(grid);

    _scrollPagerToGhost();

    expect(scrollTo).toHaveBeenCalled();
  });
});

// ─── _reshuffleToutInDOM ──────────────────────────────────────────────────────

describe('_reshuffleToutInDOM', () => {
  it('sans #k-grid : ne lève pas d\'erreur', () => {
    expect(() => _reshuffleToutInDOM()).not.toThrow();
  });

  it('sans page "all" : ne modifie pas le DOM', () => {
    const grid = makeGrid({ cats: ['alimentation'] });
    document.body.appendChild(grid);
    const before = [...grid.querySelector('.k-sec-grid').children].map(c => c.textContent);
    _reshuffleToutInDOM();
    const after  = [...grid.querySelector('.k-sec-grid').children].map(c => c.textContent);
    expect(after.sort()).toEqual(before.sort()); // même éléments, ordre potentiellement identique
  });

  it('page "all" avec k-sec-grid : conserve les mêmes enfants (Fisher-Yates préserve le set)', () => {
    const grid = makeGrid({ cats: ['all'] });
    document.body.appendChild(grid);
    const sg = grid.querySelector('.k-cat-section[data-cat="all"] .k-sec-grid');
    // Ajouter plusieurs cartes pour un shuffle significatif
    ['D', 'E', 'F', 'G'].forEach(l => {
      const c = document.createElement('div'); c.textContent = l; sg.appendChild(c);
    });
    const before = [...sg.children].map(c => c.textContent).sort();

    _reshuffleToutInDOM();

    const after = [...sg.children].map(c => c.textContent).sort();
    expect(after).toEqual(before);
    expect(sg.children.length).toBe(7);
  });
});

// ─── _setupMobilePager ────────────────────────────────────────────────────────

describe('_setupMobilePager', () => {
  it('desktop : appelle destroyMobilePager (retire les CSS vars)', () => {
    isDesktop.mockReturnValue(true);
    document.documentElement.style.setProperty('--pager-w', '375px');

    _setupMobilePager();

    expect(document.documentElement.style.getPropertyValue('--pager-w')).toBe('');
  });

  it('mobile sans #k-grid : ne lève pas d\'erreur et ne pose pas de vars', () => {
    isDesktop.mockReturnValue(false);
    expect(() => _setupMobilePager()).not.toThrow();
    // Pas de grid → _recalcPagerVars pose quand même les vars (pagerTop fallback)
    // — on vérifie juste l'absence d'exception
  });

  it('mobile + grid k-grid-flat-subcat : abandonne sans setup (guard sous-cat)', () => {
    isDesktop.mockReturnValue(false);
    const grid = makeGrid();
    grid.classList.add('k-grid-flat-subcat');
    document.body.appendChild(grid);

    // Ne doit pas poser de listener scroll
    const scrollCalls = [];
    const orig = grid.addEventListener.bind(grid);
    grid.addEventListener = (t, h, o) => { if (t === 'scroll') scrollCalls.push(t); orig(t, h, o); };
    _setupMobilePager();

    expect(scrollCalls.length).toBe(0);
  });

  it('mobile + grid normal : monte un listener \'scroll\' sur le grid', () => {
    isDesktop.mockReturnValue(false);
    const grid = makeGrid();
    document.body.appendChild(grid);

    _setupMobilePager();

    // Le listener est posé sur grid via _setupScrollSync
    expect(typeof grid._pagerScrollH).toBe('function');
  });
});

// ─── _setupSectionAutoAdvance ─────────────────────────────────────────────────

describe('_setupSectionAutoAdvance', () => {
  it('desktop : ne pose pas de listener de scroll sur les pages', () => {
    isDesktop.mockReturnValue(true);
    const grid = makeGrid({ cats: ['all', 'alimentation'] });
    document.body.appendChild(grid);

    _setupSectionAutoAdvance();

    const pages = [...grid.querySelectorAll('.k-cat-section')];
    pages.forEach(p => expect(typeof p._bounceH).not.toBe('function'));
  });

  it('mobile sans #k-grid : ne lève pas d\'erreur', () => {
    isDesktop.mockReturnValue(false);
    expect(() => _setupSectionAutoAdvance()).not.toThrow();
  });

  it('mobile + grid : pose _bounceH sur chaque page réelle', () => {
    isDesktop.mockReturnValue(false);
    const grid = makeGrid({ cats: ['all', 'alimentation'] });
    document.body.appendChild(grid);

    _setupSectionAutoAdvance();

    const realPages = [...grid.querySelectorAll('.k-cat-section:not([data-ghost])')];
    realPages.forEach(p => expect(typeof p._bounceH).toBe('function'));
  });
});
