'use strict';

const impactLib = require('../../scripts/lib/agent-context-impact');
const { buildImpact } = require('../../scripts/agent-context');
const { listRelatedTests } = require('../../scripts/run-staged-related-tests');

const graph = {
  edges: [
    { from: 'services/a.js', to: 'db:widgets', type: 'db-write' },
    { from: 'routes/r.js', to: 'db:widgets', type: 'db-write-via', via: 'a-service' },
    { from: 'services/legacy.js', to: 'db:widgets', type: 'db-write' },
    { from: 'services/b.js', to: 'db:widgets', type: 'db-read' },
    { from: 'services/a.js', to: 'services/b.js', type: 'depends' },
  ],
  interventionIndex: {
    'services/a.js': {
      role: 'widget-writer',
      dbWrite: ['widgets'],
      dbWriteVia: [{ via: 'x-service', tables: ['gadgets'] }, 'legacy_table'],
      dbRead: ['markets'],
      directDependsOn: ['db'],
      directUsedBy: ['routes/r.js', 'services/c.js'],
      mustCheck: ['db:widgets'],
    },
  },
  multiWriterTables: [{ table: 'widgets', writerCount: 3 }],
};
const routes = { routes: [
  { method: 'GET', fullPath: '/api/widgets/:id', routeFile: 'routes/r.js' },
  { method: 'POST', fullPath: '/api/widgets', routeFile: 'routes/r.js' },
] };
const security = { routes: [{ key: 'GET /api/widgets/{id}', level: 'PROTECTED', roles: ['admin'] }] };
const feature360 = { features: [{
  id: 'widgets',
  ownership: { ownsTables: [{ table: 'widgets' }] },
  consumedBy: [{ consumer: 'dashboard' }, { consumer: 'dashboard' }],
  businessDependencies: [{ provider: 'auth' }],
  invariants: [{ statement: 'x', test: 'tests/unit/x.test.js' }, 'prose seule'],
}] };
const featureEntry = {
  file: 'features/widgets.feature.js',
  manifest: { name: 'widgets', owner: 'backend-core' },
  ownedFiles: new Set(['services/a.js', 'routes/r.js', 'migrations/300_widgets.sql', 'tests/unit/a.test.js']),
};

