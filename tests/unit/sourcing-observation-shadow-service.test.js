'use strict';

jest.mock('../../db');
jest.mock('../../services/sourcing-shadow-resolution-service');

const db = require('../../db');
const shadowResolution = require('../../services/sourcing-shadow-resolution-service');
const shadow = require('../../services/sourcing-observation-shadow-service');

function product() {
  return {
    schema_version: '2', supplier_name: 'CJ', supplier_product_id: 'P-1', product_name: 'Test',
    purchase_price: 10, currency: 'USD', stock_available: 2,
    sellable_units: [{ supplier_sku: 'S-1', supplier_unit_ref: 'V-1', option_values: {}, stock_available: 2 }],
    raw_payload: { pid: 'P-1' },
  };
}

describe('sourcing shadow observation persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shadowResolution.resolveCaptureShadow.mockResolvedValue({
      status: 'resolved', observations: 3, new_canonical: 3, linked: 0, review_required: 0,
    });
  });

  test('ecrit Source/Capture/Observations puis lance Resolution apres le COMMIT', async () => {
    const seen = [];
    const client = {
      query: jest.fn(async (sql, params) => { seen.push(String(sql)); return { rows: [], params }; }),
      release: jest.fn(),
    };
    db.getClient.mockResolvedValue(client);

    const out = await shadow.recordCatalogImportObservationsShadow({
      importId: 'import-1', supplierName: 'CJdropshipping', supplierId: 'cj', sourceType: 'api',
      sourceFilename: 'cj/page-1.json', products: [product()],
    });

    expect(out.status).toBe('recorded');
    expect([out.products, out.offers, out.units, out.observations]).toEqual([1, 1, 1, 3]);
    expect(out.resolution.status).toBe('resolved');
    expect(seen.some((s) => s.includes('INSERT INTO sourcing_sources'))).toBe(true);
    expect(seen.some((s) => s.includes('INSERT INTO sourcing_captures'))).toBe(true);
    expect(seen.some((s) => s.includes('INSERT INTO sourcing_observations'))).toBe(true);
    expect(seen.some((s) => s.includes('sourcing_source_execution_modes'))).toBe(false);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[client.query.mock.calls.length - 1][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(shadowResolution.resolveCaptureShadow).toHaveBeenCalledTimes(1);
    expect(shadowResolution.resolveCaptureShadow).toHaveBeenCalledWith(out.capture_id);
  });

  test('un echec Resolution reste non bloquant apres la persistance des Observations', async () => {
    const client = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() };
    db.getClient.mockResolvedValue(client);
    const error = new Error('resolver unavailable');
    error.code = 'RESOLVER_TEST_FAILURE';
    shadowResolution.resolveCaptureShadow.mockRejectedValue(error);

    const out = await shadow.recordCatalogImportObservationsShadow({
      importId: 'import-2', supplierName: 'CJdropshipping', supplierId: 'cj', sourceType: 'api',
      products: [product()],
    });

    expect(out.status).toBe('recorded');
    expect(out.resolution).toEqual({ status: 'failed', code: 'RESOLVER_TEST_FAILURE' });
    expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(false);
  });

  test('V1 ne cree aucune connexion DB ni Resolution', async () => {
    const out = await shadow.recordCatalogImportObservationsShadow({
      supplierName: 'Legacy', sourceType: 'manual', products: [{ product_name: 'x' }],
    });
    expect(out.status).toBe('skipped');
    expect(db.getClient).not.toHaveBeenCalled();
    expect(shadowResolution.resolveCaptureShadow).not.toHaveBeenCalled();
  });
});
