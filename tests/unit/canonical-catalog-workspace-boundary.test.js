'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('Catalogue charge les assets business-truth versionnés', () => {
  const index = read('public/dashboards/canonical/index.html');
  expect(index).toContain('/dashboards/canonical/js/catalog-control-tower.js?v=2501');
  expect(index).toContain('/dashboards/canonical/css/catalog-control-tower.css?v=2501');
});

test('Vue Catalogue expose une seule lecture métier', () => {
  const source = read('public/dashboards/canonical/js/catalog-control-tower.js');
  ['Sourcés', 'Prêts à publier', 'Publiés', 'Visibles', 'Visible par marché', 'À traiter', 'Sens des statuts']
    .forEach(label => expect(source).toContain(label));

  ['Sources catalogue', 'La raffinerie en temps réel', 'Catalogue & Boutique', 'En résumé', 'Prochains événements']
    .forEach(label => expect(source).not.toContain(label));
});

test('Catalogue conserve Produits comme drill-down et envoie Sources vers Opérations', () => {
  const source = read('public/dashboards/canonical/js/catalog-control-tower.js');
  expect(source).toContain("'/admin/workspaces/catalog?view=advanced'");
  expect(source).toContain("'/admin/workspaces/sourcing'");
  expect(source).toContain("new URLSearchParams(root?.location?.search || '').get('view') === 'advanced'");
});

test('Catalogue ne crée plus de navigation parallèle au shell Canonical', () => {
  const source = read('public/dashboards/canonical/js/catalog-control-tower.js');
  const css = read('public/dashboards/canonical/css/catalog-control-tower.css');
  expect(source).not.toContain('renderSidebar');
  expect(source).not.toContain('renderTopbar');
  expect(css).not.toContain('.kmc-ctl-sidebar');
  expect(css).not.toContain('body.kmc-catalog-live-mode > .kmc-admin-navigation');
});

test('la vue business lit uniquement le Workspace Catalogue canonique', () => {
  const source = read('public/dashboards/canonical/js/catalog-control-tower.js');
  expect(source).toContain('/api/admin/workspaces/catalog');
  expect(source).not.toContain("'/api/products");
  expect(source).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
});
