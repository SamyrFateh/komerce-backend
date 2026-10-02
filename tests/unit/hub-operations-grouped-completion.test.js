'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
jest.mock('../../services/hub-physical-identity', () => {
  class HubPhysicalError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
  }
  return {
    HubPhysicalError,
    createPhysicalUnit: jest.fn(),
    receiveSupplierPackage: jest.fn(),
    receiveSupplierPackageArrival: jest.fn(),
    reconcileSupplierPackageContents: jest.fn(),
    revalidateQuarantinedInbound: jest.fn(),
    transitionPhysicalUnit: jest.fn(),
    moveAllocationQuantity: jest.fn(),
    recordPhysicalUnitOutcome: jest.fn(),
  };
});
const mockComplete = jest.fn().mockResolvedValue([]);
jest.mock('../../services/purchasing-completion-service', () => ({ completeOrdersAfterHubReceipt: (...a) => mockComplete(...a) }));

const db = require('../../db');
const hubPhysical = require('../../services/hub-physical-identity');
const hubOps = require('../../services/hub-operations');

const PO1 = '00000000-0000-0000-0000-000000000301';
const U1 = '00000000-0000-0000-0000-000000000101';
const I1 = '00000000-0000-0000-0000-000000000401';
const allocations = [{ allocation: { order_id: 'o1', purchase_line_id: 'l1' }, quantity: 2 }];

beforeEach(() => {
  jest.clearAllMocks();
  db.withTransaction.mockImplementation(async (work) => work({ query: jest.fn() }));
});

describe('PR 7 — complétude d\'achat après COMMIT des réceptions Hub', () => {
  test('réception avec contenu : complétude déclenchée avec les allocations et l\'acteur', async () => {
    hubPhysical.receiveSupplierPackage.mockResolvedValue({ quarantined: false, allocations });
    const result = await hubOps.receiveSupplierPackageCommand({ contents: [{ purchase_order_id: PO1, quantity: 2 }] }, 'agent-1');
    expect(result.status).toBe(201);
    expect(mockComplete).toHaveBeenCalledWith(allocations, { actor: { id: 'agent-1' } });
  });

  test('réception mise en quarantaine : aucune complétude', async () => {
    hubPhysical.receiveSupplierPackage.mockResolvedValue({ quarantined: true, allocations: [] });
    const result = await hubOps.receiveSupplierPackageCommand({ contents: [{ purchase_order_id: PO1, quantity: 2 }] }, null);
    expect(result.status).toBe(202);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test('réconciliation à l\'ouverture : complétude déclenchée, sauf quarantaine', async () => {
    hubPhysical.reconcileSupplierPackageContents.mockResolvedValue({ quarantined: false, allocations });
    await hubOps.reconcileSupplierPackageCommand({ unit_id: U1, contents: [{ purchase_order_id: PO1, quantity: 2 }] }, 'agent-2');
    expect(mockComplete).toHaveBeenCalledWith(allocations, { actor: { id: 'agent-2' } });

    mockComplete.mockClear();
    hubPhysical.reconcileSupplierPackageContents.mockResolvedValue({ quarantined: true, allocations: [] });
    await hubOps.reconcileSupplierPackageCommand({ unit_id: U1, contents: [{ purchase_order_id: PO1, quantity: 2 }] }, null);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test('revalidation : complétude uniquement si l\'incident est résolu', async () => {
    hubPhysical.revalidateQuarantinedInbound.mockResolvedValue({ resolved: true, allocations });
    const ok = await hubOps.revalidateQuarantineCommand({ unit_id: U1, incident_id: I1 }, 'agent-3');
    expect(ok.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledWith(allocations, { actor: { id: 'agent-3' } });

    mockComplete.mockClear();
    hubPhysical.revalidateQuarantinedInbound.mockResolvedValue({ resolved: false, reason: 'still wrong' });
    const ko = await hubOps.revalidateQuarantineCommand({ unit_id: U1, incident_id: I1 }, null);
    expect(ko.status).toBe(409);
    expect(mockComplete).not.toHaveBeenCalled();
  });
});
