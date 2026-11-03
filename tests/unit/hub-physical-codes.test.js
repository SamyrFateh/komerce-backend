'use strict';

const {
  PhysicalCodeError, normalizeCode, resolvePhysicalCode, confirmPhysicalCode,
} = require('../../services/hub-physical-codes');

const PO = '11111111-1111-4111-8111-111111111111';
const SUPPLIER = '22222222-2222-4222-8222-222222222222';
const SKU = '33333333-3333-4333-8333-333333333333';
const OTHER_SKU = '44444444-4444-4444-8444-444444444444';
const ACTOR = '55555555-5555-4555-8555-555555555555';

function fakeDb({ codes = [], expected = true, poStatus = 'notified' } = {}) {
  return {
    query: jest.fn(async (sql, args = []) => {
      if (sql.startsWith('SELECT id, supplier_id, status FROM purchase_orders')) {
        return { rows: [{ id: PO, supplier_id: SUPPLIER, status: poStatus }] };
      }
      if (sql.startsWith('SELECT 1 FROM purchase_lines')) {
        return { rows: expected ? [{ '?column?': 1 }] : [] };
      }
      if (sql.startsWith('SELECT id, product_sku_id, supplier_id, code, code_type')) {
        return { rows: codes };
      }
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [{}] };
      if (sql.startsWith('INSERT INTO product_sku_physical_codes')) {
        return { rows: [{ id: '66666666-6666-4666-8666-666666666666', trust: 'CONFIRMED' }] };
      }
      if (sql.startsWith('UPDATE product_sku_physical_codes')) {
        return { rows: [{ id: '77777777-7777-4777-8777-777777777777', trust: 'CONFIRMED' }] };
      }
      throw new Error('Unexpected SQL: ' + sql.slice(0, 100) + ' ' + JSON.stringify(args));
    }),
  };
}

const physicalCode = (sku = SKU, trust = 'CONFIRMED') => ({
  id: '77777777-7777-4777-8777-777777777777',
  product_sku_id: sku,
  supplier_id: SUPPLIER,
  code: '0012345678905',
  code_type: 'SUPPLIER_BARCODE',
  trust,
});

describe('Hub V1 — physical barcode identifies a SKU, never a customer', () => {
  test('EAN retains leading zero and rejects empty or control characters', () => {
    expect(normalizeCode(' 0012345678905 ')).toBe('0012345678905');
    expect(() => normalizeCode('\n')).toThrow(PhysicalCodeError);
    expect(() => normalizeCode('A\nB')).toThrow(PhysicalCodeError);
  });

  test('same EAN may serve many units/customers; lookup returns only exact product SKU', async () => {
    const q = fakeDb({ codes: [physicalCode()] });
    const found = await resolvePhysicalCode(q, { purchaseOrderId: PO, code: '0012345678905' });
    expect(found).toEqual({
      code: '0012345678905',
      product_sku_id: SKU,
      purchase_order_id: PO,
      confirmed: true,
      physical_confirmation_required: false,
    });
    expect(found).not.toHaveProperty('order_id');
    expect(found).not.toHaveProperty('unit_id');
  });

  test('a supplier-declared code is not yet a confirmed physical observation', async () => {
    const found = await resolvePhysicalCode(fakeDb({ codes: [physicalCode(SKU, 'DECLARED')] }),
      { purchaseOrderId: PO, code: '0012345678905' });
    expect(found.confirmed).toBe(false);
    expect(found.physical_confirmation_required).toBe(true);
  });

  test('unknown and ambiguous codes fail closed', async () => {
    await expect(resolvePhysicalCode(fakeDb(), { purchaseOrderId: PO, code: '123' }))
      .rejects.toMatchObject({ status: 404, code: 'HUB_PHYSICAL_CODE_UNKNOWN' });
    await expect(resolvePhysicalCode(fakeDb({ codes: [physicalCode(), physicalCode(OTHER_SKU)] }),
      { purchaseOrderId: PO, code: '0012345678905' }))
      .rejects.toMatchObject({ status: 409, code: 'HUB_PHYSICAL_CODE_AMBIGUOUS' });
  });

  test('even a known barcode cannot be used on a PO lacking that SKU', async () => {
    await expect(resolvePhysicalCode(fakeDb({ codes: [physicalCode()], expected: false }),
      { purchaseOrderId: PO, code: '0012345678905' }))
      .rejects.toMatchObject({ status: 409, code: 'HUB_PHYSICAL_SKU_NOT_ON_PO' });
  });

  test('physical confirmation requires verifiable PO SKU, actor and proof ref', async () => {
    const q = fakeDb();
    await expect(confirmPhysicalCode(q, {
      purchaseOrderId: PO, productSkuId: SKU, code: '0012345678905',
      codeType: 'SUPPLIER_BARCODE', actorId: ACTOR,
    })).rejects.toMatchObject({ status: 400, code: 'HUB_PHYSICAL_PROOF_REQUIRED' });
    const saved = await confirmPhysicalCode(q, {
      purchaseOrderId: PO, productSkuId: SKU, code: '0012345678905',
      codeType: 'SUPPLIER_BARCODE', actorId: ACTOR, proofRef: 'visuel-boite-constate',
    });
    expect(saved).toMatchObject({ product_sku_id: SKU, trust: 'CONFIRMED' });
    expect(q.query.mock.calls.some(([sql]) => sql.startsWith('SELECT pg_advisory_xact_lock'))).toBe(true);
  });

  test('a code previously mapped to a different SKU is rejected without rewrite', async () => {
    const q = fakeDb({ codes: [physicalCode(OTHER_SKU)] });
    await expect(confirmPhysicalCode(q, {
      purchaseOrderId: PO, productSkuId: SKU, code: '0012345678905',
      codeType: 'SUPPLIER_BARCODE', actorId: ACTOR, proofRef: 'lecture-etiquette',
    })).rejects.toMatchObject({ status: 409, code: 'HUB_PHYSICAL_CODE_AMBIGUOUS' });
    expect(q.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO product_sku_physical_codes'))).toBe(false);
  });
});
