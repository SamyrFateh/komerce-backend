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

  test('réduit la recherche à une loupe puis la déplace sous le header au focus', () => {
    expect(css).toMatch(/\.k-search\s*\{[^}]*flex:\s*0 0 34px[^}]*width:\s*34px[^}]*height:\s*34px[^}]*margin-left:\s*auto/s);
    expect(css).toMatch(/\.k-search input\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*opacity:\s*0[^}]*cursor:\s*pointer/s);
    expect(css).toMatch(/\.k-search:focus-within\s*\{[^}]*position:\s*fixed[^}]*top:\s*calc\(var\(--header-h, 44px\)[^}]*left:\s*12px[^}]*right:\s*12px[^}]*height:\s*40px[^}]*z-index:\s*190/s);
    expect(css).toMatch(/\.k-search:focus-within input\s*\{[^}]*position:\s*static[^}]*opacity:\s*1[^}]*color:\s*var\(--text\)[^}]*cursor:\s*text/s);
    expect(css).toMatch(/\.k-search:focus-within \.k-search-dropdown\s*\{[^}]*top:\s*calc\(100% \+ 6px\)[^}]*max-height:\s*min\(50vh, 360px\)/s);
    expect(css).toContain('color: var(--ocean-dark-deep);');
  });
});
