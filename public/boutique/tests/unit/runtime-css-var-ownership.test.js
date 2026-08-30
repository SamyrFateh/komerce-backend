'use strict';

const { JS_OWNED_VARS, jsVarOwners } = require('../../scripts/gen-boutique-arch-live.js');
const {
  RUNTIME_CSS_VAR_OWNERSHIP,
  evaluateRuntimeCssVarOwnership,
} = require('../../scripts/runtime-css-var-ownership.js');

function cloneMap(map) {
  return Object.fromEntries(Object.entries(map).map(([variable, rows]) => [
    variable,
    rows.map(row => ({ ...row })),
  ]));
}

describe('runtime CSS variable ownership contract', () => {
  test('current Boutique JS respects the machine-readable producer contract', () => {
    expect(JS_OWNED_VARS).toEqual(Object.keys(RUNTIME_CSS_VAR_OWNERSHIP));
    const result = evaluateRuntimeCssVarOwnership(jsVarOwners(), JS_OWNED_VARS);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('rejects a new JS producer that is not explicitly authorized', () => {
    const map = cloneMap(jsVarOwners());
    map['--pager-top'].push({ file: 'js/rogue-layout.js', count: 1 });

    const result = evaluateRuntimeCssVarOwnership(map, JS_OWNED_VARS);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'unauthorized-producer',
        variable: '--pager-top',
        file: 'js/rogue-layout.js',
      }),
    ]));
  });

  test('rejects disappearance of the semantic principal producer', () => {
    const map = cloneMap(jsVarOwners());
    const principal = RUNTIME_CSS_VAR_OWNERSHIP['--pager-h'].principal;
    map['--pager-h'] = map['--pager-h'].filter(row => row.file !== principal);

    const result = evaluateRuntimeCssVarOwnership(map, JS_OWNED_VARS);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'missing-principal',
        variable: '--pager-h',
        file: principal,
      }),
    ]));
  });

  test('rejects an extra write path inside an otherwise allowed producer', () => {
    const map = cloneMap(jsVarOwners());
    const row = map['--pager-h'].find(item => item.file === 'js/hero-bootstrap.js');
    row.count = 2;

    const result = evaluateRuntimeCssVarOwnership(map, JS_OWNED_VARS);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'too-many-write-paths',
        variable: '--pager-h',
        file: 'js/hero-bootstrap.js',
        count: 2,
        maxWrites: 1,
      }),
    ]));
  });

  test('permits removing a contextual producer without freezing historical producer count', () => {
    const map = cloneMap(jsVarOwners());
    map['--pager-top'] = map['--pager-top'].filter(row => row.file !== 'js/hero-bootstrap.js');

    const result = evaluateRuntimeCssVarOwnership(map, JS_OWNED_VARS);
    expect(result.errors.filter(error => error.variable === '--pager-top')).toEqual([]);
  });
});
