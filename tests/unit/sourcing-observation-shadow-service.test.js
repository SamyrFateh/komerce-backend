'use strict';

jest.mock('../../db');
const db = require('../../db');
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
  beforeEach(() => jest.clearAllMocks());

  test('ecrit Source/Capture/Observations dans une transaction sans execution mode', async () => {
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
    expect(seen.some((s) => s.includes('INSERT INTO sourcing_sources'))).toBe(true);
    expect(seen.some((s) => s.includes('INSERT INTO sourcing_captures'))).toBe(true);
    expect(seen.some((s) => s.includes('INSERT INTO sourcing_observations'))).toBe(true);
    expect(seen.some((s) => s.includes('sourcing_source_execution_modes'))).toBe(false);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[client.query.mock.calls.length - 1][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('V1 ne cree aucune connexion DB', async () => {
    const out = await shadow.recordCatalogImportObservationsShadow({
      supplierName: 'Legacy', sourceType: 'manual', products: [{ product_name: 'x' }],
    });
    expect(out.status).toBe('skipped');
    expect(db.getClient).not.toHaveBeenCalled();
  });
});
