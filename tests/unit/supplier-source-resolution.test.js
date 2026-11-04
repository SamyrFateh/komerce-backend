'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @brief Gardes unitaires de la résolution unique du fournisseur d'achat (association produit ↔ fournisseur + priorité).
 */

const {
  SOURCE_STATUS, isForbiddenSkuProvider, assertSkuProviderAllowed,
  eligibleSourceFromWhereSql, skuSourceResolvedSql, resolveSupplierSource,
} = require('../../services/supplier-source-resolution');
const { sellableCatalogUnitSql } = require('../../services/catalog-public-view');

const { planSkuReconciliation } = require('../../services/catalog-promotion/sku');

const fakeClient = (rows) => ({ query: jest.fn(async () => ({ rows })) });

describe('supplier-source-resolution (unit)', () => {
  test('eBay est interdit (insensible à la casse), les autres providers passent', () => {
    expect(isForbiddenSkuProvider('ebay')).toBe(true);
    expect(isForbiddenSkuProvider(' eBay ')).toBe(true);
    expect(isForbiddenSkuProvider('aliexpress')).toBe(false);
    expect(() => assertSkuProviderAllowed({ provider: 'ebay', version: 1, payload: { a: 1 } })).toThrow(/FORBIDDEN_SKU_PROVIDER/);
    expect(() => assertSkuProviderAllowed({ provider: 'cj', version: 1, payload: { a: 1 } })).not.toThrow();
    expect(() => assertSkuProviderAllowed(null)).not.toThrow();
  });

  test('le SQL admissible exige association active, fournisseur actif non supprimé, catalogue global, plateforme = provider', () => {
    const sql = eligibleSourceFromWhereSql({ productSql: 'k.product_id', providerSql: 'x' }).replace(/\s+/g, ' ');
    expect(sql).toContain('ps.is_active = TRUE AND ps.deleted_at IS NULL');
    expect(sql).toContain('s.is_active = TRUE AND s.deleted_at IS NULL AND s.owner_scope IS NULL');
    expect(sql).toContain('lower(s.platform) = lower(x)');
    expect(sql).toContain("'ebay'");
  });

  test('la garde de vendabilité unique embarque la résolution fournisseur pour les SKU SUPPLIER', () => {
    expect(skuSourceResolvedSql('k')).toContain("COALESCE(k.source, 'MANUAL') <> 'SUPPLIER'");
    expect(sellableCatalogUnitSql('p').replace(/\s+/g, ' ')).toContain('FROM product_suppliers ps JOIN suppliers s');
  });

  test('résolu : plus haute priorité ; non résolu ; ambigu (égalité en tête) ; eBay refusé sans requête', async () => {
    const a = { id: 'a', priority: 1 }; const b = { id: 'b', priority: 2 };
    expect(await resolveSupplierSource(fakeClient([a, b]), { productId: 'p', provider: 'cj' }))
      .toMatchObject({ status: SOURCE_STATUS.RESOLVED, mapping: a });
    expect(await resolveSupplierSource(fakeClient([]), { productId: 'p', provider: 'cj' }))
      .toMatchObject({ status: SOURCE_STATUS.UNRESOLVED, mapping: null });
    expect(await resolveSupplierSource(fakeClient([a, { id: 'c', priority: 1 }]), { productId: 'p', provider: 'cj' }))
      .toMatchObject({ status: SOURCE_STATUS.AMBIGUOUS, mapping: null });
    const c = fakeClient([a]);
    expect(await resolveSupplierSource(c, { productId: 'p', provider: 'ebay' }))
      .toMatchObject({ status: SOURCE_STATUS.FORBIDDEN_PROVIDER });
    expect(c.query).not.toHaveBeenCalled();
  });

  test('le writer canonique de SKU refuse une identité eBay (écriture) et accepte les autres providers', () => {
    const unit = (provider) => ({
      supplier_sku: 'S1', supplier_unit_ref: 'r1', stock_available: 3,
      supplier_order_identity: { provider, version: 1, payload: { id: 'x' } },
    });
    expect(() => planSkuReconciliation([], [unit('ebay')])).toThrow(/FORBIDDEN_SKU_PROVIDER/);
    expect(() => planSkuReconciliation([], [unit('aliexpress')])).not.toThrow();
  });
});
