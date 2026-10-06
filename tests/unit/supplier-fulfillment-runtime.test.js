'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockPersist = jest.fn();
const mockCj = jest.fn();
const mockAli = jest.fn();
const mockAllegro = jest.fn();

jest.mock('../../services/suppliers/supplier-fulfillment-persistence', () => ({
  persistSupplierFulfillment: (...args) => mockPersist(...args),
}));
jest.mock('../../services/suppliers/cj-fulfillment-reader', () => ({
  readAndReconcile: (...args) => mockCj(...args),
}));
jest.mock('../../services/suppliers/aliexpress-fulfillment-reader', () => ({
  readAndReconcile: (...args) => mockAli(...args),
}));
jest.mock('../../services/suppliers/allegro-fulfillment-reader', () => ({
  readAndReconcile: (...args) => mockAllegro(...args),
}));

const runtime = require('../../services/suppliers/supplier-fulfillment-runtime');

function db(provider, supplierOrderId) {
  return {
    query: jest.fn(async () => ({
      rows: [{ id: 'exec-1', provider, supplier_order_id: supplierOrderId }],
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPersist.mockResolvedValue({ id: 'ful-1', reconciliation_status: 'matched' });
});

test.each([
  ['cj', mockCj, 'CJ-ORDER-1'],
  ['aliexpress', mockAli, '123456789'],
  ['allegro', mockAllegro, '11111111-1111-4111-8111-111111111111'],
])('routes %s through its reader then persists the canonical result', async (provider, reader, supplierOrderId) => {
  const reconciliation = {
    scope: 'FULFILLMENT',
    provider,
    verdict: 'MATCHED',
    expected: { quantity: 2 },
    observed: { quantity: 2, provider_status: 'SHIPPED' },
    evidence: { proof_source: 'provider', proof_ref: supplierOrderId },
    external_ref: supplierOrderId,
    reason: null,
  };
  reader.mockResolvedValue(reconciliation);

  const client = db(provider, supplierOrderId);
  const out = await runtime.reconcileAndPersistSupplierFulfillment(client, {
    supplierExecutionOrderId: 'exec-1',
    supplierUnitRef: 'UNIT-1',
    expectedQuantity: 2,
    context: { marker: provider },
  });

  expect(reader).toHaveBeenCalledTimes(1);
  expect(mockPersist).toHaveBeenCalledWith(client, {
    supplierExecutionOrderId: 'exec-1',
    supplierUnitRef: 'UNIT-1',
    reconciliationResult: reconciliation,
  });
  expect(out).toMatchObject({
    provider,
    supplier_execution_order_id: 'exec-1',
    supplier_order_id: supplierOrderId,
    supplier_unit_ref: 'UNIT-1',
    fulfillment: { id: 'ful-1' },
  });
});

test('fails closed for a provider without a fulfillment reader', async () => {
  await expect(runtime.reconcileAndPersistSupplierFulfillment(db('noon', 'N-1'), {
    supplierExecutionOrderId: 'exec-1',
    supplierUnitRef: 'UNIT-1',
    expectedQuantity: 1,
  })).rejects.toThrow('SUPPLIER_FULFILLMENT_READER_UNSUPPORTED:noon');

  expect(mockPersist).not.toHaveBeenCalled();
});
