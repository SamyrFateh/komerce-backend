'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Règlements fournisseur KMF : validation, refus explicites, idempotence, plafonds.
 * Client PostgreSQL simulé en mémoire (les preuves SQL réelles sont en intégration).
 */

const { recordSettlement, listSettlements } = require('../../services/supplier-payment-settlement-service');

const PAY = '11111111-1111-4111-8111-111111111111';

function fakeDb(pay = {}) {
  const payment = {
    id: PAY, purchase_order_id: 'po', currency: 'USD', status: 'succeeded', real_debit_verified: true,
    expected_amount: '100.0000', observed_amount: '100.0000', ...pay,
  };
  const rows = [];
  const client = {
    query: jest.fn(async (sql, params) => {
      if (/FROM supplier_execution_payments WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: params[0] === PAY ? [payment] : [] };
      if (/SELECT id FROM supplier_execution_payments/.test(sql)) return { rows: params[0] === PAY ? [{ id: PAY }] : [] };
      if (/idempotency_key = \$2/.test(sql)) return { rows: rows.filter((r) => r.idempotency_key === params[1]) };
      if (/FILTER \(WHERE kind='payment'\)/.test(sql)) {
        const f = (kind, col) => rows.filter((r) => r.kind === kind).reduce((a, r) => a + Number(r[col]), 0);
        return { rows: [{
          paid_c: f('payment', 'amount_currency').toFixed(4), paid_k: f('payment', 'amount_kmf').toFixed(2),
          fees_k: f('payment', 'fees_kmf').toFixed(2), goods_c: f('goods_refund', 'amount_currency').toFixed(4),
          goods_k: f('goods_refund', 'amount_kmf').toFixed(2), feeref_k: f('fee_refund', 'amount_kmf').toFixed(2),
          other_c: f('other_refund', 'amount_currency').toFixed(4),
        }] };
      }
      if (/INSERT INTO supplier_payment_settlements/.test(sql)) {
        const [pid, kind, ac, cu, ak, fk, proof, key, notes, by] = params;
        const row = { id: `s${rows.length}`, supplier_execution_payment_id: pid, kind, amount_currency: ac, currency: cu,
          amount_kmf: ak, fees_kmf: fk, proof_ref: proof, idempotency_key: key, notes, recorded_by: by, recorded_at: 'now' };
        rows.push(row);
        return { rows: [row] };
      }
      if (/FROM supplier_payment_settlements WHERE supplier_execution_payment_id = \$1 ORDER/.test(sql)) return { rows };
      throw new Error(`SQL inattendu ${sql.slice(0, 50)}`);
    }),
  };
  return { client, rows };
}

const base = (o = {}) => ({
  kind: 'payment', amount_currency: '40.00', currency: 'USD', amount_kmf: '18000.50', fees_kmf: '120',
  proof_ref: 'RELEVE-1', idempotency_key: 'k1', ...o,
});
const code = (p) => p.then(() => null, (e) => `${e.status}:${e.code}`);

