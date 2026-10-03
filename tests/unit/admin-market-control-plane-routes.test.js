'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'routes', 'admin-market-control-plane.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

describe('admin market control plane — vue centrale en lecture seule', () => {
  test('les deux routes exigent authenticate + rôle admin déclaré', () => {
    expect(source).toMatch(/const centralAdmin = \[authenticate, requireRole\(\['admin'\]\)\]/);
    expect(source).toMatch(/router\.get\('\/', \.\.\.centralAdmin/);
    expect(source).toMatch(/router\.get\('\/:marketCode\/control-plane', \.\.\.centralAdmin/);
  });

  test('aucune écriture : seulement des GET', () => {
    expect(source).not.toMatch(/router\.(post|put|patch|delete)\(/);
  });

  test('la liste répond { markets } et la vue répond le résultat du service tel quel', () => {
    expect(source).toContain('res.json({ markets: await controlPlane.listMarkets(db) })');
    expect(source).toContain('res.json(await controlPlane.getControlPlane(db, req.params.marketCode))');
  });

  test('la vue d’autorité centrale est admin, en lecture seule, déclarée avant la route paramétrée', () => {
    expect(source).toMatch(/router\.get\('\/central-authority', \.\.\.centralAdmin/);
    expect(source).toContain('res.json(await centralAuthority.overview(db))');
    expect(source.indexOf("'/central-authority'")).toBeLessThan(source.indexOf("'/:marketCode/control-plane'"));
  });

  test('aucun accès SQL direct dans la route', () => {
    expect(source).not.toMatch(/db\.query|getClient/);
  });

  test('montée exactement une fois sur /api/admin/markets', () => {
    expect(bootstrap).toMatch(/const adminMarketControlPlaneRouter = require\('\.\.\/routes\/admin-market-control-plane'\)/);
    expect(bootstrap.match(/app\.use\('\/api\/admin\/markets', adminMarketControlPlaneRouter\)/g) || []).toHaveLength(1);
  });
});
