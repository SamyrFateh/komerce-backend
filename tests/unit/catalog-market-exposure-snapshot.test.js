'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function migration206() {
  return fs.readFileSync(
    path.join(ROOT, 'migrations', '206_catalog_product_market_exposure_snapshot.sql'),
    'utf8'
  );
}

describe('catalog product-market-exposure snapshot — cutover historique', () => {
  test('le snapshot conserve les conditions storefront qui étaient vraies au cutover', () => {
    const migration = migration206();
    expect(migration).toContain('p.is_active = TRUE');
    expect(migration).toContain("p.product_ref NOT LIKE 'SHOWCASE-V2-%'");
    expect(migration).toContain("NULLIF(BTRIM(p.image_url), '') IS NOT NULL");
    expect(migration).toContain("p.image_url NOT ILIKE 'data:image/%'");
  });

  test('le snapshot historique ne fige pas le prédicat public futur', () => {
    const migration = migration206();
    // La migration 206 a capturé l'état du storefront à sa date de cutover.
    // Les nouveaux gates métier (disponibilité, unité vendable, SOI...) vivent
    // dans le prédicat canonique courant et ne doivent jamais réécrire une
    // migration déjà promue.
    expect(migration).not.toContain('supplier_order_identity');
    expect(migration).not.toContain('product_skus');
  });

  test('le snapshot croise chaque marché actif — pas un unique marché codé en dur', () => {
    const migration = migration206();
    expect(migration).toMatch(/CROSS JOIN markets m/);
    expect(migration).toMatch(/m\.is_active = TRUE/);
    expect(migration).not.toMatch(/m\.code\s*=\s*'[A-Z]{2}'/);
  });

  test('le snapshot est idempotent (ON CONFLICT DO NOTHING) et n\'écrit que ENABLED', () => {
    const migration = migration206();
    expect(migration).toMatch(/ON CONFLICT \(product_id, market_id\) DO NOTHING/);
    expect(migration).toMatch(/SELECT p\.id, m\.id, 'ENABLED'/);
    expect(migration).not.toMatch(/'DISABLED'/);
  });

  test('le snapshot ne modifie jamais products ni markets — projection pure vers product_market_exposure', () => {
    const migration = migration206();
    expect(migration).not.toMatch(/UPDATE products/i);
    expect(migration).not.toMatch(/UPDATE markets/i);
    expect(migration).not.toMatch(/DELETE FROM/i);
  });
});
