'use strict';

const readiness = require('../../services/suppliers/supplier-fulfillment-readiness');
const ali = require('../../services/suppliers/aliexpress-fulfillment-adapter');

function dbWith(row, candidateRefs = ['100500123']) {
  return {
    query: jest.fn(async (sql) => {
      if (sql.includes('FROM product_skus')) return { rows: row ? [row] : [] };
      if (sql.includes('FROM sourcing_candidates')) {
        return { rows: candidateRefs.map(supplier_product_id => ({ supplier_product_id })) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
}

function sku(overrides = {}) {
  return {
    id: 'sku-1', product_id: 'product-1', supplier_sku: 'AE-SKU-1',
    supplier_unit_ref: '2000001',
    supplier_order_identity: { provider: 'aliexpress', version: 1, payload: { sku_id: '2000001' } },
    stock: 8, is_active: true, source: 'SUPPLIER',
    ...overrides,
  };
}

function hubRoute(overrides = {}) {
  return {
    mode: 'PROCUREMENT_HUB',
    hub: { code: 'DXB', name: 'Hub Dubai', country_code: 'AE', ...overrides },
  };
}

describe('supplier fulfillment readiness', () => {
  it('refuse une destination brute sans Procurement Route explicite', async () => {
    const db = dbWith(sku());
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db,
      productSkuId: 'sku-1',
      destination: { country_code: 'KM' },
      adapters: { aliexpress: ali },
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
      adapters: { aliexpress: ali },
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
      db, productSkuId: 'sku-1', procurementRoute: hubRoute(),
      adapters: { aliexpress: ali },
    });
    expect(out.status).toBe('BLOCKED_SUPPLIER_IDENTITY');
    expect(out.ready).toBe(false);
  });

  it('bloque si le supplier_product_id n’est pas univoque', async () => {
    const db = dbWith(sku(), ['100', '200']);
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db, productSkuId: 'sku-1', procurementRoute: hubRoute(),
      adapters: { aliexpress: ali },
    });
    expect(out.status).toBe('BLOCKED_SUPPLIER_IDENTITY');
  });

  it('retourne OUT_OF_STOCK si le refresh exact échoue sur le stock', async () => {
    const db = dbWith(sku());
    const context = {
      aliexpressConnected: { fetchProducts: jest.fn(async () => ({ products: [{}] })) },
      aliexpressPreflight: {
        resolveOrderableUnit: jest.fn(() => { throw new Error('stock insuffisant'); }),
        classifyApiError: jest.fn(() => 'inventory'),
      },
    };
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db, productSkuId: 'sku-1', quantity: 2, procurementRoute: hubRoute(),
      adapters: { aliexpress: ali }, context,
    });
    expect(out.status).toBe('OUT_OF_STOCK');
    expect(out.ready).toBe(false);
  });

  it('retourne NOT_SHIPPABLE sans option de fret vers le hub', async () => {
    const db = dbWith(sku());
    const context = {
      aliexpressConnected: {
        fetchProducts: jest.fn(async () => ({ products: [{}] })),
        invokeTop: jest.fn(async () => ({ result: { success: false } })),
      },
      aliexpressPreflight: {
        METHODS: { FREIGHT: 'freight' },
        resolveOrderableUnit: jest.fn(() => ({ stock_available: 9, unit_price: 4.2, currency: 'USD' })),
        buildFreightBusinessParams: jest.fn(() => ({ p: 'x' })),
        summarizeFreightResponse: jest.fn(() => ({ success: false, has_options: false, error: null })),
        classifyApiError: jest.fn(() => 'other'),
      },
    };
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db, productSkuId: 'sku-1', procurementRoute: hubRoute(),
      adapters: { aliexpress: ali }, context,
    });
    expect(out.status).toBe('NOT_SHIPPABLE');
  });

  it('devient FULFILLMENT_READY vers le hub sans jamais appeler placeOrder', async () => {
    const db = dbWith(sku());
    const invokeTop = jest.fn(async () => ({ ok: true }));
    const buildFreightBusinessParams = jest.fn(() => ({ p: 'x' }));
    const context = {
      aliexpressConnected: {
        fetchProducts: jest.fn(async () => ({ products: [{}] })),
        invokeTop,
      },
      aliexpressPreflight: {
        METHODS: { FREIGHT: 'freight' },
        resolveOrderableUnit: jest.fn(() => ({ stock_available: 9, unit_price: 4.2, currency: 'USD' })),
        buildFreightBusinessParams,
        summarizeFreightResponse: jest.fn(() => ({ success: true, has_options: true, error: null })),
        classifyApiError: jest.fn(() => 'other'),
      },
    };
    const out = await readiness.evaluateSupplierFulfillmentReadiness({
      db, productSkuId: 'sku-1', quantity: 1, procurementRoute: hubRoute(),
      adapters: { aliexpress: ali }, context,
    });
    expect(out.status).toBe('FULFILLMENT_READY');
    expect(out.ready).toBe(true);
    expect(out.evidence.procurement_route_mode).toBe('PROCUREMENT_HUB');
    expect(out.evidence.procurement_hub_code).toBe('DXB');
    expect(out.evidence.procurement_hub_country_code).toBe('AE');
    expect(out.evidence.place_order_invoked).toBe(false);
    expect(out.evidence.payment_invoked).toBe(false);
    expect(buildFreightBusinessParams).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ country_code: 'AE' })
    );
    expect(invokeTop).toHaveBeenCalledTimes(1);
    expect(invokeTop.mock.calls[0][0]).toBe('freight');
  });
});
