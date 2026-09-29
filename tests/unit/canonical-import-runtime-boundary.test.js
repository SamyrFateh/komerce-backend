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
  expect(index).toContain('/dashboards/canonical/js/import-runtime.js?v=260929-16');
  expect(index).toContain('/dashboards/canonical/css/import-runtime.css?v=260929-15');
  expect(index).toContain('/dashboards/canonical/css/canonical-legacy-theme-v1.css?v=260929-4');
  expect(source).toContain('/api/admin/workspaces/sourcing/import-cockpit');
  expect(source).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(source).not.toMatch(/\b(?:ImportRuntimeView|KmcApi|ApiClient)\b/);
});

test('canonical app and navigation expose import runtime under Operations', () => {
  const app = fs.readFileSync(path.join(CANONICAL, 'js', 'app.js'), 'utf8');
  const nav = fs.readFileSync(path.join(CANONICAL, 'js', 'navigation-policy-v3.js'), 'utf8');
  expect(app).toContain("IMPORT_RUNTIME: 'import-runtime'");
  expect(app).toContain("path === '/admin/import-runtime'");
  expect(app).toContain('KomerceCanonicalImportRuntime');
  expect(nav).toContain("id: 'import-runtime'");
  expect(nav).toContain("href: '/admin/import-runtime'");
  expect(nav).toContain("'import-runtime': 'operations'");
});


test('import cockpit montre les décisions et délègue les détails aux pages dédiées', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'import-runtime.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'import-runtime.css'), 'utf8');
  expect(source).toContain('Décisions ouvertes');
  expect(source).toContain('Validation Catalogue requise');
  expect(source).toContain('Décisions de mise en vente');
  expect(source).toContain('Exceptions à traiter');
  expect(source).toContain('Historique technique');
  expect(source).toContain('PARCOURS MÉTIER');
  expect(source).toContain('Prêts à vendre');
  expect(source).toContain('En vente');
  expect(source).toContain('Non retenus');
  expect(source).toContain('Clôture du lot');
  expect(source).toContain('Catalogue global');
  expect(source).toContain('withReturnTo');
  expect(source).toContain('return_to');
  expect(source).toContain('Retour au lot');
  expect(source).toContain('Alimentation automatique');
  expect(source).toContain('Préparation auto');
  expect(source).toContain('activation_ready');
  expect(source).toContain('data-source-toggle');
  expect(source).toContain("role=\"switch\"");
  expect(source).toContain("/api/admin/workspaces/sourcing/sources/");
  expect(source).toContain("const action = enabled ? 'deactivate' : 'activate'");
  expect(source).toContain('Passage en direct');
  expect(source).toContain('le même lot avance de bout en bout');
  expect(source).toContain('persistentRunFlow');
  expect(source).toContain('Import automatique terminé');
  expect(source).toContain('parcours conservé à l’écran');
  expect(source).toContain('SUIVI DU LOT');
  expect(source).toContain('Certifiées sourcing');
  expect(source).toContain('awaiting_catalogue_promotion');
  expect(source).toContain('Ils n’ont pas disparu');
  expect(source).toContain('ACTIVATION_POLL_MS = 900');
  expect(source).toContain("NO_RESULT:'Sans résultat'");
  expect(source).toContain('Passage terminé sans résultat');
  expect(source).toContain('Certification runtime incomplète');
  expect(source).toContain('sourcing_source_certification_incomplete');
  expect(source).toContain('Production reste OFF');
  expect(source).toContain('runtimeCertificationBlocked');
  expect(source).toContain('provider_runtime_status');
  expect(source).toContain('Source automatique bloquée');
  expect(source).toContain('continuent vers le Catalogue');
  expect(source).toContain('Source OFF · preuve runtime à corriger puis relancer');
  expect(css).toContain('Legacy Admin visual parity');
  expect(css).toContain('--kir-orange:var(--kmc-legacy-orange');
  expect(source).toContain('/api/admin/workspaces/sourcing/import-runs/');
  expect(css).toContain('.kir-run-flow');
  expect(css).toContain('.kir-run-flow-progress');
  expect(css).toContain('.kir-run-flow-step.is-running');
  expect(css).toContain('two-line mini cards');
  expect(css).toContain('Real-run accounting');
  expect(css).toContain('@keyframes kir-live-ring');
  expect(css).toContain('--kir-bg:#fff');
  expect(css).toContain('Legacy cockpit parity — typography');
  expect(css).toContain('font-weight:700');
  expect(css).toContain('font-size:24px');
  expect(css).toContain('.kir-run-flow.is-certification-blocked');
  expect(css).toContain('.kir-run-flow-step.is-blocked');
  expect(css).toContain('Legacy dashboard exact presentation');
  expect(css).toContain('--kir-bg:#F8FAFC');
  expect(css).toContain('grid-template-columns:repeat(4,minmax(0,1fr))');
  expect(css).toContain('border-radius:12px');
  expect(css).toContain('Signal hierarchy V2');
  expect(css).toContain('V2 semantic signal hierarchy');
  expect(css).toContain('.kir-runtime-alert');
  expect(css).toContain('--kir-bg:#fff');
  expect(css).toContain('border-left:4px solid #16A34A');
  expect(css).toContain('border-left:4px solid #DC2626');
  expect(css).toContain('border-left:4px solid #16A34A');
  expect(css).toContain('background:#FFFFFF');
  expect(css).toContain('border-left:4px solid #DC2626');
  expect(source).not.toContain("api('/api/admin/workspaces/sourcing')");
  expect(source).not.toContain("'/capabilities/'");
  expect(source).not.toContain("'/import-now'");
  expect(source).not.toContain('sourceCanStartAutopilot');
  expect(css).toContain('.kir-lot-strip');
  expect(css).toContain('.kir-action-card');
  expect(css).toContain('.kir-source-switch');
  expect(css).not.toContain('.kir-source-panel');
});
