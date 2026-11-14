'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * ME-05 : le snapshot de commande ne contient que N1 + N2 (jamais de N3),
 * quel que soit l'objectif de volume (donc la N3 unitaire) de la période.
 * Marchés KM, CM, CG. pricing-engine est piloté ; la base est réelle.
 */

if (!process.env.DATABASE_URL) {
  describe.skip('ME-05 snapshot N1+N2 (REAL_DB) — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  jest.mock('../../services/pricing-engine', () => ({ loadGlobalConfig: jest.fn(), recommend: jest.fn() }));
  const crypto = require('crypto');
  const db = require('../../db');
  const pricingEngine = require('../../services/pricing-engine');
  const { lockEstimatedCostsForOrder } = require('../../services/order-cost-snapshot');

  jest.setTimeout(30000);
  const TAG = `e2e_test_me05_${Date.now().toString(36)}`;
  const orderIds = []; const productIds = []; const relaisIds = [];
  const prev = process.env.ORDER_COST_SNAPSHOT_ACTIVE;

  beforeAll(() => { process.env.ORDER_COST_SNAPSHOT_ACTIVE = 'true'; });
  afterAll(async () => {
    if (prev === undefined) delete process.env.ORDER_COST_SNAPSHOT_ACTIVE; else process.env.ORDER_COST_SNAPSHOT_ACTIVE = prev;
    await db.query('DELETE FROM order_item_cost_imputations WHERE order_id = ANY($1::uuid[])', [orderIds]).catch(() => {});
    await db.query('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [orderIds]).catch(() => {});
    await db.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds]).catch(() => {});
    await db.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]).catch(() => {});
    await db.query('DELETE FROM relais WHERE id = ANY($1::uuid[])', [relaisIds]).catch(() => {});
  });

  async function seed(code, quantity) {
    const { rows: [m] } = await db.query('SELECT id FROM markets WHERE code = $1', [code]);
    const orderId = crypto.randomUUID(); const productId = crypto.randomUUID();
    const relaisId = crypto.randomUUID();
    orderIds.push(orderId); productIds.push(productId); relaisIds.push(relaisId);
    await db.query(`INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
                    VALUES ($1,$2,'E2E Agent','+269000111','Test','Ngazidja',$3)`, [relaisId, `${TAG}-relais-${code}`, m.id]);
    await db.query(`INSERT INTO products (id, name, price_kmf, stock, weight_kg, cost_kmf) VALUES ($1,$2,5000,100,1,1000)`, [productId, `${TAG}-${code}`]);
    await db.query(`INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
                    VALUES ($1,$2,NULL,$5,$3,$4,'cash_relais','pending','pending')`, [orderId, `${TAG}-${code}-${orderIds.length}`, m.id, 5000 * quantity, relaisId]);
    await db.query(`INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf) VALUES ($1,$2,$3,$4,5000)`, [crypto.randomUUID(), orderId, productId, quantity]);
    return orderId;
  }

  describe.each(['KM', 'CM', 'CG'])('ME-05 snapshot N1+N2 (REAL_DB) marché %s', (code) => {
    it.each([0, 18, 9999])('cost_estimated_kmf = (N1+N2) x quantité pour N3 unitaire = %s', async (n3) => {
      const qty = 3;
      const orderId = await seed(code, qty);
      pricingEngine.loadGlobalConfig.mockResolvedValueOnce({});
      pricingEngine.recommend.mockResolvedValueOnce({
        n1_landed_relay_cost_kmf: 1000, n2_business_variable_cost_kmf: 200,
        n3_fixed_overhead_allocation_kmf: n3, cdr_complete_kmf: 1200 + n3,
      });
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await lockEstimatedCostsForOrder(orderId, client, { source: 'checkout' });
        await client.query('COMMIT');
      } finally { client.release(); }
      const { rows: [o] } = await db.query('SELECT cost_estimated_kmf FROM orders WHERE id = $1', [orderId]);
      const { rows: [i] } = await db.query(
        'SELECT estimated_business_complete_cost_kmf AS c, estimated_fixed_overhead_kmf AS f, estimated_margin_kmf AS m FROM order_item_cost_imputations WHERE order_id = $1', [orderId]);
      expect(Number(o.cost_estimated_kmf)).toBe(3600);
      expect(Number(i.c)).toBe(3600);
      expect(i.f).toBeNull();
      expect(Number(i.m)).toBe(15000 - 3600);
    });
  });
}
