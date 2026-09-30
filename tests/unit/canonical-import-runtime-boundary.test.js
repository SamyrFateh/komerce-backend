'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

jest.mock('../../utils/logger', () => ({ child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }) }));

const { mountHtmlRoutes } = require('../../bootstrap/html-routes');
const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

function fakeApp() {
  const routes = {};
  return { get: jest.fn((routePath, handler) => { routes[routePath] = handler; }), _routes: routes };
}
function fakeRes() {
  return {
    headersSent: false,
    setHeader: jest.fn(), sendFile: jest.fn(), redirect: jest.fn(),
    status: jest.fn().mockReturnThis(), send: jest.fn(), json: jest.fn(),
  };
}

test('import runtime stable URL is served by Canonical generation', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);
  const res = fakeRes();
  app._routes['/admin/import-runtime']({ query: {} }, res);
  expect(res.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
});

test('canonical import runtime is loaded without legacy dependency', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'import-runtime.js'), 'utf8');
  expect(index).toContain('/dashboards/canonical/js/import-runtime.js?v=260930-10');
  expect(index).toContain('/dashboards/canonical/css/import-runtime.css?v=260930-10');
  expect(index).toContain('/dashboards/canonical/css/canonical-legacy-theme-v1.css?v=260929-4');
  expect(source).toContain('/api/admin/workspaces/sourcing/import-cockpit');
  expect(source).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(source).not.toMatch(/\b(?:ImportRuntimeView|KmcApi|ApiClient)\b/);
});

test('canonical app and navigation expose import runtime under the Live domain', () => {
  const app = fs.readFileSync(path.join(CANONICAL, 'js', 'app.js'), 'utf8');
  const nav = fs.readFileSync(path.join(CANONICAL, 'js', 'navigation-policy-v3.js'), 'utf8');
  expect(app).toContain("IMPORT_RUNTIME: 'import-runtime'");
  expect(app).toContain("path === '/admin/import-runtime'");
  expect(app).toContain('KomerceCanonicalImportRuntime');
  expect(nav).toContain("id: 'import-runtime'");
  expect(nav).toContain("href: '/admin/import-runtime'");
  expect(nav).toContain("'import-runtime': 'live'");
});


test('import cockpit respecte le contrat canonique passage → population → action → preuve', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'import-runtime.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'import-runtime.css'), 'utf8');

  expect(source).toContain('FLUX DU PASSAGE');
  expect(source).toContain('RÉSULTAT DU PASSAGE');
  expect(source).toContain('Remise Catalogue');
  expect(source).toContain('PASSAGE AU CATALOGUE');
  expect(source).toContain('Remise automatique');
  expect(source).toContain("automatic_catalogue_handoff_pending");
  expect(source).not.toContain('awaiting_explicit_operator_promotion');
  expect(source).not.toContain('manual_label');

  expect(source).toContain('Historique des passages');
  expect(source).toContain('Un passage est une exécution Sourcing identifiée par KIR-xxxx');
  expect(source).toContain('← Retour au passage');
  expect(source).toContain('← Retour aux passages');
  expect(source).toContain('origin');
  expect(source).toContain('passages_offset');
  expect(source).toContain('data-passage-select');
  expect(css).toContain('.kir-passage-picker');
  expect(css).toContain('.kir-return-passages');

  expect(source).toContain('Action requise');
  expect(source).toContain("['Écartés automatiquement'");
  expect(source).toContain('Détail technique du passage');
  expect(source).toContain('Voir le détail technique →');
  expect(source).toContain('/api/admin/workspaces/sourcing/import-runs/');
  expect(source).toContain('/population?kind=');

  expect(source).not.toContain('Clôture du lot');
  expect(source).not.toContain('Approuvés vente');
  expect(source).not.toContain('Décisions commerciales');
  expect(source).not.toContain('RÉSULTAT DU LOT');
  expect(source).not.toContain('FLUX DU LOT');

  expect(source).toContain('Alimentation automatique');
  expect(source).toContain('Mettre à jour maintenant');
  expect(source).toContain('Redémarrer');
  expect(source).toContain('Arrêter');
  expect(source).not.toContain('sourceCanStartAutopilot');

  expect(css).toContain('LIVE OPS dark authority');
  expect(css).toContain('.kir-run-flow');
  expect(css).toContain('.kir-run-truth-grid.is-four');
  expect(css).toContain('.kir-source-switch');
});
