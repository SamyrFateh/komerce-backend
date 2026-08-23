'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature orders-client
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../../css/mobile-cart-convergence.css'), 'utf8');

describe('mobile cart convergence', () => {
  test('renforce le titre et ouvre le chrome du drawer', () => {
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).toMatch(/\.k-cart-header\s*\{[^}]*border-bottom:\s*0[^}]*background:\s*var\(--white\)/s);
    expect(css).toMatch(/#k-cart-header-title\s*\{[^}]*font-size:\s*15px[^}]*font-weight:\s*800/s);
  });

  test('garde le jaune commerce et différencie partager de vider', () => {
    expect(css).toContain('#k-cart-share');
    expect(css).toContain('border-color: var(--cta-green);');
    expect(css).toMatch(/#k-cart-clear\s*\{[^}]*border-color:\s*transparent[^}]*color:\s*var\(--text-muted\)/s);
    expect(css).not.toMatch(/#k-cart-checkout\s*\{/);
  });

  test('ne retouche pas la surface liste partagée', () => {
    expect(css).toContain('#k-cart-drawer:not([data-mode="shared-list"])');
  });
});