describe('agent-context-impact : projection', () => {
  const index = impactLib.indexSources({ graph, routes, security, feature360 });

  test('securityKey aligne le registre de routes sur la clé SECURITY_360', () => {
    expect(impactLib.securityKey('get', '/api/x/:id/y/:z')).toBe('GET /api/x/{id}/y/{z}');
  });

  test('impact d’un fichier : tables écrites (directes et indirectes), lecteurs, consommateurs, routes exposées', () => {
    const impact = impactLib.fileImpact(index, './services/a.js', { feature: 'widgets' });
    expect(impact.target).toBe('services/a.js');
    expect(impact.tablesWritten.map(t => t.table)).toEqual(['widgets', 'gadgets', 'legacy_table']);
    const widgets = impact.tablesWritten[0];
    expect(widgets.writers).toEqual(['routes/r.js (via a-service)', 'services/a.js', 'services/legacy.js']);
    expect(widgets.readers).toEqual(['services/b.js']);
    expect(widgets.multiWriter).toBe(3);
    expect(impact.usedBy).toEqual(['routes/r.js', 'services/c.js']);
    expect(impact.exposedVia).toEqual([{ file: 'routes/r.js', routes: [
      { key: 'GET /api/widgets/{id}', level: 'PROTECTED', roles: ['admin'] },
      { key: 'POST /api/widgets', level: 'NON CLASSÉE', roles: [] },
    ] }]);
    expect(impact.artifacts).toEqual([]);
  });

  test('un fichier de routes impose SECURITY_360 et le contrat ; une migration impose le bloc de schéma', () => {
    expect(impactLib.artifactsFor(['routes/r.js']).map(a => a.id)).toEqual(['security-360', 'api-contract']);
    expect(impactLib.artifactsFor(['server.js']).map(a => a.id)).toEqual(['security-360']);
    expect(impactLib.artifactsFor(['migrations/300_x.sql']).map(a => a.id)).toEqual(['schema-intent']);
    expect(impactLib.artifactsFor(['services/a.js'])).toEqual([]);
  });

  test('chaque commande npm déclarée dans ARTIFACT_RULES existe dans package.json', () => {
    const scripts = require('../../package.json').scripts;
    for (const rule of impactLib.ARTIFACT_RULES) {
      const m = rule.command.match(/^npm run ([\w:.-]+)/);
      if (m) expect({ rule: rule.id, exists: Boolean(scripts[m[1]]) }).toEqual({ rule: rule.id, exists: true });
      expect(rule.gate.length).toBeGreaterThan(10);
    }
  });

  test('impact d’une feature : écrivains hors feature signalés, routes, consommateurs dédupliqués, invariants testés', () => {
    const impact = impactLib.featureImpact(index, featureEntry, {});
    expect(impact.tables).toEqual([expect.objectContaining({ table: 'widgets', foreignWriters: ['services/legacy.js'] })]);
    expect(impact.routes).toHaveLength(2);
    expect(impact.consumedBy).toEqual(['dashboard']);
    expect(impact.dependsOnFeatures).toEqual(['auth']);
    expect(impact.invariants).toEqual({ total: 2, tested: 1 });
    expect(impact.tests).toEqual(['tests/unit/a.test.js']);
    expect(impact.artifacts.map(a => a.id)).toEqual(['security-360', 'api-contract', 'schema-intent']);
  });

  test('feature absente de FEATURE_360 : projection vide mais valide', () => {
    const impact = impactLib.featureImpact(impactLib.indexSources({}), { file: 'f', manifest: { name: 'ghost' }, ownedFiles: new Set() });
    expect(impact).toEqual(expect.objectContaining({ tables: [], routes: [], consumedBy: [], invariants: { total: 0, tested: 0 } }));
  });

  test('migrations : prochain numéro libre et collision avec main', () => {
    const status = impactLib.migrationStatus({
      mainFiles: ['migrations/268_a.sql', 'migrations/269_b.sql', 'migrations/README.md'],
      localFiles: ['migrations/268_a.sql', 'migrations/269_b.sql', 'migrations/269_mine.sql'],
    });
    expect(status).toEqual({ next: '270', collisions: [{ number: 269, branch: ['269_mine.sql'], main: ['269_b.sql'] }] });
    expect(impactLib.migrationStatus({})).toEqual({ next: '001', collisions: [] });
  });

  test('rendu : listes longues résumées avec renvoi à --json, budget affiché', () => {
    const big = { ...impactLib.fileImpact(index, 'services/a.js', {}), usedBy: Array.from({ length: 12 }, (_, i) => `f${i}.js`) };
    big.tests = { full: false, list: [] };
    big.migration = { next: '270', collisions: [{ number: 269, branch: ['x.sql'], main: ['y.sql'] }] };
    big.artifacts = impactLib.artifactsFor(['routes/r.js']);
    big.routes = [{ key: 'GET /a', level: 'PUBLIC', roles: [] }];
    const out = impactLib.renderImpact(big);
    expect(out).toContain('consommateurs directs (à revérifier) (12)');
    expect(out).toContain('(+4 : --json pour la liste complète)');
    expect(out).toContain('tests liés: aucun trouvé');
    expect(out).toContain('COLLISION 269');
    expect(out).toContain('à régénérer et committer: npm run security:360');
    expect(out).toContain('routes déclarées (1) PUBLIC=1');
    expect(out).toMatch(/budget: \d+ chars ≈ \d+ tokens$/);
    const full = impactLib.renderImpact({ ...big, tests: { full: true } });
    expect(full).toContain('suite unitaire backend complète');
    const feature = impactLib.renderImpact(impactLib.featureImpact(index, featureEntry, {}));
    expect(feature).toContain('ÉCRIVAINS HORS FEATURE 1');
    expect(feature).toContain('invariants: 2 dont 1 vérifiés par un test');
  });
});

