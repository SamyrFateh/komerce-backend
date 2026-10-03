'use strict';

const impactLib = require('../../scripts/lib/agent-context-impact');
const packLib = require('../../scripts/lib/agent-context-pack');
const { buildPacks } = require('../../scripts/agent-context');

const graph = {
  edges: [
    { from: 'services/w.js', to: 'db:widgets', type: 'db-write' },
    { from: 'services/legacy.js', to: 'db:widgets', type: 'db-write' },
    { from: 'routes/w.js', to: 'db:widgets', type: 'db-read' },
  ],
  interventionIndex: {},
};
const routes = { routes: [{ method: 'POST', fullPath: '/api/widgets', routeFile: 'routes/w.js' }] };
const security = { routes: [{ key: 'POST /api/widgets', level: 'PROTECTED', roles: ['admin'] }] };
const feature360 = { features: [{
  id: 'widgets',
  ownership: { ownsTables: [{ table: 'widgets' }] },
  interfaces: { internalApis: [{ fn: 'createWidget', file: 'services/w.js' }] },
  consumedBy: [{ consumer: 'dashboard' }],
}] };
const entry = {
  file: 'features/widgets.feature.js',
  manifest: {
    name: 'widgets',
    owner: 'backend-core',
    service: 'Gérer les widgets',
    authority: 'backend-core — possède widgets',
    security: { note: 'toutes les routes exigent authenticate et la capability widget.write' },
    db: { tables: ['widgets: RW!', 'markets: R'] },
    contract: { exposes: ['POST /api/widgets'] },
    perimeter: { out: ['la facturation : billing'] },
    invariants: [
      'un widget appartient à une seule table append-only',
      { statement: 'la capability widget.write est exigée par la garde', test: 'tests/unit/w.test.js' },
      'le dashboard affiche le statut du widget',
      'la route POST /api/widgets répond 201',
    ],
  },
  ownedFiles: new Set([
    'services/w.js', 'routes/w.js', 'middleware/require-widget.js', 'migrations/301_w.sql', 'migrations/300_w.sql',
    'public/dashboards/canonical/js/widgets.js',
    'tests/unit/w-authority.test.js', 'tests/integration/w-real-db.test.js', 'tests/unit/w-route.test.js',
    'tests/unit/canonical-widgets-ui.test.js',
  ]),
};
const index = impactLib.indexSources({ graph, routes, security, feature360 });
const readSource = file => (file === 'routes/w.js'
  ? "const { authenticate } = require('../middleware/auth');\nconst g = require('../../middleware/require-widget.js');"
  : null);

