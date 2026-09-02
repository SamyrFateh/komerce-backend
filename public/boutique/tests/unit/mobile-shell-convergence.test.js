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

  test('compacte la recherche au repos puis la déploie au focus', () => {
    expect(css).toMatch(/\.k-search\s*\{[^}]*flex:\s*0 0 34px[^}]*width:\s*34px[^}]*margin-left:\s*auto/s);
    expect(css).toMatch(/\.k-search input\s*\{[^}]*color:\s*transparent[^}]*caret-color:\s*transparent/s);
    expect(css).toMatch(/\.k-search:focus-within\s*\{[^}]*flex:\s*1 1 auto[^}]*width:\s*auto[^}]*background:\s*var\(--white\)/s);
    expect(css).toMatch(/\.k-search:focus-within input\s*\{[^}]*color:\s*var\(--text\)[^}]*cursor:\s*text/s);
    expect(css).toContain('color: var(--ocean-dark-deep);');
  });
});
