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
  expect(index).toContain('/dashboards/canonical/js/catalog-control-tower.js?v=260929-2');
  expect(index).toContain('/dashboards/canonical/css/catalog-control-tower.css?v=2501');
});

test('Vue Catalogue ne duplique plus le pipeline Import', () => {
  const tower = read('public/dashboards/canonical/js/catalog-control-tower.js');
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');

  ['Sourcés', 'Prêts à publier', 'Visible par marché', 'Sens des statuts', 'renderTruthFlow']
    .forEach(label => expect(tower).not.toContain(label));
  ['Sources catalogue · LIVE', 'La Raffinerie en temps réel', 'En train d’arriver · LIVE']
    .forEach(label => expect(workspace).not.toContain(label));

  expect(workspace).toContain('Catalogue global commercial');
  expect(workspace).toContain('KIR clos');
  expect(workspace).toContain('Marchés approuvés');
  expect(workspace).toContain('/admin/import-runtime');
  expect(workspace).not.toContain('setInterval(');
});

test('Catalogue garde une seule surface Canonical et délègue provenance/import au Cockpit', () => {
  const tower = read('public/dashboards/canonical/js/catalog-control-tower.js');
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(tower).toContain('Compatibility shell only');
  expect(tower).not.toContain("view=advanced");
  expect(workspace).toContain("cockpit.href = '/admin/import-runtime'");
  expect(workspace).toContain("sourcing.href = '/admin/workspaces/sourcing'");
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
  const tower = read('public/dashboards/canonical/js/catalog-control-tower.js');
  const workspace = read('public/dashboards/canonical/js/catalog-workspace.js');
  expect(workspace).toContain("const ENDPOINT = '/api/admin/workspaces/catalog'");
  expect(tower).not.toContain('/api/admin/workspaces/catalog');
  expect(workspace).not.toContain("'/api/products");
  expect(tower).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(workspace).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
});
