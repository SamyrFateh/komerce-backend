'use strict';

const readiness = require('../../services/suppliers/supplier-fulfillment-readiness');

function dbWith(row) {
  return {
    query: jest.fn(async (sql) => {
      if (sql.includes('FROM product_skus')) return { rows: row ? [row] : [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
}

function sku(overrides = {}) {
  return {
    id: 'sku-1',
    product_id: 'product-1',
    supplier_sku: 'BUSINESS-SKU-1',
    supplier_unit_ref: 'UNIT-42',
    supplier_order_identity: {
      provider: 'generic-supplier',
      version: 1,
      payload: { variant_ref: 'VAR-42' },
    },
    stock: 8,
    is_active: true,
    source: 'SUPPLIER',
    ...overrides,
  };
}

function hubRoute(overrides = {}) {
  return {
    mode: 'PROCUREMENT_HUB',
    hub: { code: 'DXB', name: 'Hub Dubai', country_code: 'AE', ...overrides },
  };
}

function adapterReturning(status, evidence = {}, reason = null) {
  return {
    provider: 'generic-supplier',
    evaluate: jest.fn(async ({ identity, quantity, destination, procurementRoute, VERDICT, result }) => {
      expect(identity.payload).toEqual({ variant_ref: 'VAR-42' });
      expect(quantity).toBeGreaterThan(0);
      expect(destination.country_code).toBe('AE');
      expect(procurementRoute.mode).toBe('PROCUREMENT_HUB');
      return result(VERDICT[status], evidence, reason);
    }),
  };
}

describe('supplier fulfillment readiness', () => {
  it('refuse une destination brute sans Procurement Route explicite', async () => {
    const db = dbWith(sku());
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db,
      productSkuId: 'sku-1',
      destination: { country_code: 'KM' },
      adapters: { 'generic-supplier': adapterReturning('READY') },
    });
    expect(out.status).toBe('PROCUREMENT_ROUTE_UNRESOLVED');
    expect(out.reason).toMatch(/procurementRoute explicite requis|destination brute interdite/i);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('n’ouvre aucun mode direct fournisseur-client dans le moteur actuel', async () => {
    const db = dbWith(sku());
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db,
      productSkuId: 'sku-1',
      procurementRoute: { mode: 'DIRECT_TO_CUSTOMER' },
      adapters: { 'generic-supplier': adapterReturning('READY') },
    });
    expect(out.status).toBe('PROCUREMENT_ROUTE_UNRESOLVED');
    expect(out.reason).toMatch(/seul PROCUREMENT_HUB est ouvert/i);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('dérive la destination fournisseur du hub et non du Market', () => {
    expect(readiness.normalizeProcurementRoute(hubRoute())).toEqual({
      mode: 'PROCUREMENT_HUB',
      hub: {
        id: null,
        code: 'DXB',
        name: 'Hub Dubai',
        country_code: 'AE',
        province_code: null,
        city_code: null,
      },
      supplier_destination: {
        country_code: 'AE',
        province_code: null,
        city_code: null,
      },
    });
  });

  it('bloque une identité persistée absente', async () => {
    const db = dbWith(sku({ supplier_unit_ref: null, supplier_order_identity: null }));
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db,
      productSkuId: 'sku-1',
      procurementRoute: hubRoute(),
      adapters: { 'generic-supplier': adapterReturning('READY') },
    });
    expect(out.status).toBe('BLOCKED_SUPPLIER_IDENTITY');
    expect(out.ready).toBe(false);
  });

  it('reste supplier-agnostic et échoue proprement sans adapter enregistré', async () => {
    const db = dbWith(sku());
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db,
      productSkuId: 'sku-1',
      procurementRoute: hubRoute(),
    });
    expect(out.status).toBe('SUPPLIER_UNAVAILABLE');
    expect(out.ready).toBe(false);
    expect(out.evidence.provider).toBe('generic-supplier');
    expect(out.reason).toMatch(/adapter fulfillment absent/i);
  });

  it('normalise les clés provider injectées', async () => {
    const db = dbWith(sku());
    const adapter = adapterReturning('READY', { exact_unit_resolved: true });
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db,
      productSkuId: 'sku-1',
      procurementRoute: hubRoute(),
      adapters: { ' GENERIC-SUPPLIER ': adapter },
    });
    expect(out.status).toBe('FULFILLMENT_READY');
    expect(out.ready).toBe(true);
    expect(adapter.evaluate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['OUT_OF_STOCK', 'OUT_OF_STOCK'],
    ['NOT_SHIPPABLE', 'NOT_SHIPPABLE'],
    ['FREIGHT_UNAVAILABLE', 'FREIGHT_UNAVAILABLE'],
    ['PRICE_DRIFT_BLOCKED', 'PRICE_DRIFT_BLOCKED'],
    ['SUPPLIER_UNAVAILABLE', 'SUPPLIER_UNAVAILABLE'],
  ])('accepte le verdict canonique %s de n’importe quel adapter', async (key, expected) => {
    const db = dbWith(sku());
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db,
      productSkuId: 'sku-1',
      procurementRoute: hubRoute(),
      adapters: { 'generic-supplier': adapterReturning(key, { provider_fact: true }) },
    });
    expect(out.status).toBe(expected);
    expect(out.ready).toBe(false);
    expect(out.evidence.provider_fact).toBe(true);
  });

  it('devient FULFILLMENT_READY via le contrat générique sans connaître le fournisseur', async () => {
    const db = dbWith(sku());
    const adapter = adapterReturning('READY', {
      provider: 'generic-supplier',
      exact_unit_resolved: true,
      live_stock_checked: true,
      live_price_checked: true,
      supplier_leg_checked: true,
      place_order_invoked: false,
      payment_invoked: false,
    });
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db,
      productSkuId: 'sku-1',
      quantity: 1,
      procurementRoute: hubRoute(),
      adapters: { 'generic-supplier': adapter },
    });

    expect(out.status).toBe('FULFILLMENT_READY');
    expect(out.ready).toBe(true);
    expect(out.evidence.procurement_route_mode).toBe('PROCUREMENT_HUB');
    expect(out.evidence.procurement_hub_code).toBe('DXB');
    expect(out.evidence.procurement_hub_country_code).toBe('AE');
    expect(out.evidence.place_order_invoked).toBe(false);
    expect(out.evidence.payment_invoked).toBe(false);
    expect(adapter.evaluate).toHaveBeenCalledTimes(1);
  });
});
