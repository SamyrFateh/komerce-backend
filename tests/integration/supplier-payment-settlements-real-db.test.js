'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/supplier-payment-settlements-real-db.test.js
 *
 * Feature propriétaire : purchasing / economic-engine
 *
 * Coût d'achat réel sur vraie base : règlements KMF (migration 293) saisis par le
 * service admin, lus par le shadow. Paiements partiels multi-taux, multi-devises,
 * remboursements typés, PO regroupée (ventilation sans perte), idempotence,
 * append-only, et immuabilité des prix/imputations/marges legacy.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('SUPPLIER PAYMENT SETTLEMENTS — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const { recordSettlement, listSettlements } = require('../../services/supplier-payment-settlement-service');
  const { computeOrderRealMarginShadow } = require('../../services/cost-allocation/real-margin-shadow');

  jest.setTimeout(60000);

  const RUN_TAG = `e2e_test_sps_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const ids = { orders: [], products: [], relais: [], pos: [], payments: [], groups: [], lines: [], items: [] };
  let marketId; let supplierId; let seq = 0;

  const BREAKDOWN = {
    landed_relay: { product_purchase: 4000, freight: 0, customs: 0 },
    business: { payment: 300, risk_provision: 0 },
  };

  async function seedOrder(nItems = 1) {
    seq += 1;
    const relaisId = crypto.randomUUID(); const orderId = crypto.randomUUID();
    ids.relais.push(relaisId); ids.orders.push(orderId);
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
       VALUES ($1, $2, 'E2E Agent', '+269000111', 'Moroni Test', 'Ngazidja', $3)`,
      [relaisId, `E2E SPS Relais ${RUN_TAG}-${seq}`, marketId]);
    await db.query(
      `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, NULL, $3, $4, 10000, 'cash_relais', 'paid', 'confirmed')`,
      [orderId, `${RUN_TAG}-order-${seq}`, relaisId, marketId]);
    const items = [];
    for (let i = 0; i < nItems; i += 1) {
      const productId = crypto.randomUUID(); const itemId = crypto.randomUUID();
      ids.products.push(productId); ids.items.push(itemId);
      await db.query(`INSERT INTO products (id, name, price_kmf, stock, weight_kg, cost_kmf) VALUES ($1, $2, 10000, 100, 1, 4100)`,
        [productId, `E2E SPS Produit ${RUN_TAG}-${seq}-${i}`]);
      await db.query(`INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf) VALUES ($1, $2, $3, 1, 10000)`,
        [itemId, orderId, productId]);
      await db.query(
        `INSERT INTO order_item_cost_imputations
           (order_id, order_item_id, product_id, quantity, sale_unit_price_kmf, sale_total_kmf,
            estimated_landed_relay_cost_kmf, estimated_business_variable_cost_kmf, estimated_business_complete_cost_kmf, cost_breakdown)
         VALUES ($1, $2, $3, 1, 10000, 10000, 4000, 4300, 4300, $4::jsonb)`,
        [orderId, itemId, productId, JSON.stringify(BREAKDOWN)]);
      items.push(itemId);
    }
    return { orderId, items };
  }

  async function seedPo({ lines, currency = 'USD', payment = {} }) {
    // lines: [{ itemId, qty, price, confirmed = true }]
    const poId = crypto.randomUUID();
    ids.pos.push(poId);
    // Seed uniquement : forme regroupée (en-tête sans détail) ; les gardes d'identité exacte
    // (trigger groupable) sont hors sujet ici, d'où replica limité à cette transaction.
    await db.withTransaction(async (client) => {
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(
        `INSERT INTO purchase_orders (id, supplier_id, status, qty) VALUES ($1, $2, 'confirmed', NULL)`, [poId, supplierId]);
      for (const l of lines) {
        const lineId = crypto.randomUUID();
        ids.lines.push(lineId);
        const confirmed = l.confirmed !== false;
        await client.query(
          `INSERT INTO purchase_lines (id, purchase_order_id, order_item_id, supplier_id, supplier_sku, quantity, procurement_hub_ref,
              supplier_unit_price, supplier_currency, confirmed_quantity, confirmed_unit_price, confirmed_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'DXB', $7, $8, $9, $10, ${confirmed ? 'NOW()' : 'NULL'})`,
          [lineId, poId, l.itemId, supplierId, `SKU-${RUN_TAG}`, l.qty, l.price, currency,
            confirmed ? l.qty : null, confirmed ? l.price : null]);
      }
    });
    const groupId = crypto.randomUUID(); ids.groups.push(groupId);
    await db.query(`INSERT INTO supplier_execution_groups (id, purchase_order_id, provider, supplier_parent_order_id) VALUES ($1, $2, 'cj', $3)`,
      [groupId, poId, `PARENT-${RUN_TAG}-${poId}`]);
    const paymentId = await seedPayment(poId, groupId, currency, payment);
    return { poId, paymentId, groupId };
  }

  async function seedPayment(poId, groupId, currency, o = {}) {
    const p = { expected: '100', observed: '100', status: 'succeeded', recon: 'matched', verified: true, ...o };
    const paymentId = crypto.randomUUID(); ids.payments.push(paymentId);
    await db.query(
      `INSERT INTO supplier_execution_payments
         (id, purchase_order_id, provider, payment_execution_key, supplier_execution_group_id, expected_amount, observed_amount,
          currency, status, reconciliation_status, real_debit_verified)
       VALUES ($1,$2,'cj',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [paymentId, poId, `${RUN_TAG}-${paymentId}`, groupId, p.expected, p.observed, currency, p.status, p.recon, p.verified]);
    return paymentId;
  }

  const settle = (paymentId, payload) => recordSettlement(db, paymentId, {
    kind: 'payment', currency: 'USD', proof_ref: 'RELEVE-1', ...payload,
  }, null);
  const rejects = async (p) => p.then(() => null, (e) => `${e.status}:${e.code}`);

  const guarded = async (orderIds) => {
    const orders = (await db.query(
      `SELECT id, total_kmf, margin_real_pct, margin_alert, sourcing_blocked, cost_real_kmf FROM orders WHERE id = ANY($1::uuid[]) ORDER BY id`, [orderIds])).rows;
    const imp = (await db.query(
      `SELECT order_item_id, sale_unit_price_kmf, sale_total_kmf, estimated_landed_relay_cost_kmf, cost_breakdown
         FROM order_item_cost_imputations WHERE order_id = ANY($1::uuid[]) ORDER BY order_item_id`, [orderIds])).rows;
    const items = (await db.query(`SELECT id, price_kmf, quantity FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY id`, [orderIds])).rows;
    const alloc = (await db.query(`SELECT COUNT(*)::int AS n FROM order_item_real_cost_allocations WHERE order_id = ANY($1::uuid[])`, [orderIds])).rows[0].n;
    return { orders, imp, items, alloc };
  };

  beforeAll(async () => {
    const { rows: [m] } = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    marketId = m.id;
    supplierId = crypto.randomUUID();
    await db.query(`INSERT INTO suppliers (id, name, platform) VALUES ($1, $2, 'cj')`, [supplierId, `E2E SPS Supplier ${RUN_TAG}`]);
  });

  afterAll(async () => {
    const q = (sql, p) => db.query(sql, p).catch(() => {});
    await q('SET session_replication_role = replica');
    if (ids.payments.length) await q('DELETE FROM supplier_payment_settlements WHERE supplier_execution_payment_id = ANY($1::uuid[])', [ids.payments]);
    if (ids.payments.length) await q('DELETE FROM supplier_execution_payments WHERE id = ANY($1::uuid[])', [ids.payments]);
    if (ids.groups.length) await q('DELETE FROM supplier_execution_groups WHERE id = ANY($1::uuid[])', [ids.groups]);
    if (ids.lines.length) await q('DELETE FROM purchase_lines WHERE id = ANY($1::uuid[])', [ids.lines]);
    if (ids.pos.length) await q('DELETE FROM purchase_orders WHERE id = ANY($1::uuid[])', [ids.pos]);
    if (ids.orders.length) await q('DELETE FROM order_item_cost_imputations WHERE order_id = ANY($1::uuid[])', [ids.orders]);
    if (ids.orders.length) await q('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [ids.orders]);
    if (ids.orders.length) await q('DELETE FROM orders WHERE id = ANY($1::uuid[])', [ids.orders]);
    if (ids.products.length) await q('DELETE FROM products WHERE id = ANY($1::uuid[])', [ids.products]);
    if (ids.relais.length) await q('DELETE FROM relais WHERE id = ANY($1::uuid[])', [ids.relais]);
    await q('DELETE FROM suppliers WHERE id = $1', [supplierId]);
    await q('SET session_replication_role = origin');
  });

  describe('règlements fournisseur -> coût d\'achat réel (REAL_DB)', () => {
    it('2 paiements partiels à 2 taux : taux effectif exact, frais en payment, invariants intacts', async () => {
      const { orderId, items } = await seedOrder();
      const { paymentId } = await seedPo({ lines: [{ itemId: items[0], qty: 1, price: '100' }] });
      const before = await guarded([orderId]);

      const pre = await computeOrderRealMarginShadow(orderId);
      expect(pre.costs.by_type.product_purchase.state).toBe('confirmed_unvalued');
      expect(pre.purchase.effective_fx_rate).toBeNull();
      expect(pre.purchase.real_kmf).toBeNull();

      await settle(paymentId, { amount_currency: '40', amount_kmf: '16000', fees_kmf: '100', idempotency_key: 'a1' });
      const mid = await computeOrderRealMarginShadow(orderId);
      expect(mid.purchase.flags).toContain('underpaid'); // pas de final prématuré
      expect(mid.costs.by_type.product_purchase.state).toBe('confirmed_unvalued');
      expect(mid.costs.by_type.product_purchase.real_kmf).toBeNull();
      expect(mid.purchase.paid.amount_kmf).toBe(16000);

      await settle(paymentId, { amount_currency: '60', amount_kmf: '25200', fees_kmf: '50', idempotency_key: 'a2' });
      const r = await computeOrderRealMarginShadow(orderId);
      expect(r.purchase.paid).toEqual({ amount_currency: 100, currency: 'USD', amount_kmf: 41200 });
      expect(r.purchase.effective_fx_rate).toBe(412);
      expect(r.purchase.real_kmf).toBe(41200);
      expect(r.costs.by_type.product_purchase).toMatchObject({ state: 'real', real_kmf: 41200, estimated_kmf: 4000 });
      expect(r.costs.by_type.payment).toMatchObject({ state: 'real', real_kmf: 150, estimated_kmf: 300 });
      expect(r.completeness).toBe('final');
      // payment compté une seule fois : marge = 10000 - 41200 - 150 (aucun estimé résiduel pour payment)
      expect(r.margin.shadow_kmf).toBe(10000 - 41200 - 150);
      expect(r.margin.basis).toBe('real_only');
      expect(await guarded([orderId])).toEqual(before);
    });

    it('remboursements typés : goods réduit l\'achat, fee réduit payment, other sans effet', async () => {
      const { orderId, items } = await seedOrder();
      const { paymentId } = await seedPo({ lines: [{ itemId: items[0], qty: 1, price: '90' }] });
      await settle(paymentId, { amount_currency: '100', amount_kmf: '40000', fees_kmf: '200', idempotency_key: 'b1' });
      await settle(paymentId, { kind: 'goods_refund', amount_currency: '10', amount_kmf: '4000', idempotency_key: 'b2' });
      await settle(paymentId, { kind: 'fee_refund', amount_currency: '1', amount_kmf: '50', idempotency_key: 'b3' });
      const o1 = await computeOrderRealMarginShadow(orderId);
      await settle(paymentId, { kind: 'other_refund', amount_currency: '3', amount_kmf: '999', idempotency_key: 'b4' });
      const o2 = await computeOrderRealMarginShadow(orderId);
      expect(o2.purchase.real_kmf).toBe(36000);
      expect(o2.purchase.refunds_goods_kmf).toBe(4000);
      expect(o2.costs.by_type.payment.real_kmf).toBe(150);
      expect(o2).toEqual(o1);
      // remboursements > réglé net, fee_refund > frais : refusés
      expect(await rejects(settle(paymentId, { kind: 'goods_refund', amount_currency: '91', amount_kmf: '10', idempotency_key: 'b5' }))).toBe('409:SETTLEMENT_REFUND_EXCEEDS_SETTLED');
      expect(await rejects(settle(paymentId, { kind: 'fee_refund', amount_currency: '1', amount_kmf: '150.01', idempotency_key: 'b6' }))).toBe('409:SETTLEMENT_FEE_REFUND_EXCEEDS_FEES');
    });

    it('PO regroupée sur 2 commandes : 1000.01 sur 3 lignes égales, ventilation sans perte', async () => {
      const A = await seedOrder(1); const B = await seedOrder(2);
      const { paymentId } = await seedPo({
        lines: [{ itemId: A.items[0], qty: 1, price: '10' }, { itemId: B.items[0], qty: 1, price: '10' }, { itemId: B.items[1], qty: 1, price: '10' }],
        payment: { expected: '30', observed: '30' },
      });
      await settle(paymentId, { amount_currency: '30', amount_kmf: '1000.01', fees_kmf: '0.01', idempotency_key: 'g1' });
      const ra = await computeOrderRealMarginShadow(A.orderId);
      const rb = await computeOrderRealMarginShadow(B.orderId);
      const cents = (x) => Math.round(x * 100);
      expect(ra.purchase.real_kmf).not.toBeNull();
      expect(cents(ra.purchase.real_kmf) + cents(rb.purchase.real_kmf)).toBe(100001);
      // parts 33334/33334/33333 : l'unité résiduelle va au plus grand reste (égalité départagée par id)
      expect([33333, 33334]).toContain(cents(ra.purchase.real_kmf));
      expect([66667, 66668]).toContain(cents(rb.purchase.real_kmf));
      expect(cents(ra.purchase.fees_kmf) + cents(rb.purchase.fees_kmf)).toBe(1);
      expect(cents(ra.purchase.paid.amount_kmf) + cents(rb.purchase.paid.amount_kmf)).toBe(100001);
    });

    it('multi-devises : devise ≠ paiement refusée ; deux PO en devises différentes sur une commande', async () => {
      const { orderId, items } = await seedOrder(2);
      const usd = await seedPo({ lines: [{ itemId: items[0], qty: 1, price: '10' }], payment: { expected: '10', observed: '10' } });
      const aed = await seedPo({ lines: [{ itemId: items[1], qty: 1, price: '20' }], currency: 'AED', payment: { expected: '20', observed: '20' } });
      expect(await rejects(settle(usd.paymentId, { currency: 'EUR', amount_currency: '10', amount_kmf: '1', idempotency_key: 'c0' }))).toBe('409:SETTLEMENT_CURRENCY_MISMATCH');
      await settle(usd.paymentId, { amount_currency: '10', amount_kmf: '4000', idempotency_key: 'c1' });
      await settle(aed.paymentId, { currency: 'AED', amount_currency: '20', amount_kmf: '2500', idempotency_key: 'c2' });
      const r = await computeOrderRealMarginShadow(orderId);
      expect(r.purchase.real_kmf).toBe(6500);
      expect(r.purchase.paid).toEqual({ amount_currency: null, currency: 'MIXED', amount_kmf: 6500 });
      expect(r.purchase.effective_fx_rate).toBeNull();
    });

    it('idempotence : doublon identique -> existant ; même clé, contenu différent -> 409', async () => {
      const { items } = await seedOrder();
      const { paymentId } = await seedPo({ lines: [{ itemId: items[0], qty: 1, price: '100' }] });
      const a = await settle(paymentId, { amount_currency: '10', amount_kmf: '4000', idempotency_key: 'i1' });
      const b = await settle(paymentId, { amount_currency: '10', amount_kmf: '4000', idempotency_key: 'i1' });
      expect(b.idempotent_replay).toBe(true);
      expect(b.settlement.id).toBe(a.settlement.id);
      expect(await rejects(settle(paymentId, { amount_currency: '10', amount_kmf: '4001', idempotency_key: 'i1' }))).toBe('409:SETTLEMENT_IDEMPOTENCY_CONFLICT');
      expect((await listSettlements(db, paymentId)).settlements).toHaveLength(1);
    });

    it('surpaiement et paiement non vérifié refusés ; sur-règlement détecté', async () => {
      const { items } = await seedOrder();
      const { paymentId } = await seedPo({ lines: [{ itemId: items[0], qty: 1, price: '100' }] });
      expect(await rejects(settle(paymentId, { amount_currency: '100.01', amount_kmf: '1', idempotency_key: 'o1' }))).toBe('409:SETTLEMENT_EXCEEDS_PAYMENT_AMOUNT');
      expect(await rejects(settle(paymentId, { amount_currency: '0', amount_kmf: '1', idempotency_key: 'o2' }))).toBe('400:SETTLEMENT_AMOUNT_CURRENCY_INVALID');
      const poId = ids.pos[ids.pos.length - 1]; const groupId = ids.groups[ids.groups.length - 1];
      const unverified = await seedPayment(poId, groupId, 'USD', { status: 'requested', verified: false, recon: 'pending' });
      expect(await rejects(settle(unverified, { amount_currency: '1', amount_kmf: '1', idempotency_key: 'o3' }))).toBe('409:SUPPLIER_PAYMENT_NOT_VERIFIED');
      expect(await rejects(settle(crypto.randomUUID(), { amount_currency: '1', amount_kmf: '1', idempotency_key: 'o4' }))).toBe('404:SUPPLIER_PAYMENT_NOT_FOUND');
    });

    it('un paiement du PO non vérifié/matched, une ligne non confirmée ou un règlement absent -> provisional', async () => {
      const A = await seedOrder();
      const pa = await seedPo({ lines: [{ itemId: A.items[0], qty: 1, price: '100' }] });
      await settle(pa.paymentId, { amount_currency: '100', amount_kmf: '40000', idempotency_key: 'm1' });
      await seedPayment(pa.poId, pa.groupId, 'USD', { status: 'requested', verified: false, recon: 'pending' });
      const ra = await computeOrderRealMarginShadow(A.orderId);
      expect(ra.purchase.flags).toContain('payment_not_verified_matched');
      expect(ra.costs.by_type.product_purchase.state).toBe('confirmed_unvalued');
      expect(ra.completeness).toBe('provisional');

      const B = await seedOrder();
      const pb = await seedPo({ lines: [{ itemId: B.items[0], qty: 1, price: '100', confirmed: false }] });
      expect(pb.paymentId).toBeTruthy();
      const rb = await computeOrderRealMarginShadow(B.orderId);
      expect(rb.purchase.real_kmf).toBeNull();
      expect(rb.costs.by_type.product_purchase.state).not.toBe('real');

      const C = await seedOrder();
      await seedPo({ lines: [{ itemId: C.items[0], qty: 1, price: '100' }] });
      const rc = await computeOrderRealMarginShadow(C.orderId);
      expect(rc.completeness).toBe('provisional');
      expect(rc.costs.by_type.product_purchase.state).toBe('confirmed_unvalued');
    });

    it('table append-only : UPDATE / DELETE / TRUNCATE refusés', async () => {
      const { items } = await seedOrder();
      const { paymentId } = await seedPo({ lines: [{ itemId: items[0], qty: 1, price: '100' }] });
      const { settlement } = await settle(paymentId, { amount_currency: '10', amount_kmf: '4000', idempotency_key: 'z1' });
      await expect(db.query('UPDATE supplier_payment_settlements SET amount_kmf = 1 WHERE id = $1', [settlement.id])).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM supplier_payment_settlements WHERE id = $1', [settlement.id])).rejects.toThrow(/append-only/);
      await expect(db.query('TRUNCATE supplier_payment_settlements')).rejects.toThrow(/append-only/);
      await expect(db.query(
        `INSERT INTO supplier_payment_settlements (supplier_execution_payment_id, kind, amount_currency, currency, amount_kmf, proof_ref, idempotency_key)
         VALUES ($1,'payment',1,'USD',-1,'x','neg')`, [paymentId])).rejects.toThrow();
    });
  });
}
