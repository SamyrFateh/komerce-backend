'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn() }));
const { listReceivable, project, receptionState, RECEIVABLE_SQL } = require('../../services/hub-receivable');

describe('hub-receivable — lecture minimale pour la réception', () => {
  test('états de réception', () => {
    expect(receptionState(5, 0)).toBe('NOT_RECEIVED');
    expect(receptionState(5, 2)).toBe('PARTIAL');
    expect(receptionState(5, 5)).toBe('COMPLETE');
  });

  test('projection : attendu, reçu, restant par ligne, regroupée par PO et fournisseur', () => {
    const [po] = project([
      { purchase_order_id: 'po1', shape: 'grouped', po_status: 'confirmed', supplier_id: 's1', supplier_name: 'CJ', supplier_order_ref: 'CJ-1', product_sku_id: 'sku1', product_name: 'Coque', expected_quantity: 5, received_quantity: 2 },
      { purchase_order_id: 'po1', shape: 'grouped', po_status: 'confirmed', supplier_id: 's1', supplier_name: 'CJ', supplier_order_ref: 'CJ-1', product_sku_id: 'sku2', product_name: 'Câble', expected_quantity: 1, received_quantity: 0 },
    ]);
    expect(po.supplier).toEqual({ id: 's1', name: 'CJ' });
    expect(po.lines).toEqual([
      expect.objectContaining({ product_sku_id: 'sku1', expected_quantity: 5, received_quantity: 2, remaining_quantity: 3, reception_state: 'PARTIAL' }),
      expect.objectContaining({ product_sku_id: 'sku2', remaining_quantity: 1, reception_state: 'NOT_RECEIVED' }),
    ]);
  });

  test('SQL : brouillons, annulées et soldées exclus ; aucun prix, coût ni credential ; lecture seule', () => {
    expect(RECEIVABLE_SQL).toContain("NOT IN ('draft', 'cancelled')");
    expect(RECEIVABLE_SQL).toContain('HAVING SUM(v.effective_quantity) > SUM(v.received_quantity)');
    expect(RECEIVABLE_SQL).not.toMatch(/price|cost|api_key|secret|credential|password/i);
    expect(RECEIVABLE_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  test('le statut fournisseur est informatif : il ne filtre ni ne déclenche (SHIPPED n’est pas une réception)', async () => {
    const exec = { query: jest.fn().mockResolvedValue({ rows: [{ purchase_order_id: 'po1', shape: 'grouped', po_status: 'shipped', supplier_id: null, supplier_name: null, supplier_order_ref: null, product_sku_id: 'sku', product_name: 'X', expected_quantity: 1, received_quantity: 0 }] }) };
    const result = await listReceivable(exec);
    expect(result.purchase_orders[0]).toEqual(expect.objectContaining({ po_status: 'shipped' }));
    expect(result.purchase_orders[0].lines[0].reception_state).toBe('NOT_RECEIVED');
    expect(exec.query).toHaveBeenCalledTimes(1);
  });
});
