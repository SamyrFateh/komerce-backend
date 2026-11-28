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
  const { prepareSupplierPayment, markPaymentRequested, markPaymentSucceeded } = require('../../services/supplier-payment-state');

  const id = () => crypto.randomUUID();
  const q = (sql, params) => db.query(sql, params);
  const tag = `FA23-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  let user; let financeUser; let supplier; let markets;
  const poIds = [];

  async function seedPo({ market, commitment = 100, authorized = 100, currency = 'AED', withAuth = true, ordered = true, decisionActor = user }) {
    const poId = id(); const groupId = id();
    poIds.push(poId);
    await db.withTransaction(async (c) => {
      await c.query('SET LOCAL session_replication_role = replica');
      await c.query("INSERT INTO purchase_orders (id, supplier_id, status, qty, market_id) VALUES ($1,$2,'notified',NULL,$3)", [poId, supplier, market]);
      await c.query(
        `INSERT INTO purchase_order_authorizations (purchase_order_id, authorization_type, decided_by, amount, currency, proof_ref, decided_at)
         VALUES ($1,'purchase_commitment',$2,$3,$4,'BC',now())`, [poId, decisionActor, commitment, currency]);
      if (withAuth) {
        await c.query(
          `INSERT INTO purchase_order_authorizations (purchase_order_id, authorization_type, decided_by, amount, currency, proof_ref, decided_at)
           VALUES ($1,'supplier_payment',$2,$3,$4,'VIR',now()+CASE WHEN $5::boolean THEN interval '1 millisecond' ELSE interval '0 milliseconds' END)`, [poId, decisionActor, authorized, currency, ordered]);
      }
      await c.query("INSERT INTO supplier_execution_groups (id, purchase_order_id, provider, supplier_parent_order_id) VALUES ($1,$2,'cj',$3)", [groupId, poId, `P-${tag}-${poId}`]);
    });
    return { poId, groupId };
  }

  const pay = (po, amount, { currency = 'AED', key = id(), delayMs = 0, observed, actor = financeUser } = {}) => db.withTransaction((client) => executeSupplierPayment(client, {
    financeActorId: actor,
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
    financeUser = id();
    await q('INSERT INTO users(id,full_name,email,phone,role) VALUES($1,$2,$3,$4,$5)',
      [financeUser, `finance ${tag}`, `finance-${tag}@komerce.test`.toLowerCase(), `+2694${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, 'finance']);
    await q('INSERT INTO dashboard_global_access_grants(user_id,reason) VALUES($1,$2)', [financeUser, tag]);
    supplier = id();
    await q("INSERT INTO suppliers(id,name,platform,is_active) VALUES($1,$2,'local',true)", [supplier, `S ${tag}`]);
  });
  afterAll(async () => {
    // Nettoyage complet (tables append-only incluses, via replica sur connexion dédiée) : aucune délégation ni autorisation résiduelle
    // ne doit survivre à la suite (sinon le reset d'usine bute sur les FK vers users).
    const c = await db.getClient();
    try {
      await c.query("SET session_replication_role='replica'");
      await c.query('DELETE FROM supplier_payment_settlements WHERE supplier_execution_payment_id IN (SELECT id FROM supplier_execution_payments WHERE purchase_order_id = ANY($1::uuid[]))', [poIds]);
      for (const [t, col] of [['supplier_payment_settlements', null], ['supplier_execution_payments', 'purchase_order_id'], ['supplier_execution_groups', 'purchase_order_id'],
        ['purchase_order_authorizations', 'purchase_order_id'], ['purchase_orders', 'id']]) {
        if (!col) continue;
        await c.query(`DELETE FROM ${t} WHERE ${col} = ANY($1::uuid[])`, [poIds]).catch(() => {});
      }
      await c.query('DELETE FROM hub_authorization_grants WHERE user_id = $1 OR granted_by = $1', [user]).catch(() => {});
      await c.query('DELETE FROM dashboard_global_access_grants WHERE user_id = $1', [financeUser]).catch(() => {});
      await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[user, financeUser]]).catch(() => {});
      await c.query('DELETE FROM suppliers WHERE id = $1', [supplier]).catch(() => {});
    } finally { await c.query("SET session_replication_role='origin'").catch(() => {}); c.release(); await db.pool.end().catch(() => {}); }
  });

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

  test('B4 : décisions ordonnées, acteur distinct, rejeu exact et référence unique sous concurrence inter-PO', async () => {
    const a = await seedPo({ market: markets[0], ordered: true });
    const b = await seedPo({ market: markets[1], ordered: true });
    const wrong = await seedPo({ market: markets[0], ordered: false });
    const p = (await pay(a, 50)).payment.id;
    const p2 = (await pay(b, 50)).payment.id;
    // Legacy fixture only: the new B4 execution boundary rejects this PO.
    expect(await refused(pay(wrong, 50))).toBe('FINANCE_B4_AUTHORIZATION_REQUIRED');
    const pWrong = await db.withTransaction(async (client) => {
      const paymentExecutionKey = `${tag}-${id()}`;
      const p = await prepareSupplierPayment(client, { purchaseOrderId: wrong.poId, provider:'cj', paymentExecutionKey, supplierExecutionGroupId:wrong.groupId, expectedAmount:50, currency:'AED' });
      await markPaymentRequested(client,{provider:'cj',paymentExecutionKey});
      await markPaymentSucceeded(client,{provider:'cj',paymentExecutionKey,observedAmount:50,reconciliationStatus:'matched',paymentRef:`legacy-${id()}`,realDebitVerified:true});
      return p.id;
    });
    const proof = 'B4-' + tag;
    const body = { kind: 'payment', currency: 'AED', amount_currency: '20', debit_currency:'KMF',debit_amount:'1000',fee_currency:'KMF',fee_amount:'0',debit_at:new Date(Date.now()-1000).toISOString(), proof_ref: proof, idempotency_key: 'b4-1' };
    const post = (paymentId, actor, payload = body) => recordSettlement(db, paymentId, payload, actor, {requireB4:true});
    expect(await refused(post(p, user))).toBe('FINANCE_B4_SEPARATION_REQUIRED');
    expect(await refused(post(pWrong, financeUser))).toBe('FINANCE_B4_AUTHORIZATION_REQUIRED');
    const before = await q('SELECT count(*)::int AS n FROM supplier_payment_settlements WHERE proof_ref=$1', [proof]);
    expect(before.rows[0].n).toBe(0);
    const results = await Promise.all([p,p2].map(paymentId => post(paymentId, financeUser).then(value => ({paymentId,value}), error => ({paymentId,code:error.code}))));
    expect(results.filter(x => x.value)).toHaveLength(1);
    expect(results.filter(x => x.code === 'FINANCE_SETTLEMENT_PROOF_ALREADY_USED')).toHaveLength(1);
    const winner = results.find(x => x.value);
    const replay = await post(winner.paymentId, financeUser);
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.settlement.id).toBe(winner.value.settlement.id);
    expect(await refused(post(winner.paymentId, financeUser, {...body,debit_amount:'1001'}))).toBe('SETTLEMENT_IDEMPOTENCY_CONFLICT');
    const after = await q('SELECT count(*)::int AS n FROM supplier_payment_settlements WHERE proof_ref=$1', [proof]);
    expect(after.rows[0].n).toBe(1);
  });

  test('B4 : absence d’identité, rôle non Finance, grant révoqué ou même acteur refusés avant toute création de paiement', async () => {
    const po = await seedPo({market:markets[0]});
    expect(await refused(pay(po, 10, {actor:null}))).toBe('FINANCE_ACTOR_REQUIRED');
    expect(await refused(pay(po, 10, {actor:user}))).toBe('FINANCE_CENTRAL_AUTHORITY_REQUIRED');
    await q('UPDATE dashboard_global_access_grants SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[financeUser]);
    try { expect(await refused(pay(po,10))).toBe('FINANCE_CENTRAL_AUTHORITY_REQUIRED'); }
    finally { await q('INSERT INTO dashboard_global_access_grants(user_id,reason) VALUES($1,$2)', [financeUser,tag]); }
    const same = await seedPo({market:markets[0],decisionActor:financeUser});
    expect(await refused(pay(same,10))).toBe('FINANCE_B4_SEPARATION_REQUIRED');
    const {rows:[result]}=await q('SELECT count(*)::int AS n FROM supplier_execution_payments WHERE purchase_order_id=ANY($1::uuid[])',[[po.poId,same.poId]]);
    expect(result.n).toBe(0);
  });

  test('hors transaction : un client brut est refusé (fail-closed) ; le pool ouvre sa propre transaction', async () => {
    const po = await seedPo({ market: markets[0] });
    const raw = await db.getClient();
    try {
      await expect(auth.assertPaymentAuthorized(raw, po.poId, 10, 'AED')).rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_TRANSACTION_REQUIRED' });
      await raw.query('BEGIN');
      await expect(auth.assertPaymentAuthorized(raw, po.poId, 10, 'AED')).resolves.toBeUndefined();
      await raw.query('COMMIT');
    } finally { raw.release(); }
    await expect(auth.assertPaymentAuthorized(db, po.poId, 10, 'AED')).resolves.toBeUndefined();
    await expect(auth.assertPaymentAuthorized(db, po.poId, 101, 'AED')).rejects.toMatchObject({ code: 'SUPPLIER_PAYMENT_EXCEEDS_AUTHORIZATION' });
  });
}
