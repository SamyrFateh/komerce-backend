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

  test('place la recherche visible sous le chrome Temu sans couper le hero', () => {
    expect(css).toMatch(/\.k-search\s*\{[^}]*position:\s*fixed[^}]*top:\s*calc\(var\(--pager-top, 190px\) \+ 4px\)[^}]*left:\s*12px[^}]*right:\s*12px[^}]*height:\s*34px[^}]*z-index:\s*70/s);
    expect(css).toMatch(/\.k-search input\s*\{[^}]*position:\s*static[^}]*height:\s*34px[^}]*opacity:\s*1[^}]*color:\s*var\(--text\)[^}]*cursor:\s*text/s);
    expect(css).not.toMatch(/\.k-search:focus-within\s*\{[^}]*top:\s*calc\(var\(--header-h/s);
    expect(css).not.toMatch(/\.k-search input\s*\{[^}]*opacity:\s*0/s);
    expect(css).toMatch(/\.k-search:focus-within \.k-search-dropdown\s*\{[^}]*top:\s*calc\(100% \+ 5px\)[^}]*max-height:\s*min\(50vh, 360px\)/s);
    expect(css).toContain('color: var(--ocean-dark-deep);');
  });
});
