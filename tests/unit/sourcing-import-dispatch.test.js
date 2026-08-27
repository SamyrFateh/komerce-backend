'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockCsvFetch = jest.fn();
const mockManualFetch = jest.fn();

jest.mock('../../services/suppliers/connectors/csv-connector', () => ({
  fetchProducts: (...args) => mockCsvFetch(...args),
}));

jest.mock('../../services/suppliers/connectors/manual-connector', () => ({
  fetchProducts: (...args) => mockManualFetch(...args),
}));

jest.mock('../../services/suppliers/connectors/noon-connector', () => ({
  IS_ACTIVE: false,
  INACTIVE_REASON: 'Noon disabled in test',
}));

const { connectorCatalog, dispatchToConnector } = require('../../services/sourcing-import-dispatch');

describe('sourcing-import-dispatch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('délègue la source manual par défaut sans réinterpréter le payload', async () => {
    const expected = [{ supplier_sku: 'SKU-1' }];
    mockManualFetch.mockResolvedValue(expected);

    await expect(dispatchToConnector({ supplier_name: 'ACME', items: [{ sku: 'SKU-1' }] }))
      .resolves.toBe(expected);

    expect(mockManualFetch).toHaveBeenCalledWith({
      supplier_name: 'ACME',
      items: [{ sku: 'SKU-1' }],
    });
    expect(mockCsvFetch).not.toHaveBeenCalled();
  });

  it('délègue CSV au connecteur CSV avec le mapping fourni', async () => {
    mockCsvFetch.mockResolvedValue([]);
    await dispatchToConnector({
      source_type: 'csv',
      supplier_name: 'CSV Supplier',
      csv_text: 'sku,name\n1,Test',
      csv_mapping: { sku: 'sku', name: 'name' },
    });

    expect(mockCsvFetch).toHaveBeenCalledWith({
      supplier_name: 'CSV Supplier',
      csv_text: 'sku,name\n1,Test',
      csv_mapping: { sku: 'sku', name: 'name' },
    });
  });

  it('refuse explicitement une API fournisseur inactive', async () => {
    await expect(dispatchToConnector({ source_type: 'api', supplier_id: 'NOON' }))
      .rejects.toThrow('Noon disabled in test');

    expect(connectorCatalog().api_suppliers).toEqual([
      expect.objectContaining({ supplier: 'noon', active: false, reason: 'Noon disabled in test' }),
    ]);
  });
});
