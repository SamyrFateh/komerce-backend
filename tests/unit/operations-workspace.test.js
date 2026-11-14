/** @test-kind unit @test-runner jest @test-requires none */
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

describe('L9a — répartition Hub dans Opérations', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('le bouton « Répartir ce marché » n’est ajouté que s’il reste des commandes à répartir', () => {
    expect(src).toMatch(/distribution\.unassigned\.length > 0\)\s*\{\s*distributionBar\.appendChild\(distributeButton\)/);
  });
});

describe('réception Hub — confirmer une référence inconnue', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('HUB_PHYSICAL_CODE_UNKNOWN propose « Confirmer cette référence » vers la route canonique, puis relance l\'identification', () => {
    expect(src).toContain("const PHYSICAL_CODE_CONFIRM_ENDPOINT = '/api/hub/physical-codes/confirm';");
    expect(src).toMatch(/error\.code === 'HUB_PHYSICAL_CODE_UNKNOWN'/);
    expect(src).toContain("'Confirmer cette référence', 'open-physical-confirm'");
    expect(src).toMatch(/purchase_order_id: po\.purchase_order_id,\s*product_sku_id: variant\.value,\s*code,\s*code_type: type\.value,\s*proof_ref:/);
    expect(src).toMatch(/closeConfirm\(\);\s*await identify\(code\);/);
  });
  test('les trois types de code de la doctrine sont proposés', () => {
    ['EAN_GTIN', 'SUPPLIER_BARCODE', 'KOM_LOT_LABEL'].forEach(type => expect(src).toContain(`'${type}'`));
  });
});

describe('répartition d\'une seule commande', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('chaque ligne à répartir porte « Répartir » vers orders/:reference/distribute, et « Répartir ce marché » reste', () => {
    expect(src).toContain("makeActionButton(doc, 'Répartir', 'distribute-order')");
    expect(src).toContain('orders/${encodeURIComponent(row.reference)}/distribute');
    expect(src).toContain("'Répartir ce marché', 'run-distribution'");
  });
});

describe('L9c — gestes Hub réservés à Hub live', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('hors mode execution, les boutons Commander, Répartir, Expédier et Affecter ne sont pas rendus', () => {
    expect(src).toMatch(/function isHubReadOnly\(context\)\s*\{\s*return context\.mode !== 'execution';/);
    expect(src).toMatch(/config\.hub && isHubReadOnly\(context\)\) return;/);
    expect(src).toMatch(/!isHubReadOnly\(context\) && Array\.isArray\(payload\.distribution/);
    expect(src).toMatch(/if \(isHubReadOnly\(context\)\) \{ select\.disabled = true/);
  });
  test('le lien « Exécuter dans Hub live » porte le marché', () => {
    expect(src).toContain('/admin/hub-live?view=execute&market=${encodeURIComponent(context.marketCode)}');
  });
});

test('Catalogue global : filtres accessibles et panneau taxonomie secondaire sur mobile', () => {
  expect(css).toContain('.kmc-catalog-filter-bar');
  expect(css).toContain('.kmc-catalog-filter input');
  expect(css).toContain('.kmc-catalog-filter select');
  expect(css).toContain('.kmc-catalog-taxonomy-panel summary');
  expect(css).toContain('@media (max-width: 650px)');
  expect(css).toContain('.kmc-catalog-filter { flex-basis: 100%; }');
});

describe('operations-workspace.js — provenance manuelle (#3900)', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('sac -> KOM-BOX et réception exposent le mode manuel avec justification', () => {
    expect(ui).toContain('data-hub-box-evidence-method');
    expect(ui).toContain('data-hub-box-manual-proof');
    expect(ui).toContain('data-receive-manual-proof');
    expect(ui).toContain('data-receive-manual-toggle');
  });
});
