'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const { publicCatalogVisibilitySql } = require('../../services/catalog-public-view');

const ROOT = path.join(__dirname, '..', '..');

describe('catalog product-market-exposure snapshot — équivalence avec le prédicat public canonique', () => {
  test('chaque condition de publicCatalogVisibilitySql(\'p\') apparaît telle quelle dans la migration 206', () => {
    const migration = fs.readFileSync(
      path.join(ROOT, 'migrations', '206_catalog_product_market_exposure_snapshot.sql'),
      'utf8'
    );
    const predicate = publicCatalogVisibilitySql('p');
    const conditions = predicate.split(' AND ');
    expect(conditions.length).toBeGreaterThanOrEqual(4);
    for (const condition of conditions) {
      expect(migration).toContain(condition);
    }
  });

  test('le snapshot croise chaque marché actif — pas un unique marché codé en dur', () => {
    const migration = fs.readFileSync(
      path.join(ROOT, 'migrations', '206_catalog_product_market_exposure_snapshot.sql'),
      'utf8'
    );
    expect(migration).toMatch(/CROSS JOIN markets m/);
    expect(migration).toMatch(/m\.is_active = TRUE/);
    expect(migration).not.toMatch(/m\.code\s*=\s*'[A-Z]{2}'/); // aucun marché unique codé en dur
  });

  test('le snapshot est idempotent (ON CONFLICT DO NOTHING) et n\'écrit que ENABLED', () => {
    const migration = fs.readFileSync(
      path.join(ROOT, 'migrations', '206_catalog_product_market_exposure_snapshot.sql'),
      'utf8'
    );
    expect(migration).toMatch(/ON CONFLICT \(product_id, market_id\) DO NOTHING/);
    expect(migration).toMatch(/SELECT p\.id, m\.id, 'ENABLED'/);
    expect(migration).not.toMatch(/'DISABLED'/);
  });

  test('le snapshot ne modifie jamais products ni markets — projection pure vers product_market_exposure', () => {
    const migration = fs.readFileSync(
      path.join(ROOT, 'migrations', '206_catalog_product_market_exposure_snapshot.sql'),
      'utf8'
    );
    expect(migration).not.toMatch(/UPDATE products/i);
    expect(migration).not.toMatch(/UPDATE markets/i);
    expect(migration).not.toMatch(/DELETE FROM/i);
  });
});
