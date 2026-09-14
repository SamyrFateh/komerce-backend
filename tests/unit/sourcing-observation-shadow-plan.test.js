'use strict';

const shadow = require('../../services/sourcing-observation-shadow-service');
const plan = require('../../services/sourcing-observation-shadow-plan');

function richProduct() {
  return {
    schema_version: '2', supplier_name: 'CJ', supplier_product_id: 'P-1',
    product_name: 'Produit test', purchase_price: 12, currency: 'USD', stock_available: 7,
    sellable_units: [
      { supplier_sku: 'SKU-RED-M', supplier_unit_ref: 'VID-1', option_values: { color: 'red', size: 'M' }, stock_available: 3 },
      { supplier_sku: 'SKU-BLUE-L', option_values: { color: 'blue', size: 'L' }, stock_available: 4 },
    ],
    raw_payload: { pid: 'P-1' },
  };
}

describe('sourcing shadow observation plan', () => {
  test('namespace une source API par provider technique', () => {
    expect(shadow.buildSourceDescriptor({ sourceType: 'api', supplierName: 'CJdropshipping', supplierId: 'CJ' }))
      .toEqual({ sourceId: 'api:cj', adapterType: 'cj', acquisition: 'pull', continuity: 'recurring' });
  });

  test('une source manuelle reste stable par canal et fournisseur', () => {
    const a = shadow.buildSourceDescriptor({ sourceType: 'manual', supplierName: 'Fundi Local' });
    const b = shadow.buildSourceDescriptor({ sourceType: 'manual', supplierName: 'fundi local' });
    expect(a.sourceId).toBe(b.sourceId);
    expect(a.sourceId).toMatch(/^manual:fundi-local:/);
  });

  test('projette Product -> Offer -> Unit sans inventer source_ref Offer', () => {
    const p = plan.buildObservationPlan([richProduct()], {
      captureId: '00000000-0000-4000-8000-000000000001',
      observedAt: '2026-09-14T07:00:00.000Z',
    });
    expect([p.productCount, p.offerCount, p.unitCount]).toEqual([1, 1, 2]);
    expect(p.rows.map((r) => r.grain)).toEqual(['product', 'offer', 'unit', 'unit']);
    const [product, offer, unit1, unit2] = p.rows;
    expect(product.sourceRef).toBe('P-1');
    expect(offer.sourceRef).toBeNull();
    expect(offer.parentId).toBe(product.id);
    expect(unit1.parentId).toBe(offer.id);
    expect(unit1.sourceRef).toBe('VID-1');
    expect(unit2.sourceRef).toBe('SKU-BLUE-L');
    expect(product.normalized).not.toHaveProperty('purchase_price');
    expect(plan.observedProvides(p)).toEqual(['catalog', 'offers', 'units']);
  });

  test('ignore V1', () => {
    const p = plan.buildObservationPlan([{ supplier_name: 'Legacy', product_name: 'x' }], {
      captureId: '00000000-0000-4000-8000-000000000001', observedAt: '2026-09-14T07:00:00.000Z',
    });
    expect(p.rows).toEqual([]);
  });
});
