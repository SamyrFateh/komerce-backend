'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature catalog
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../../css/discovery-rail.css'), 'utf8');

describe('Discovery mobile rail geometry', () => {
  test('reste un rail horizontal compact avec amorce de la carte suivante', () => {
    expect(css).toMatch(/\.k-discovery-rail\s*\{[^}]*display:\s*flex[^}]*gap:\s*8px[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x proximity/s);
    expect(css).toMatch(/\.k-discovery-card\s*\{[^}]*flex:\s*0 0 148px[^}]*min-width:\s*148px[^}]*max-width:\s*154px[^}]*scroll-snap-align:\s*start/s);
  });

  test('compacte média et information locale sans modifier le détail modal', () => {
    expect(css).toMatch(/\.k-discovery-media\s*\{[^}]*aspect-ratio:\s*3 \/ 2/s);
    expect(css).toMatch(/\.k-discovery-info\s*\{[^}]*min-height:\s*88px[^}]*padding:\s*7px/s);
    expect(css).toMatch(/\.k-discovery-cta\s*\{[^}]*min-height:\s*28px/s);
    expect(css).not.toMatch(/:\s*[^;{}]*!important\s*;/);
  });
});