describe('agent-context --impact (câblage)', () => {
  const sources = { graph, routes, security, feature360, features: [featureEntry] };

  test('fichier : feature propriétaire résolue et tests liés fournis par le résolveur partagé', () => {
    const lister = jest.fn(() => ['tests/unit/a.test.js']);
    const impact = buildImpact('services/a.js', { ...sources, isFile: true, listRelatedTests: lister });
    expect(impact.feature).toBe('widgets');
    expect(lister).toHaveBeenCalledWith(['services/a.js']);
    expect(impact.tests).toEqual({ full: false, list: ['tests/unit/a.test.js'] });
  });

  test('migration : suite complète annoncée et statut de numérotation', () => {
    const impact = buildImpact('migrations/300_widgets.sql', {
      ...sources, isFile: true, mainMigrations: ['migrations/299_x.sql'], localMigrations: ['migrations/300_widgets.sql'],
    });
    expect(impact.tests).toEqual({ full: true });
    expect(impact.migration).toEqual({ next: '301', collisions: [] });
    expect(impact.feature).toBe('widgets');
  });

  test('--no-tests : aucune résolution de tests', () => {
    const lister = jest.fn();
    const impact = buildImpact('services/a.js', { ...sources, isFile: true, skipTests: true, listRelatedTests: lister });
    expect(impact.tests).toBeNull();
    expect(lister).not.toHaveBeenCalled();
  });

  test('outillage scripts/ : tests qui référencent le fichier ajoutés au résolveur runtime', () => {
    const lister = jest.fn(() => ['tests/unit/z.test.js']);
    const trackedTests = [
      { path: 'tests/unit/tool.test.js', source: "require('../../scripts/tool');" },
      { path: 'tests/unit/z.test.js', source: "spawn('node', ['scripts/tool.js'])" },
      { path: 'tests/unit/other.test.js', source: "require('../../scripts/tool-extra');" },
    ];
    const impact = buildImpact('scripts/tool.js', { ...sources, isFile: true, listRelatedTests: lister, trackedTests });
    expect(impact.tests).toEqual({ full: false, list: ['tests/unit/tool.test.js', 'tests/unit/z.test.js'] });
  });

  test('feature par nom (insensible à la casse) ; cible inconnue refusée avec la liste des features', () => {
    expect(buildImpact('Widgets', { ...sources, isFile: false }).kind).toBe('feature');
    expect(() => buildImpact('nope', { ...sources, isFile: false })).toThrow(/Features : widgets/);
  });
});

describe('toolingTests', () => {
  test('require relatif, chemin cité, extension ; ni préfixe homonyme ni chemin imbriqué ni source absente', () => {
    const tests = [
      { path: 'a', source: "require('../../scripts/lib/x')" },
      { path: 'b', source: '"scripts/lib/x.js"' },
      { path: 'c', source: "require('../../scripts/lib/x-y')" },
      { path: 'd', source: "'public/boutique/scripts/lib/x.js'" },
      { path: 'e', source: null },
    ];
    expect(impactLib.toolingTests('scripts/lib/x.js', tests)).toEqual(['a', 'b']);
  });
});

describe('listRelatedTests (résolveur partagé avec le gate CI)', () => {
  test('rend les tests directement fournis, en chemins relatifs dédupliqués', () => {
    const workspace = {
      name: 'fake', cwd: process.cwd(), prefix: '', config: null,
      isSource: () => false, isUnitTest: f => /^tests\/unit\/.+\.test\.js$/.test(f), contentAware: false,
    };
    const result = listRelatedTests(['tests/unit/agent-context-impact.test.js', 'tests/unit/agent-context-impact.test.js'], {
      tracked: [], workspaces: [workspace],
    });
    expect(result).toEqual(['tests/unit/agent-context-impact.test.js']);
  });

  test('aucun fichier pertinent : liste vide', () => {
    expect(listRelatedTests(['docs/x.md'], { tracked: [] })).toEqual([]);
  });
});
