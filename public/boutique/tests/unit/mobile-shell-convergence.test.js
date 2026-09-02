'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature platform-ops
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../../css/mobile-shell-convergence.css'), 'utf8');

describe('mobile shell convergence', () => {
  test('reste strictement mobile et ouvre header + bottom-nav', () => {
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).not.toContain('@media (min-width: 900px)');
    expect(css).toMatch(/\.k-header\s*\{[^}]*background:\s*rgba\(255,255,255,\.96\)[^}]*border-bottom:\s*0[^}]*box-shadow:\s*none/s);
    expect(css).toMatch(/\.k-bnav\s*\{[^}]*background:\s*rgba\(255,255,255,\.96\)[^}]*border-top:\s*0/s);
  });

  test('garde une loupe globale compacte et ne déploie le vrai champ que dans le header', () => {
    expect(css).toMatch(/\.k-search\s*\{[^}]*flex:\s*0 0 34px[^}]*width:\s*34px[^}]*height:\s*34px[^}]*margin-left:\s*auto/s);
    expect(css).toMatch(/\.k-search input\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*opacity:\s*0[^}]*cursor:\s*pointer/s);
    expect(css).toMatch(/\.k-search:focus-within\s*\{[^}]*position:\s*fixed[^}]*top:\s*calc\(env\(safe-area-inset-top, 0px\) \+ 5px\)[^}]*left:\s*12px[^}]*right:\s*12px[^}]*height:\s*34px[^}]*z-index:\s*190/s);
    expect(css).toMatch(/\.k-search:focus-within input\s*\{[^}]*position:\s*static[^}]*opacity:\s*1[^}]*color:\s*var\(--text\)[^}]*cursor:\s*text/s);
    expect(css).not.toContain('var(--pager-top, 190px)');
  });

  test('rend un launcher de recherche visible dans le flux de Tout', () => {
    expect(css).toMatch(/\.k-home-search-launcher\s*\{[^}]*width:\s*100%[^}]*min-height:\s*38px[^}]*margin:\s*8px 0 10px[^}]*border-radius:\s*20px/s);
    expect(css).toContain('.k-home-search-launcher::before');
    expect(css).toContain('.k-home-search-launcher::after');
  });
});
