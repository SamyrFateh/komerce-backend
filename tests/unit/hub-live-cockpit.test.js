/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/hub-live-cockpit.css'), 'utf8');

describe('hub-live-cockpit.css — formulaire de réception dans la colonne', () => {
  test('le formulaire est une grille à colonne unique rétractable (minmax(0, 1fr))', () => {
    expect(css).toMatch(/\.hlc-form \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 0;/);
  });

  test('la carte, le tableau et la colonne de saisie ne forcent plus la largeur', () => {
    expect(css).toContain('.hlc-form .kmc-workspace-receive-card { border: 0; padding: 0; background: transparent; min-width: 0; }');
    expect(css).toContain('.hlc-form .kmc-workspace-receive-card .kmc-workspace-table { min-width: 0; }');
    expect(css).toMatch(/\.hlc-form \.kmc-workspace-receive-card \.kmc-workspace-table td:last-child \{ min-width: 0;/);
  });
});
