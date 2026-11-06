'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'scripts/recette/hub-v1-http-physical-chain.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'routes/admin-operations-workspace.js'), 'utf8');

describe('chaine physique HTTP : memes routes que l UI', () => {
  test('n appelle ni /api/hub/* ni /api/scans/collect (interdits au front)', () => {
    const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    expect(code).not.toMatch(/['"`]\/api\/hub\//);
    expect(code).not.toMatch(/\/api\/scans\/collect/);
  });
  test('chaque route du workspace utilisee existe cote backend', () => {
    for (const tail of ['/supply/physical-code', '/bags', '/bags/:unitId/deposit', '/bags/:unitId/close', '/boxes', '/boxes/:unitId/bags', '/boxes/shipment', '/relay-shipments/:reference/receive', '/parcels/:reference/collect']) {
      expect(routes).toContain(`'/market/:marketCode${tail}'`);
    }
  });
  test('chaque ligne cite le fichier:ligne du front et les refus de roles sont attendus 403', () => {
    expect(src).toMatch(/operations-workspace\.js/);
    expect((src.match(/\$\{JS\}:\d+/g) || []).length).toBeGreaterThanOrEqual(8);
    expect(src).toMatch(/deny: true/);
  });
});
