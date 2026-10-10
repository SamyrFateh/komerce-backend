'use strict';
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/operations-workspace.css'), 'utf8');

describe('operations-workspace.css — chaîne et actions du Catalogue', () => {
  test('la chaîne de curation porte les états current / done / pending', () => {
    ['.kmc-catalog-chain-stage.is-current', '.kmc-catalog-chain-stage.is-pending', '.kmc-catalog-chain-count'].forEach(sel => {
      expect(css).toContain(sel);
    });
  });

  test('hiérarchie des actions : valider (vert), prix (bleu), écarter (rouge discret)', () => {
    expect(css).toContain('.kmc-workspace-action.is-approve');
    expect(css).toContain('a.kmc-workspace-action.is-price');
    expect(css).toContain('.kmc-workspace-action.is-danger');
  });

  test('la chaîne reste sans style inline et passe en colonne sur mobile', () => {
    expect(css).toMatch(/@media \(max-width:760px\)\{\.kmc-catalog-chain\{grid-template-columns:1fr/);
  });
});

describe('tableau des candidats Sourcing', () => {
  test('colonnes État et Décision élargies pour les libellés français', () => {
    expect(css).toMatch(/td:nth-child\(5\) \{ width: 14%; \}/);
    expect(css).toMatch(/td:nth-child\(6\) \{ width: 11%; \}/);
  });
});

test('operations-workspace.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('operations-workspace.css')).toEqual([]);
});