describe('recordSettlement', () => {
  it('enregistre un règlement et normalise les montants', async () => {
    const { client } = fakeDb();
    const r = await recordSettlement(client, PAY, base(), 'u1');
    expect(r.idempotent_replay).toBe(false);
    expect(r.settlement).toMatchObject({ kind: 'payment', amount_currency: '40.0000', amount_kmf: '18000.50', fees_kmf: '120.00', recorded_by: 'u1' });
  });

  it('refus de saisie : 400', async () => {
    const { client } = fakeDb();
    expect(await code(recordSettlement(client, 'nope', base()))).toBe('400:SUPPLIER_PAYMENT_ID_INVALID');
    expect(await code(recordSettlement(client, PAY, base({ kind: 'x' })))).toBe('400:SETTLEMENT_KIND_INVALID');
    expect(await code(recordSettlement(client, PAY, base({ currency: 'US' })))).toBe('400:SETTLEMENT_CURRENCY_INVALID');
    for (const v of [0, -1, 'abc', NaN, Infinity, null, '1.00001']) {
      expect(await code(recordSettlement(client, PAY, base({ amount_currency: v })))).toBe('400:SETTLEMENT_AMOUNT_CURRENCY_INVALID');
    }
    for (const v of [0, -5, '1e3', NaN, '10.001']) {
      expect(await code(recordSettlement(client, PAY, base({ amount_kmf: v })))).toBe('400:SETTLEMENT_AMOUNT_KMF_INVALID');
    }
    expect(await code(recordSettlement(client, PAY, base({ fees_kmf: -1 })))).toBe('400:SETTLEMENT_FEES_INVALID');
    expect(await code(recordSettlement(client, PAY, base({ kind: 'goods_refund', fees_kmf: 5 })))).toBe('400:SETTLEMENT_FEES_ONLY_ON_PAYMENT');
    expect(await code(recordSettlement(client, PAY, base({ proof_ref: '  ' })))).toBe('400:SETTLEMENT_PROOF_REQUIRED');
    expect(await code(recordSettlement(client, PAY, base({ idempotency_key: '' })))).toBe('400:SETTLEMENT_IDEMPOTENCY_KEY_REQUIRED');
  });

  it('paiement inexistant -> 404 ; non vérifié -> 409 ; devise différente -> 409', async () => {
    expect(await code(recordSettlement(fakeDb().client, '22222222-2222-4222-8222-222222222222', base()))).toBe('404:SUPPLIER_PAYMENT_NOT_FOUND');
    expect(await code(recordSettlement(fakeDb({ real_debit_verified: false }).client, PAY, base()))).toBe('409:SUPPLIER_PAYMENT_NOT_VERIFIED');
    expect(await code(recordSettlement(fakeDb({ status: 'requested' }).client, PAY, base()))).toBe('409:SUPPLIER_PAYMENT_NOT_VERIFIED');
    expect(await code(recordSettlement(fakeDb().client, PAY, base({ currency: 'EUR' })))).toBe('409:SETTLEMENT_CURRENCY_MISMATCH');
  });

  it('plafond : Σ règlements <= observed (ou expected si observed NULL)', async () => {
    const { client } = fakeDb();
    await recordSettlement(client, PAY, base({ amount_currency: '60' }));
    expect(await code(recordSettlement(client, PAY, base({ amount_currency: '40.01', idempotency_key: 'k2' })))).toBe('409:SETTLEMENT_EXCEEDS_PAYMENT_AMOUNT');
    await recordSettlement(client, PAY, base({ amount_currency: '40', idempotency_key: 'k3' }));
    const n = fakeDb({ observed_amount: null, expected_amount: '10' });
    expect(await code(recordSettlement(n.client, PAY, base({ amount_currency: '10.0001' })))).toBe('409:SETTLEMENT_EXCEEDS_PAYMENT_AMOUNT');
  });

  it('remboursements : plafonnés au réglé net ; frais plafonnés aux frais', async () => {
    const { client } = fakeDb();
    expect(await code(recordSettlement(client, PAY, base({ kind: 'goods_refund', amount_currency: '1', amount_kmf: '1', fees_kmf: 0 })))).toBe('409:SETTLEMENT_REFUND_EXCEEDS_SETTLED');
    await recordSettlement(client, PAY, base({ amount_currency: '50', amount_kmf: '20000' }));
    expect(await code(recordSettlement(client, PAY, base({ kind: 'goods_refund', amount_currency: '50.01', amount_kmf: '100', fees_kmf: 0, idempotency_key: 'r1' })))).toBe('409:SETTLEMENT_REFUND_EXCEEDS_SETTLED');
    expect(await code(recordSettlement(client, PAY, base({ kind: 'goods_refund', amount_currency: '10', amount_kmf: '20000.01', fees_kmf: 0, idempotency_key: 'r2' })))).toBe('409:SETTLEMENT_REFUND_EXCEEDS_SETTLED');
    await recordSettlement(client, PAY, base({ kind: 'goods_refund', amount_currency: '50', amount_kmf: '20000', fees_kmf: 0, idempotency_key: 'r3' }));
    expect(await code(recordSettlement(client, PAY, base({ kind: 'fee_refund', amount_currency: '1', amount_kmf: '120.01', fees_kmf: 0, idempotency_key: 'f1' })))).toBe('409:SETTLEMENT_FEE_REFUND_EXCEEDS_FEES');
    const ok = await recordSettlement(client, PAY, base({ kind: 'fee_refund', amount_currency: '1', amount_kmf: '120', fees_kmf: 0, idempotency_key: 'f2' }));
    expect(ok.settlement.kind).toBe('fee_refund');
    const o = await recordSettlement(client, PAY, base({ kind: 'other_refund', amount_currency: '5', amount_kmf: '900', fees_kmf: 0, idempotency_key: 'o1' }));
    expect(o.settlement.kind).toBe('other_refund');
  });

  it('idempotence : même clé + même contenu -> existant ; contenu différent -> 409', async () => {
    const { client, rows } = fakeDb();
    const a = await recordSettlement(client, PAY, base());
    const b = await recordSettlement(client, PAY, base());
    expect(b.idempotent_replay).toBe(true);
    expect(b.settlement.id).toBe(a.settlement.id);
    expect(rows).toHaveLength(1);
    expect(await code(recordSettlement(client, PAY, base({ amount_kmf: '18000.51' })))).toBe('409:SETTLEMENT_IDEMPOTENCY_CONFLICT');
    expect(await code(recordSettlement(client, PAY, base({ proof_ref: 'AUTRE' })))).toBe('409:SETTLEMENT_IDEMPOTENCY_CONFLICT');
  });

  it('listSettlements : 404 si paiement inconnu, sinon liste', async () => {
    const { client } = fakeDb();
    await recordSettlement(client, PAY, base());
    expect((await listSettlements(client, PAY)).settlements).toHaveLength(1);
    expect(await code(listSettlements(client, '22222222-2222-4222-8222-222222222222'))).toBe('404:SUPPLIER_PAYMENT_NOT_FOUND');
  });
});
