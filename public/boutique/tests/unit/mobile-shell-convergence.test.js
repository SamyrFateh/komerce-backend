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

  test('garde la recherche matérialisée et l actif vert profond', () => {
    expect(css).toMatch(/\.k-search\s*\{[^}]*background:\s*var\(--surface-sand-97\)[^}]*box-shadow:\s*none/s);
    expect(css).toContain('color: var(--ocean-dark-deep);');
  });
});
