'use strict';

const contract = require('../../services/suppliers/supplier-fulfillment-adapter-contract');
const readiness = require('../../services/suppliers/supplier-fulfillment-readiness');
const aliexpress = require('../../services/suppliers/aliexpress-fulfillment-adapter');

function dbWith(row) {
  return {
    query: jest.fn(async (sql) => {
      if (sql.includes('FROM product_skus')) return { rows: row ? [row] : [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
}

function supplierSku(provider, payload, overrides = {}) {
  return {
    id: 'sku-universal-1',
    product_id: 'product-universal-1',
    supplier_sku: 'BUSINESS-SKU-1',
    supplier_unit_ref: 'UNIT-42',
    supplier_order_identity: { provider, version: 1, payload },
    stock: 12,
    is_active: true,
    source: 'SUPPLIER',
    ...overrides,
  };
}

function hubRoute() {
  return {
    mode: 'PROCUREMENT_HUB',
    hub: { code: 'DXB', name: 'Hub Dubai', country_code: 'AE' },
  };
}

async function evaluateWith({ provider = 'variant-provider', payload = { variant_id: 'VAR-42' }, adapter }) {
  return readiness.evaluateSupplierFulfillmentReadiness({
    db: dbWith(supplierSku(provider, payload)),
    productSkuId: 'sku-universal-1',
    quantity: 2,
    procurementRoute: hubRoute(),
    adapters: { [provider]: adapter },
  });
}

describe('Supplier Fulfillment Adapter Contract', () => {
  test('AliExpress déclare le même contrat générique que tout autre fournisseur', () => {
    expect(contract.validateAdapter('aliexpress', aliexpress)).toEqual(expect.objectContaining({
      ok: true,
      provider: 'aliexpress',
      adapter: aliexpress,
    }));
  });

  test('un fournisseur à variant_id devient FULFILLMENT_READY sans concept AliExpress dans le moteur', async () => {
    const evaluate = jest.fn(async ({ identity, quantity, destination, procurementRoute, VERDICT, result }) => {
      expect(identity.payload).toEqual({ variant_id: 'VAR-42' });
      expect(identity.payload.sku_id).toBeUndefined();
      expect(identity.payload.sku_attr).toBeUndefined();
      expect(procurementRoute.mode).toBe('PROCUREMENT_HUB');
      expect(destination.country_code).toBe('AE');
      return result(VERDICT.READY, {
        provider: 'variant-provider',
        native_variant_id: identity.payload.variant_id,
        quantity,
        destination_country_code: destination.country_code,
        place_order_invoked: false,
        payment_invoked: false,
      });
    });
    const adapter = { provider: 'variant-provider', evaluate };

    const out = await evaluateWith({ adapter });

    expect(out.status).toBe('FULFILLMENT_READY');
    expect(out.ready).toBe(true);
    expect(out.evidence.native_variant_id).toBe('VAR-42');
    expect(out.evidence.procurement_route_mode).toBe('PROCUREMENT_HUB');
    expect(out.evidence.procurement_hub_country_code).toBe('AE');
    expect(out.evidence.place_order_invoked).toBe(false);
    expect(out.evidence.payment_invoked).toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  test('refuse un adapter dont le provider ne correspond pas à Supplier Order Identity', async () => {
    const evaluate = jest.fn();
    const out = await evaluateWith({
      adapter: { provider: 'other-provider', evaluate },
    });

    expect(out.status).toBe('SUPPLIER_UNAVAILABLE');
    expect(out.ready).toBe(false);
    expect(out.reason).toMatch(/provider mismatch/i);
    expect(evaluate).not.toHaveBeenCalled();
  });

  test('refuse tout statut fournisseur hors référentiel canonique', async () => {
    const out = await evaluateWith({
      adapter: {
        provider: 'variant-provider',
        evaluate: jest.fn(async () => ({
          ready: false,
          status: 'VARIANT_PROVIDER_SPECIAL_STATUS',
          reason: null,
          evidence: {},
        })),
      },
    });

    expect(out.status).toBe('PREFLIGHT_FAILED');
    expect(out.ready).toBe(false);
    expect(out.reason).toMatch(/statut fulfillment non canonique/i);
  });

  test('refuse un adapter qui déclare ready=true avec un statut de blocage', async () => {
    const out = await evaluateWith({
      adapter: {
        provider: 'variant-provider',
        evaluate: jest.fn(async () => ({
          ready: true,
          status: 'OUT_OF_STOCK',
          reason: 'contradiction volontaire',
          evidence: {},
        })),
      },
    });

    expect(out.status).toBe('PREFLIGHT_FAILED');
    expect(out.ready).toBe(false);
    expect(out.reason).toMatch(/incohérence fulfillment/i);
  });

  test('normalise une exception inattendue d’adapter en PREFLIGHT_FAILED', async () => {
    const out = await evaluateWith({
      adapter: {
        provider: 'variant-provider',
        evaluate: jest.fn(async () => { throw new Error('provider exploded'); }),
      },
    });

    expect(out.status).toBe('PREFLIGHT_FAILED');
    expect(out.ready).toBe(false);
    expect(out.reason).toMatch(/erreur non normalisée.*provider exploded/i);
  });
});
