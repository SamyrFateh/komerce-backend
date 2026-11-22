'use strict';
const { deriveIndicativeBudget, loadIndicativeBudget } = require('../../scripts/recette/canonical/g6-manual-hub-staging-budget');

const candidate = (changes={}) => ({
  candidate_ref: 'SC-G6-001', purchase_price: '10.00', currency: 'EUR',
  source_kind: 'central_hub_manual', system_key: 'central_hub',
  sourcing_supplier_id: 'hub-supplier', po_supplier_id: 'hub-supplier',
  sourcing_product_id: 'hub-product', order_product_id: 'hub-product',
  simulation_scope: 'G6-BUYER', product_name: '[G6-HUB] Screwdriver set KM',
  product_ref: 'KPR-000255', supplier_unit_price: null, supplier_currency: null,
  quantity: 2, ...changes,
});

describe('G6 M03 sourcing budget is indicative, read-only and identity-bound', () => {
  test('derives a traceable simulated engagement budget, never a confirmed price', () => {
    expect(deriveIndicativeBudget([candidate()])).toEqual({
      amount: 20, currency: 'EUR', candidate_ref: 'SC-G6-001',
      product_ref: 'KPR-000255', unit_amount: 10, quantity: 2,
      provenance: 'SOURCING_CANDIDATE_INDICATIVE_STAGING',
      confirmed_supplier_price: false, supplier_payment_authorized: false,
    });
  });
  test.each([
    [[]],
    [[candidate(), candidate({ candidate_ref:'SC-G6-002' })]],
  ])('fails closed if sourcing is absent or ambiguous', rows => {
    expect(() => deriveIndicativeBudget(rows)).toThrow('G6_COMMITMENT_INDICATIVE_SOURCE_MISSING_OR_AMBIGUOUS');
  });
  test.each([
    { source_kind: 'manual' }, { system_key: 'seller_real' },
    { sourcing_supplier_id: 'unrelated' }, { sourcing_product_id: 'other' },
    { simulation_scope: null }, { product_name: 'Real customer goods' },
    { candidate_ref: null }, { product_ref: null },
  ])('rejects supplier/product/simulation identity mismatch: %p', delta => {
    expect(() => deriveIndicativeBudget([candidate(delta)])).toThrow('G6_COMMITMENT_INDICATIVE_SOURCE_IDENTITY_MISMATCH');
  });
  test.each([
    { purchase_price: null }, { purchase_price: -1 }, { currency: '???' },
    { quantity: 0 }, { quantity: 1.5 }, { purchase_price: 'NaN' },
  ])('rejects unusable indicative money: %p', delta => {
    expect(() => deriveIndicativeBudget([candidate(delta)])).toThrow('G6_COMMITMENT_INDICATIVE_SOURCE_INVALID_MONEY');
  });
  test.each([
    { supplier_unit_price: '12.00' }, { supplier_currency: 'EUR' },
  ])('never replaces a confirmed supplier price: %p', delta => {
    expect(() => deriveIndicativeBudget([candidate(delta)])).toThrow('G6_COMMITMENT_INDICATIVE_SOURCE_NOT_REQUIRED');
  });
  test('loads one exact PO/order candidate with SELECT only', async () => {
    const query = jest.fn(async (sql,args) => {
      expect(/^\s*SELECT\s/i.test(sql)).toBe(true);
      expect(sql).toContain('sc.product_id=p.id AND sc.supplier_id=s.id');
      expect(sql).toContain('po.id=$1 AND o.id=$2');
      expect(args).toEqual(['po-one','order-one']);
      return { rows: [candidate()] };
    });
    const budget = await loadIndicativeBudget({ query }, 'po-one', 'order-one');
    expect(budget.amount).toBe(20);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
