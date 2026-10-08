'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.join(__dirname, '../../public/dashboards/canonical/css/decision-visual.css'),
  'utf8'
);

describe('decision visual — operations control tower', () => {
  test('la chaîne reste une grille horizontale compacte par étapes', () => {
    expect(css).toMatch(/\.kmc-control-chain\s*\{[^}]*grid-auto-flow:\s*column/s);
    expect(css).toMatch(/\.kmc-control-stage\s*\{[^}]*border-radius:\s*11px/s);
    expect(css).toMatch(/\.kmc-control-order-list\s*\{[^}]*overflow-y:\s*auto/s);
  });

  test('le vert reste discret tandis que warning et critical gardent leur signal propre', () => {
    expect(css).toMatch(/\.kmc-control-order\.is-positive\s*\{[^}]*opacity:\s*\.58/s);
    expect(css).toMatch(/\.kmc-control-order\.is-warning\s*\{[^}]*--control-health:\s*var\(--kmc-warning\)/s);
    expect(css).toMatch(/\.kmc-control-order\.is-critical\s*\{[^}]*--control-health:\s*var\(--kmc-critical\)/s);
  });

  test('les causes structurelles restent compactes au-dessus de la liste', () => {
    expect(css).toMatch(/\.kmc-control-structural-alerts\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.kmc-control-structural-alert\s*\{[^}]*border-radius:\s*8px/s);
    expect(css).toMatch(/\.kmc-control-structural-count\s*\{[^}]*font-weight:\s*900/s);
  });

  test('le niveau 1 conserve une ligne de commande courte et non décorative', () => {
    expect(css).toMatch(/\.kmc-control-order\s*\{[^}]*min-height:\s*27px/s);
    expect(css).toMatch(/\.kmc-control-order-ref\s*\{[^}]*text-overflow:\s*ellipsis/s);
  });
});

describe('decision visual — UNKNOWN distinct de GREEN', () => {
  test('is-unknown utilise le gris neutre des tokens, sans le vert ni l’atténuation du sain', () => {
    const block = (css.match(/\.kmc-control-order\.is-unknown\s*\{([^}]*)\}/s) || [])[1] || '';
    expect(block).toContain('--health-unknown-fg');
    expect(block).not.toContain('--kmc-positive');
    expect(block).not.toMatch(/opacity/);
  });
  test('l’état porte une icône en plus de la couleur', () => {
    expect(css).toMatch(/\.kmc-control-order-state\s*\{/);
  });
});

