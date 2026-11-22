'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief M03: manual Central Hub physical receipt identity must come only from immutable Purchasing proof.
 */
const { snapshotFromConfirmedCentralHubExecution } = require('../../services/hub-physical-identity');

const ROW = Object.freeze({
  purchase_order_id: 'b98d5cef-6ad1-42d8-8964-74a0654040f1',
  purchase_line_id: '110aeb40-6e72-42e1-a184-07a329825791',
  po_status: 'confirmed',
  order_id: '93c7c6d6-63a6-4116-a280-79edb53ae42a',
  order_item_id: '751e9afa-3c6e-4fd7-b6ed-2cd6b16e07c5',
  item_order_id: '93c7c6d6-63a6-4116-a280-79edb53ae42a',
  item_sku_id: 'c3244624-49c9-4422-89e6-894e0faf5478',
  product_sku_id: 'c3244624-49c9-4422-89e6-894e0faf5478',
  supplier_id: 'd884202d-6640-49e0-9627-c802fa62201a',
  supplier_unit_ref: null,
  supplier_order_identity: null,
  quantity: 2,
  market_id: '10b3b83f-23f8-443a-953d-f93b0e2d405c',
  relais_id: 'd4a94b39-d166-4a97-95e8-10665e69b63c',
});

const PROOF = Object.freeze({
  system_key: 'central_hub',
  trigger_mode: 'manual',
  po_status: 'confirmed',
  confirmed_quantity: 2,
  confirmed_unit_price: '10.0000',
  confirmed_currency: 'EUR',
  confirmed_at: '2026-11-22T08:30:00Z',
  supplier_unit_ref: null,
  supplier_order_identity: null,
});

const EXECUTIONS = [
  {
    id: '4343748c-3513-4d95-8fda-8f5845b8abe2',
    quantity: 1,
    amount: '10.0000',
    currency: 'EUR',
    seller_supplier_id: null,
    seller_label: 'SIMULATED-STAGING-SELLER-A',
    proof_ref: 'SIM-STAGING-PROOF-A',
  },
  {
    id: '501e70e6-1c7d-4ab9-a2b0-787383e1e830',
    quantity: 1,
    amount: '10.0000',
    currency: 'EUR',
    seller_supplier_id: null,
    seller_label: 'SIMULATED-STAGING-SELLER-B',
    proof_ref: 'SIM-STAGING-PROOF-B',
  },
];

function mockDb(header = PROOF, evidence = EXECUTIONS) {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: header ? [header] : [] })
    .mockResolvedValueOnce({ rows: evidence });
  return { query };
}

describe('M03 — identity from Purchasing manual execution evidence (no invented supplier SKU)', () => {
  it('receives a Central Hub confirmed manual PO only with complete exact immutable evidence', async () => {
    const db = mockDb();
    const result = await snapshotFromConfirmedCentralHubExecution(db, ROW);
    expect(result).toMatchObject({
      purchase_order_id: ROW.purchase_order_id,
      purchase_line_id: ROW.purchase_line_id,
      product_sku_id: ROW.product_sku_id,
      supplier_id: ROW.supplier_id,
      quantity: 2,
      destination_ref: 'relais:' + ROW.relais_id,
      supplier_unit_ref: 'INTERNAL-MANUAL-PURCHASE:' + ROW.purchase_line_id,
      supplier_order_identity: {
        provider: 'komerce_manual_purchase_evidence',
        version: 1,
        payload: {
          purchase_order_id: ROW.purchase_order_id,
          purchase_line_id: ROW.purchase_line_id,
          execution_ids: EXECUTIONS.map(e => e.id),
        },
      },
    });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  });

  it('does not rewrite a normal real supplier identity or query manual evidence', async () => {
    const db = { query: jest.fn() };
    const supplierOrderIdentity = { provider: 'noon', version: 1, payload: { sku: 'R1' } };
    const result = await snapshotFromConfirmedCentralHubExecution(db, {
      ...ROW, supplier_unit_ref: 'REAL-SKU-R1', supplier_order_identity: supplierOrderIdentity,
    });
    expect(result.supplier_unit_ref).toBe('REAL-SKU-R1');
    expect(result.supplier_order_identity).toEqual(supplierOrderIdentity);
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each([
    ['not central Hub', { system_key: null }, EXECUTIONS],
    ['supplier API', { trigger_mode: 'auto' }, EXECUTIONS],
    ['not confirmed', { po_status: 'notified' }, EXECUTIONS],
    ['no date', { confirmed_at: null }, EXECUTIONS],
    ['no confirmed currency', { confirmed_currency: null }, EXECUTIONS],
    ['quantity mismatch', { confirmed_quantity: 1 }, EXECUTIONS],
    ['zero confirmed purchase price', { confirmed_unit_price: '0' }, EXECUTIONS],
    ['half seller evidence', {}, [EXECUTIONS[0]]],
    ['currency mismatch', {}, [{ ...EXECUTIONS[0], quantity: 2, amount: '20.0000', currency: 'KMF' }]],
    ['price mismatch', {}, [{ ...EXECUTIONS[0], quantity: 2, amount: '19.0000' }]],
    ['no actual seller', {}, [{ ...EXECUTIONS[0], quantity: 2, amount: '20.0000', seller_label: '' }]],
    ['missing receipt proof', {}, [{ ...EXECUTIONS[0], quantity: 2, amount: '20.0000', proof_ref: '' }]],
    ['no executions', {}, []],
  ])('refuses %s with no allocation', async (_name, overrides, evidence) => {
    const db = mockDb({ ...PROOF, ...overrides }, evidence);
    await expect(snapshotFromConfirmedCentralHubExecution(db, ROW)).rejects.toMatchObject({
      code: 'HUB_SUPPLIER_IDENTITY_UNRESOLVABLE',
    });
  });

  it('never turns partial supplier identity into a manual proof', async () => {
    const db = { query: jest.fn() };
    await expect(snapshotFromConfirmedCentralHubExecution(db, {
      ...ROW, supplier_unit_ref: 'SKULABEL', supplier_order_identity: null,
    })).rejects.toMatchObject({ code: 'HUB_SUPPLIER_IDENTITY_UNRESOLVABLE' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects absent order/line identity before looking for evidence', async () => {
    const db = { query: jest.fn() };
    await expect(snapshotFromConfirmedCentralHubExecution(db, {
      ...ROW, purchase_line_id: null,
    })).rejects.toMatchObject({ code: 'HUB_SUPPLIER_IDENTITY_UNRESOLVABLE' });
    expect(db.query).not.toHaveBeenCalled();
  });
});
