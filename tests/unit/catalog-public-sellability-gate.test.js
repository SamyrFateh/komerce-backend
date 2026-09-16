'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  sellableCatalogUnitSql,
  publicCatalogVisibilitySql,
  isPublicCatalogProduct,
} = require('../../services/catalog-public-view');

describe('catalog public visibility = static sellability + market truth', () => {
  test('une visibilité publique exige disponibilité et au moins une unité vendable', () => {
    const sql = publicCatalogVisibilitySql('p');
    expect(sql).toContain('p.is_active = TRUE');
    expect(sql).toContain('p.is_available = TRUE');
    expect(sql).toContain('product_skus');
    expect(sql).toContain('product_variants');
    expect(sql).toContain('sellable_sku.stock > 0');
  });

  test('un SKU fournisseur visible doit porter une SOI conforme au contrat canonique minimal', () => {
    const sql = sellableCatalogUnitSql('p');
    expect(sql).toContain("sellable_sku.source, 'MANUAL'");
    expect(sql).toContain("<> 'SUPPLIER'");
    expect(sql).toContain('sellable_sku.supplier_sku');
    expect(sql).toContain('sellable_sku.supplier_unit_ref');
    expect(sql).toContain('sellable_sku.supplier_order_identity');
    expect(sql).toContain("supplier_order_identity->>'provider'");
    expect(sql).toContain("supplier_order_identity->>'version'");
    expect(sql).toContain("supplier_order_identity->'payload'");
    expect(sql).toContain("<> '{}'::jsonb");
  });

  test('la visibilité marché exige exposition et prix actif sur le même code marché', () => {
    const sql = publicCatalogVisibilitySql('p', { marketCodeParamIndex: 1 });
    expect(sql).toContain('pme_mkt.code = $1');
    expect(sql).toContain("pme.commercial_exposure = 'ENABLED'");
    expect(sql).toContain('pmpd_mkt.code = $1');
    expect(sql).toContain("pmpd.status = 'LOCAL_ACTIVE'");
  });

  test('un produit explicitement indisponible ne passe jamais la frontière publique mémoire', () => {
    expect(isPublicCatalogProduct({
      is_active: true,
      is_available: false,
      product_ref: 'KPR-1',
      image_url: 'https://cdn.example.com/p.jpg',
    })).toBe(false);
  });

  test('le gate statique ne prétend pas remplacer le preflight fournisseur dynamique', () => {
    const sql = publicCatalogVisibilitySql('p', { marketCodeParamIndex: 1 });
    expect(sql).not.toContain('purchase_orders');
    expect(sql).not.toContain('placeOrder');
  });
});
