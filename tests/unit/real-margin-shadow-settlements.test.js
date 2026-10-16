'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Coût d'achat réel (règlements KMF) dans le shadow : taux effectif calculé,
 * ventilation prorata sans perte, remboursements typés, conditions de preuve.
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
const { computePurchaseReal } = require('../../services/cost-allocation/real-margin-shadow');

const line = (id, qty, price, extra = {}) => ({
  id, purchase_order_id: 'po1', confirmed_at: 't', confirmed_quantity: qty, confirmed_unit_price: price,
  supplier_currency: 'USD', in_order: true, ...extra,
});
const pay = (extra = {}) => ({ id: 'p1', purchase_order_id: 'po1', status: 'succeeded', real_debit_verified: true, reconciliation_status: 'matched', currency: 'USD', ...extra });
const st = (kind, c, k, fees = '0.00', extra = {}) => ({
  supplier_execution_payment_id: 'p1', kind, amount_currency: c, currency: 'USD', amount_kmf: k, fees_kmf: fees, ...extra,
});

describe('computePurchaseReal', () => {
  it('2 paiements partiels à 2 taux : taux effectif exact, frais à part', () => {
    const r = computePurchaseReal({
      lines: [line('l1', 2, '50.0000')], payments: [pay()],
      settlements: [st('payment', '40.0000', '16000.00', '100.00'), st('payment', '60.0000', '25200.00', '50.00')],
    });
    expect(r.complete).toBe(true);
    expect(r.real_kmf).toBe(41200);
    expect(r.paid).toEqual({ amount_currency: 100, currency: 'USD', amount_kmf: 41200 });
    expect(r.effective_fx_rate).toBe(412);
    expect(r.fees_kmf).toBe(150);
    expect(r.flags).toEqual([]);
  });

  it('goods_refund réduit l\'achat ; fee_refund réduit les frais ; other_refund sans effet', () => {
    const r = computePurchaseReal({
      lines: [line('l1', 1, '90.0000')], payments: [pay()],
      settlements: [
        st('payment', '100.0000', '40000.00', '200.00'), st('goods_refund', '10.0000', '4000.00'),
        st('fee_refund', '1.0000', '50.00'), st('other_refund', '3.0000', '999.00'),
      ],
    });
    expect(r.complete).toBe(true);
    expect(r.real_kmf).toBe(36000);
    expect(r.refunds_goods_kmf).toBe(4000);
    expect(r.fees_kmf).toBe(150);
  });

  it('PO regroupée sur 2 commandes : prorata sans perte (1000.01 sur 3 lignes égales)', () => {
    const mk = (id, inOrder) => line(id, 1, '10.0000', { in_order: inOrder });
    const lines = [mk('a', true), mk('b', false), mk('c', false)];
    const settlements = [st('payment', '30.0000', '1000.01', '0.01')];
    const mine = computePurchaseReal({ lines, payments: [pay()], settlements });
    const others = lines.map((l) => ({ ...l, in_order: !l.in_order }));
    const rest = computePurchaseReal({ lines: others, payments: [pay()], settlements });
    const cents = (x) => Math.round(x * 100);
    expect(cents(mine.real_kmf) + cents(rest.real_kmf)).toBe(100001);
    // 100001 centimes / 3 : parts 33334, 33334, 33333 (plus grand reste, id ordonné)
    expect(cents(mine.real_kmf)).toBe(33334);
    expect(cents(mine.fees_kmf) + cents(rest.fees_kmf)).toBe(1);
  });

  it('provisional : paiement non vérifié / non matched / absent / règlement absent', () => {
    const L = [line('l1', 1, '10.0000')];
    const S = [st('payment', '10.0000', '4000.00')];
    expect(computePurchaseReal({ lines: L, payments: [pay({ real_debit_verified: false })], settlements: S }).flags).toContain('payment_not_verified_matched');
    expect(computePurchaseReal({ lines: L, payments: [pay({ reconciliation_status: 'pending' })], settlements: S }).real_kmf).toBeNull();
    expect(computePurchaseReal({ lines: L, payments: [], settlements: [] }).flags).toContain('no_supplier_payment');
    const none = computePurchaseReal({ lines: L, payments: [pay()], settlements: [] });
    expect(none.flags).toContain('no_settlement_recorded');
    expect(none.effective_fx_rate).toBeNull();
    expect(none.real_kmf).toBeNull();
  });

  it('underpaid / overpaid / ligne non confirmée / ligne sans PO / devise incohérente -> pas de réel', () => {
    const L = [line('l1', 1, '10.0000')];
    expect(computePurchaseReal({ lines: L, payments: [pay()], settlements: [st('payment', '9.9900', '1.00')] }).flags).toContain('underpaid');
    expect(computePurchaseReal({ lines: L, payments: [pay()], settlements: [st('payment', '10.0100', '1.00')] }).flags).toContain('overpaid');
    expect(computePurchaseReal({ lines: [line('l1', 1, '10.0000', { confirmed_at: null })], payments: [pay()], settlements: [st('payment', '10.0000', '1')] }).flags).toContain('unconfirmed_lines');
    expect(computePurchaseReal({ lines: [line('l1', 1, '10.0000', { purchase_order_id: null })], payments: [], settlements: [] }).flags).toContain('line_without_purchase_order');
    expect(computePurchaseReal({ lines: L, payments: [pay()], settlements: [st('payment', '10.0000', '1', '0', { currency: 'EUR' })] }).flags).toContain('currency_mismatch');
    // ligne non confirmée d'une AUTRE commande dans la même PO
    const co = [line('l1', 1, '10.0000'), line('l2', 1, '10.0000', { in_order: false, confirmed_at: null })];
    expect(computePurchaseReal({ lines: co, payments: [pay()], settlements: [st('payment', '10.0000', '1')] }).flags).toContain('po_has_unconfirmed_lines');
  });

  it('deux PO en devises différentes : réel complet, devise MIXED, pas de taux unique', () => {
    const lines = [line('l1', 1, '10.0000'), line('l2', 1, '20.0000', { purchase_order_id: 'po2', supplier_currency: 'AED' })];
    const payments = [pay(), pay({ id: 'p2', purchase_order_id: 'po2', currency: 'AED' })];
    const settlements = [st('payment', '10.0000', '4000.00'), st('payment', '20.0000', '2500.00', '0', { supplier_execution_payment_id: 'p2', currency: 'AED' })];
    const r = computePurchaseReal({ lines, payments, settlements });
    expect(r.complete).toBe(true);
    expect(r.real_kmf).toBe(6500);
    expect(r.paid).toEqual({ amount_currency: null, currency: 'MIXED', amount_kmf: 6500 });
    expect(r.effective_fx_rate).toBeNull();
  });

  it('commande sans ligne d\'achat : rien d\'inventé', () => {
    const r = computePurchaseReal({ lines: [], payments: [], settlements: [] });
    expect(r).toMatchObject({ complete: false, real_kmf: null, effective_fx_rate: null });
  });
});
