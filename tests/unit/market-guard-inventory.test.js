'use strict';

const fs = require('fs');
const path = require('path');
const inventory = require('../../scripts/market-guard-inventory');

const ROOT = path.resolve(__dirname, '../..');
const graph = {
  edges: [
    { from: 'routes/a.js', to: 'db:dashboard_global_access_grants', type: 'db-read' },
    { from: 'routes/a.js', to: 'db:pricing_global_access_grants', type: 'db-read' },
    { from: 'routes/a.js', to: 'db:orders', type: 'db-read' },
    { from: 'routes/other.js', to: 'db:catalog_global_access_grants', type: 'db-read' },
  ],
};
const security = {
  routes: [
    { key: 'GET /api/z', level: 'PROTECTED', roles: ['admin'] },
    { key: 'POST /api/a/{id}', level: 'PROTECTED', roles: ['admin', 'market_operator'], marketGuards: ['requireMarketScope'], file: 'routes/a.js' },
    { key: 'GET /api/a', level: 'PROTECTED', roles: ['admin'], marketGuards: ['attachAuthorizedMarkets'], file: 'routes/a.js' },
    { key: 'GET /api/b', level: 'PROTECTED', roles: ['admin', 'agent_hub'], marketGuards: ['attachAuthorizedMarketsForOperator'], file: 'routes/b.js' },
  ],
};

describe('market-guard-inventory', () => {
  test('centralDomains : domaines des tables *_global_access_grants lues par le fichier, triés', () => {
    expect(inventory.centralDomains(graph, 'routes/a.js')).toEqual(['dashboard', 'pricing']);
    expect(inventory.centralDomains(graph, 'routes/b.js')).toEqual([]);
    expect(inventory.centralDomains(null, 'routes/a.js')).toEqual([]);
    expect(inventory.centralDomains({ edges: [{ from: 'routes/a.js' }] }, 'routes/a.js')).toEqual([]);
  });

  test('buildInventory : seules les routes gardées, regroupées par fichier, autorité explicite ou rôle seul', () => {
    const inv = inventory.buildInventory({ security, graph });
    expect(inv.summary).toEqual({ files: 2, routes: 3, explicitCentralRoutes: 2, roleOnlyRoutes: 1 });
    expect(inv.files.map(f => [f.file, f.access])).toEqual([['routes/a.js', 'EXPLICIT_CENTRAL'], ['routes/b.js', 'ROLE_ONLY']]);
    expect(inv.files[0].routes.map(r => r.key)).toEqual(['GET /api/a', 'POST /api/a/{id}']);
    expect(inv.files[0].roles).toEqual(['admin', 'market_operator']);
    expect(inventory.buildInventory({ security: null, graph: null }).summary.routes).toBe(0);
  });

  test('buildInventory : une route gardée sans fichier source échoue fort, jamais en silence', () => {
    const broken = { routes: [{ key: 'GET /api/x', roles: [], marketGuards: ['requireMarketScope'] }] };
    expect(() => inventory.buildInventory({ security: broken, graph })).toThrow(/sans fichier source : GET \/api\/x/);
  });

  test('rendu : résumé compact (les accès par rôle signalés), checklist à une ligne par route', () => {
    const inv = inventory.buildInventory({ security, graph });
    const summary = inventory.renderSummary(inv);
    expect(summary).toContain('3 routes dans 2 fichiers');
    expect(summary).toContain('! routes/b.js');
    expect(summary).toContain('autorité centrale : dashboard+pricing');
    expect(summary).toContain('AUCUNE (accès par rôle)');
    const checklist = inventory.renderChecklist(inv);
    expect(checklist).toContain('- [ ] POST /api/a/{id} · rôles admin/market_operator · avant : requireMarketScope · après : ___ · test de refus : ___ · comptes à autoriser : ___');
    expect(checklist).toContain('## routes/b.js — AUCUNE (accès par rôle)');
    const bare = inventory.renderChecklist(inventory.buildInventory({
      security: { routes: [{ key: 'GET /api/n', level: 'PROTECTED', roles: [], marketGuards: ['requireMarketScope'], file: 'routes/n.js' }] }, graph,
    }));
    expect(bare).toContain('rôles — ·');
  });

  test('main : l’inventaire réel est à zéro après D9', () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      inventory.main(['--json']);
      expect(JSON.parse(write.mock.calls[0][0]).summary).toEqual({
        files: 0,
        routes: 0,
        explicitCentralRoutes: 0,
        roleOnlyRoutes: 0,
      });
      inventory.main(['--checklist']);
      expect(write.mock.calls[1][0]).not.toContain('- [ ] ');
      inventory.main([]);
      expect(write.mock.calls[2][0]).toContain('0 routes dans 0 fichiers');
    } finally {
      write.mockRestore();
    }
  });

  test('garde contre régression : aucune route runtime ne réimporte require-market-scope après D9', () => {
    const security360 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/SECURITY_360.json'), 'utf8'));
    const graph360 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/komerce-arch-header-graph.json'), 'utf8'));
    const inventoried = inventory.buildInventory({ security: security360, graph: graph360 });
    const importers = [];
    const walk = dir => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.js$/.test(entry.name) && /require\(['"][./]+\/middleware\/require-market-scope(\.js)?['"]\)/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) importers.push(rel);
      }
    };
    walk('routes');
    expect(importers).toEqual([]);
    expect(inventoried.summary.routes).toBe(0);
  });
});
