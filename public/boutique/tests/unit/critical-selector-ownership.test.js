'use strict';

const { TRACKED_SELECTORS, selectorMap } = require('../../scripts/gen-boutique-arch-live.js');
const {
  CRITICAL_SELECTOR_OWNERSHIP,
  evaluateSelectorOwnership,
} = require('../../scripts/critical-selector-ownership.js');

function cloneMap(map) {
  return Object.fromEntries(Object.entries(map).map(([selector, rows]) => [
    selector,
    rows.map(row => ({ ...row })),
  ]));
}

describe('critical selector ownership contract', () => {
  test('current Boutique CSS respects the machine-readable contract', () => {
    const result = evaluateSelectorOwnership(selectorMap(), TRACKED_SELECTORS);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('rejects a new CSS owner that is not explicitly authorized', () => {
    const map = cloneMap(selectorMap());
    map['.k-card'].push({ file: 'rogue-polish.css', base: 1, desktop: 0 });

    const result = evaluateSelectorOwnership(map, TRACKED_SELECTORS);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'unauthorized-owner',
        selector: '.k-card',
        file: 'rogue-polish.css',
      }),
    ]));
  });

  test('rejects an authorized owner expanding into an unauthorized media context', () => {
    const map = cloneMap(selectorMap());
    const row = map['.k-side-cart'].find(item => item.file === 'layout.css');
    row.desktop = 1;

    const result = evaluateSelectorOwnership(map, TRACKED_SELECTORS);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'unauthorized-context',
        selector: '.k-side-cart',
        file: 'layout.css',
        context: 'desktop',
      }),
    ]));
  });

  test('rejects disappearance of the semantic principal owner', () => {
    const map = cloneMap(selectorMap());
    const principal = CRITICAL_SELECTOR_OWNERSHIP['.k-grid'].principal;
    map['.k-grid'] = map['.k-grid'].filter(row => row.file !== principal);

    const result = evaluateSelectorOwnership(map, TRACKED_SELECTORS);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'missing-principal',
        selector: '.k-grid',
        file: principal,
      }),
    ]));
  });

  test('permits removing a contextual adaptation without freezing historical owner count', () => {
    const map = cloneMap(selectorMap());
    map['.k-hero-media'] = map['.k-hero-media'].filter(row => row.file === 'hero.css');

    const result = evaluateSelectorOwnership(map, TRACKED_SELECTORS);
    expect(result.errors.filter(error => error.selector === '.k-hero-media')).toEqual([]);
  });
});
