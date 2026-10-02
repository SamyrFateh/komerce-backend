'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const ctx = require('../../scripts/agent-context');

test('parseHeader extrait uniquement les métadonnées utiles', () => {
  expect(ctx.parseHeader(`/**
 * @komerce-arch
 * @role          demo-role
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @db-write      products
 */`)).toEqual({
    role: 'demo-role',
    domain: 'catalog',
    layer: 'service',
    criticality: 'high',
    'db-write': 'products',
  });
});

test('flattenFiles compacte récursivement une carte feature', () => {
  expect(ctx.flattenFiles({
    routes: ['routes/a.js'],
    nested: { tests: ['tests/unit/a.test.js'] },
  })).toEqual(['routes/a.js', 'tests/unit/a.test.js']);
});

test('declaredPath applique le préfixe canonique de la catégorie dash', () => {
  expect(ctx.declaredPath(process.cwd(), 'dashboards/canonical/js/catalog-workspace.js', 'dash'))
    .toBe('public/dashboards/canonical/js/catalog-workspace.js');
});

test('agent context identifie la feature dashboard sans lire les projections entières', () => {
  const model = ctx.buildContext({
    files: ['public/dashboards/canonical/js/catalog-workspace.js'],
    features: [],
  });
  expect(model.features.map(f => f.name)).toContain('dashboard');
  expect(model.scope.dashboard).toBe(true);
  expect(model.headers.find(h => h.file === 'public/dashboards/canonical/js/catalog-workspace.js')).toBeDefined();
  expect(model.gates).toContain('npm run pr:preflight');
});

test('renderContext respecte le budget de sortie', () => {
  const model = ctx.buildContext({
    files: ['public/dashboards/canonical/js/catalog-workspace.js'],
    features: ['dashboard'],
  });
  const output = ctx.renderContext(model, 3000);
  expect(output.length).toBeLessThanOrEqual(3000);
  expect(output).toContain('KOMERCE AGENT CONTEXT v1');
  expect(output).toContain('[feature dashboard]');
});


test('renderBrief reste sous le budget ultra-compact par défaut', () => {
  const model = ctx.buildContext({
    features: ['catalog', 'dashboard', 'infrastructure'],
  });
  const output = ctx.renderBrief(model);
  expect(output.length).toBeLessThanOrEqual(2800);
  expect(output).toContain('brief');
  expect(output).not.toContain('invariants:');
  expect(output).not.toContain('mustCheck:');
});

test('expandSeed résout un fichier existant sans exiger --files', () => {
  expect(ctx.expandSeed('public/dashboards/canonical/js/catalog-workspace.js')).toEqual({
    files: ['public/dashboards/canonical/js/catalog-workspace.js'],
    features: [],
  });
});

test('expandSeed résout une feature sans exiger --feature', () => {
  expect(ctx.expandSeed('catalog')).toEqual({
    files: [],
    features: ['catalog'],
  });
});

test('renderExpand restitue le détail d une feature ciblée seulement', () => {
  const model = ctx.buildContext({ features: ['catalog', 'dashboard'] });
  const output = ctx.renderExpand(model, 'catalog');
  expect(output).toContain('[feature catalog]');
  expect(output).toContain('invariants:');
  expect(output).not.toContain('[feature dashboard]');
});