describe('agent-context-pack', () => {
  test('type inconnu refusé avec la liste des types', () => {
    expect(() => packLib.buildPack('nope', entry, { index, feature360 })).toThrow(/ui, authz, migration, service, route/);
  });

  test('authz : autorité, sécurité, gardes (fichiers + requires des routes), routes, invariants et tests d’autorité', () => {
    const pack = packLib.buildPack('authz', entry, { index, feature360, readSource });
    expect(pack.guards).toEqual(['auth', 'require-widget']);
    expect(pack.routes).toEqual(['POST /api/widgets [PROTECTED admin]']);
    expect(pack.security).toContain('widget.write');
    expect(pack.invariants).toEqual(['la capability widget.write est exigée par la garde']);
    expect(pack.otherInvariants).toBe(3);
    expect(pack.tests).toEqual(['tests/unit/w-authority.test.js']);
    expect(pack.perimeterOut).toEqual(['la facturation : billing']);
  });

  test('migration : tables avec écrivain hors feature, migrations récentes d’abord, numérotation et règle de schéma', () => {
    const pack = packLib.buildPack('migration', entry, { index, feature360, migration: { next: '302', collisions: [] } });
    expect(pack.tables).toEqual(['widgets : 2 écrivain(s), 1 lecteur(s) · hors feature : services/legacy.js']);
    expect(pack.cardTables).toEqual(['widgets: RW!', 'markets: R']);
    expect(pack.migrations).toEqual(['migrations/301_w.sql', 'migrations/300_w.sql']);
    expect(pack.invariants).toEqual(['un widget appartient à une seule table append-only']);
    expect(pack.tests).toEqual(['tests/integration/w-real-db.test.js']);
    expect(pack.artifacts.map(a => a.id)).toEqual(['schema-intent']);
  });

  test('service : API internes, tables, consommateurs, tous les invariants', () => {
    const pack = packLib.buildPack('service', entry, { index, feature360 });
    expect(pack.internalApis).toEqual(['createWidget · services/w.js']);
    expect(pack.consumedBy).toEqual(['dashboard']);
    expect(pack.invariants).toHaveLength(4);
    expect(pack.otherInvariants).toBe(0);
  });

  test('route : routes, contrat, gardes, artefacts seulement si la feature possède des routes', () => {
    const pack = packLib.buildPack('route', entry, { index, feature360, readSource });
    expect(pack.contract).toEqual(['POST /api/widgets']);
    expect(pack.artifacts.map(a => a.id)).toEqual(['security-360', 'api-contract']);
    expect(pack.invariants).toEqual(['la route POST /api/widgets répond 201']);
    const noRoutes = { ...entry, ownedFiles: new Set(['public/boutique/js/x.js']) };
    expect(packLib.buildPack('route', noRoutes, { index, feature360 }).artifacts).toEqual([]);
  });

  test('ui : fichiers publics, API appelées, invariants et tests d’interface', () => {
    const pack = packLib.buildPack('ui', entry, { index, feature360 });
    expect(pack.uiFiles).toEqual(['public/dashboards/canonical/js/widgets.js']);
    expect(pack.apiCalled).toEqual(['POST /api/widgets']);
    expect(pack.invariants).toEqual(['le dashboard affiche le statut du widget']);
    expect(pack.tests).toEqual(['tests/unit/canonical-widgets-ui.test.js']);
  });

  test('rendu : aucune liste tronquée en silence, total et renvoi à --json au-delà de la limite', () => {
    const many = { ...packLib.buildPack('service', entry, { index, feature360 }) };
    many.internalApis = Array.from({ length: 23 }, (_, i) => `fn${i} · services/w.js`);
    const out = packLib.renderPack(many);
    expect(out).toContain('API internes (23):');
    expect(out).toContain('… 3 de plus : --json pour la liste complète');
    expect(out).toMatch(/budget: \d+ chars ≈ \d+ tokens$/);
    const authz = packLib.renderPack(packLib.buildPack('authz', entry, { index, feature360, readSource }));
    expect(authz).toContain('routes (1) : PROTECTED=1');
    const migration = packLib.renderPack(packLib.buildPack('migration', entry, {
      index, feature360, migration: { next: '302', collisions: [{ number: 301, branch: ['301_x.sql'], main: ['301_w.sql'] }] },
    }));
    expect(migration).toContain('prochain numéro de migration libre : 302');
    expect(migration).toContain('COLLISION 301');
    expect(migration).toContain('à régénérer et committer : bloc <!-- schema-pending -->');
  });

  test('guardsFromSources ignore les fichiers hors routes et les sources absentes', () => {
    expect(packLib.guardsFromSources(['services/w.js', 'routes/none.js'], () => null)).toEqual([]);
  });

  test('carte minimale : pack valide sans sections optionnelles', () => {
    const bare = { file: 'f.js', manifest: { name: 'bare' }, ownedFiles: new Set() };
    const pack = packLib.buildPack('authz', bare, { index: impactLib.indexSources({}), feature360: null });
    expect(pack).toEqual(expect.objectContaining({ security: null, guards: [], routes: [], invariants: [], authority: null }));
    expect(packLib.renderPack(pack)).toContain('PACK authz · feature bare');
  });
});

describe('agent-context --pack (câblage)', () => {
  const opts = { graph, routes, security, feature360, features: [entry], readSource };

  test('feature par nom ou par fichiers possédés', () => {
    expect(buildPacks('authz', { ...opts, featureNames: ['widgets'] })[0].feature).toBe('widgets');
    expect(buildPacks('route', { ...opts, files: ['routes/w.js'] })[0].routes).toHaveLength(1);
  });

  test('migration : statut de numérotation calculé depuis main et la branche', () => {
    const [pack] = buildPacks('migration', {
      ...opts, featureNames: ['widgets'], mainMigrations: ['migrations/301_w.sql'], localMigrations: ['migrations/301_w.sql'],
    });
    expect(pack.migration).toEqual({ next: '302', collisions: [] });
  });

  test('aucune feature résolue : erreur qui liste les features', () => {
    expect(() => buildPacks('authz', { ...opts, files: ['docs/x.md'] })).toThrow(/Features : widgets/);
  });
});

describe('agent-context --handoff (câblage)', () => {
  const { buildHandoff } = require('../../scripts/agent-context');
  test('packs + impacts des fichiers + règles AGENTS.md', () => {
    const out = buildHandoff('route', {
      graph, routes, security, feature360, features: [entry], readSource, files: ['routes/w.js'], isFile: true,
      skipTests: true, task: 'm', agentsMd: '## 8. R\n- règle\n',
    });
    expect(out).toContain('MISSION KOMERCE : m');
    expect(out).toContain('PACK route · feature widgets');
    expect(out).toContain('IMPACT routes/w.js');
  });
});
