'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration supplier-payment-cap-chain-postgres.test.js
 * @brief FA-23 : Σ paiements en cours/ambigus/réussis ≤ autorisation de paiement ≤ engagement PO (même devise),
 *        sous concurrence de deux opérateurs ; l'observé n'élargit jamais le plafond ; isolation par PO/marché.
 */

jest.setTimeout(60000);

if (!process.env.DATABASE_URL) {
  describe.skip('supplier-payment-cap-chain (needs DATABASE_URL)', () => { test('skipped', () => {}); });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const auth = require('../../services/hub-authorization-service');
  const { executeSupplierPayment } = require('../../services/supplier-payment-orchestrator');
  const { recordSettlement } = require('../../services/supplier-payment-settlement-service');

  const id = () => crypto.randomUUID();
  const q = (sql, params) => db.query(sql, params);
  const tag = `FA23-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  let user; let supplier; let markets;

  async function seedPo({ market, commitment = 100, authorized = 100, currency = 'AED', withAuth = true }) {
    const poId = id(); const groupId = id();
    await db.withTransaction(async (c) => {
      await c.query('SET LOCAL session_replication_role = replica');
      await c.query("INSERT INTO purchase_orders (id, supplier_id, status, qty, market_id) VALUES ($1,$2,'notified',NULL,$3)", [poId, supplier, market]);
      await c.query(
        `INSERT INTO purchase_order_authorizations (purchase_order_id, authorization_type, decided_by, amount, currency, proof_ref)
         VALUES ($1,'purchase_commitment',$2,$3,$4,'BC')`, [poId, user, commitment, currency]);
      if (withAuth) {
        await c.query(
          `INSERT INTO purchase_order_authorizations (purchase_order_id, authorization_type, decided_by, amount, currency, proof_ref)
           VALUES ($1,'supplier_payment',$2,$3,$4,'VIR')`, [poId, user, authorized, currency]);
      }
      await c.query("INSERT INTO supplier_execution_groups (id, purchase_order_id, provider, supplier_parent_order_id) VALUES ($1,$2,'cj',$3)", [groupId, poId, `P-${tag}-${poId}`]);
    });
    return { poId, groupId };
  }

  const pay = (po, amount, { currency = 'AED', key = id(), delayMs = 0, observed } = {}) => db.withTransaction((client) => executeSupplierPayment(client, {
    payment: { purchaseOrderId: po.poId, provider: 'cj', paymentExecutionKey: `${tag}-${key}`, supplierExecutionGroupId: po.groupId, expectedAmount: amount, currency },
    invokeProviderPayment: async () => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return { verdict: 'succeeded', observed_amount: observed ?? amount, real_debit_verified: true, reconciliation_status: 'matched', payment_ref: `ref-${id()}` };
    },
  }));
  const refused = (p) => p.then(() => null, (e) => e.code || e.message);

  beforeAll(async () => {
    markets = (await q("SELECT id FROM markets WHERE code IN ('KM','CM') ORDER BY code")).rows.map((r) => r.id);
    user = id();
    await q('INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,$5)',
      [user, `dir ${tag}`, `dir-${tag}@komerce.test`.toLowerCase(), `+2693${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, 'agent_hub']);
    supplier = id();
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'local',true)", [supplier, `S ${tag}`]);
  });
  afterAll(async () => { await db.pool.end().catch(() => {}); });

  test('nominal : tranches 60 + 40 passent, +1 refusé ; une autre devise est refusée', async () => {
    const po = await seedPo({ market: markets[0] });
    expect((await pay(po, 60)).outcome).toBe('succeeded');
    expect((await pay(po, 40)).outcome).toBe('succeeded');
    expect(await refused(pay(po, 1))).toBe('SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION');
    const po2 = await seedPo({ market: markets[0] });
    expect(await refused(pay(po2, 10, { currency: 'USD' }))).toBe('SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION');
  });

  test('concurrence : deux opérateurs paient 60 sur un plafond de 100 → un seul passe, Σ ≤ plafond', async () => {
    const po = await seedPo({ market: markets[0] });
    const res = await Promise.all([pay(po, 60, { delayMs: 150 }).then(() => 'ok', (e) => e.code), pay(po, 60, { delayMs: 150 }).then(() => 'ok', (e) => e.code)]);
    expect(res.filter((r) => r === 'ok')).toHaveLength(1);
    expect(res.filter((r) => r === 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION')).toHaveLength(1);
    const { rows: [s] } = await q("SELECT COALESCE(SUM(expected_amount),0)::float AS t FROM supplier_execution_payments WHERE purchase_order_id=$1 AND status IN ('prepared','requested','succeeded','ambiguous')", [po.poId]);
    expect(s.t).toBeLessThanOrEqual(100);
  });

  test('overflow : 5 paiements concurrents de 30 sur 100 → au plus 3 passent', async () => {
    const po = await seedPo({ market: markets[0] });
    const res = await Promise.all(Array.from({ length: 5 }, () => pay(po, 30, { delayMs: 50 }).then(() => 'ok', (e) => e.code)));
    expect(res.filter((r) => r === 'ok').length).toBe(3);
    expect(res.filter((r) => r === 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION').length).toBe(2);
  });

  test('l\'observé n\'élargit jamais le plafond : observé 80 pour 60 attendus consomme 80 ; règlement plafonné à l\'attendu', async () => {
    const po = await seedPo({ market: markets[0] });
    const first = await pay(po, 60, { observed: 80 });
    expect(await refused(pay(po, 30))).toBe('SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION');
    expect((await pay(po, 20)).outcome).toBe('succeeded');
    const paymentId = first.payment.id;
    const rec = (amount, key) => recordSettlement(db, paymentId, { kind: 'payment', currency: 'AED', amount_currency: amount, amount_kmf: '1000', proof_ref: 'R', idempotency_key: key }, null);
    expect(await refused(rec('60.0001', 'a'))).toBe('SETTLEMENT_EXCEEDS_PAYMENT_AMOUNT');
    await expect(rec('60', 'b')).resolves.toMatchObject({ idempotent_replay: false });
  });

  test('autorisation > engagement : refusée à la décision et par la garde (donnée héritée) ; devise différente refusée', async () => {
    const legacy = await seedPo({ market: markets[0], commitment: 50, authorized: 100 });
    expect(await refused(pay(legacy, 10))).toBe('SUPPLIER_PAYMENT_AUTHORIZATION_EXCEEDS_COMMITMENT');
    const po = await seedPo({ market: markets[0], withAuth: false });
    await q("INSERT INTO hub_authorization_grants (user_id, authorization_type, granted_by) VALUES ($1,'supplier_payment',$1)", [user]);
    const decide = (amount, currency) => auth.decide({ purchaseOrderId: po.poId, authorizationType: 'supplier_payment', actor: { id: user }, body: { proof_ref: 'P', amount, currency } });
    expect(await refused(decide(100.01, 'AED'))).toBe('SUPPLIER_PAYMENT_AUTHORIZATION_EXCEEDS_COMMITMENT');
    expect(await refused(decide(10, 'USD'))).toBe('SUPPLIER_PAYMENT_AUTHORIZATION_EXCEEDS_COMMITMENT');
    await expect(decide(100, 'AED')).resolves.toMatchObject({ authorization_type: 'supplier_payment' });
  });

  test('isolation PO/marché : un PO épuisé sur KM ne consomme rien sur un PO CM', async () => {
    const km = await seedPo({ market: markets[0] }); const cm = await seedPo({ market: markets[1] });
    await pay(km, 100);
    expect(await refused(pay(km, 1))).toBe('SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION');
    expect((await pay(cm, 100)).outcome).toBe('succeeded');
  });
}
