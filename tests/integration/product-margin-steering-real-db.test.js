'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * Feature propriétaire : economic-engine
 *
 * Pilotage par la marge (lecture seule) sur vraie base : douane ventilée d'une expédition
 * groupée multi-commandes (jamais l'estimé figé), conservation Σ par vente = montant déclaré,
 * NULL ≠ 0 (ligne non groupée), stock local, marge cible figée / produit, écart en points,
 * impact douane par expédition, aucune écriture.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('PILOTAGE MARGE PRODUIT — REAL_DB — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const svc = require('../../services/customs-shipment-service');
  const { listProductMarginSteering } = require('../../services/cost-allocation/product-margin-steering');

  jest.setTimeout(40000);

  const RUN_TAG = `e2e_test_pms_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const ids = { orders: [], parcels: [], products: [], relais: [], shipments: [] };
  let marketId;
  let seq = 0;
  let productId;
  let localProductId;

  // Snapshot figé (unitaire) : achat 4000, fret 300, douane théorique 500 (doit être ignorée), cible 40 %.
  const BD = { landed_relay: { product_purchase: 4000, freight: 300, customs: 500 }, business: { payment: 0, risk_provision: 0 }, target_margin_pct: 40 };

  async function seedSale({ product, fulfillment = null, inTransit = true }) {
    const relaisId = crypto.randomUUID(); const orderId = crypto.randomUUID();
    const itemId = crypto.randomUUID(); const parcelId = crypto.randomUUID();
    ids.relais.push(relaisId); ids.orders.push(orderId); ids.parcels.push(parcelId);
    await db.query(`INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
      VALUES ($1, $2, 'E2E', '+269000111', 'Moroni', 'Ngazidja', $3)`, [relaisId, `E2E PMS ${RUN_TAG}-${++seq}`, marketId]);
    await db.query(`INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
      VALUES ($1, $2, NULL, $3, $4, 10000, 'cash_relais', 'paid', 'confirmed')`, [orderId, `${RUN_TAG}-o-${++seq}`, relaisId, marketId]);
    await db.query(`INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf, fulfillment_source) VALUES ($1, $2, $3, 1, 10000, $4)`,
      [itemId, orderId, product, fulfillment]);
    await db.query(`INSERT INTO parcels (id, order_id, reference, status, customs_value_kmf, customs_weight_kg, volume_cm3)
      VALUES ($1, $2, $3, $4, 10000, 1, 1000)`, [parcelId, orderId, `${RUN_TAG}-p-${++seq}`, inTransit ? 'in_transit' : 'arrived']);
    await db.query(`INSERT INTO parcel_items (id, parcel_id, order_item_id, product_id, quantity, qty_allocated) VALUES ($1, $2, $3, $4, 1, 1)`,
      [crypto.randomUUID(), parcelId, itemId, product]);
    await db.query(`INSERT INTO order_item_cost_imputations (order_id, order_item_id, product_id, quantity, sale_unit_price_kmf, sale_total_kmf,
        estimated_landed_relay_cost_kmf, estimated_business_variable_cost_kmf, estimated_business_complete_cost_kmf, cost_breakdown)
      VALUES ($1, $2, $3, 1, 10000, 10000, 4800, 4800, 4800, $4::jsonb)`, [orderId, itemId, product, JSON.stringify(BD)]);
    return { orderId, itemId, parcelId };
  }

  let result; let snapshotBefore;
  const prod = () => result.products.find((p) => p.product_id === productId);
  const localProd = () => result.products.find((p) => p.product_id === localProductId);

  beforeAll(async () => {
    const { rows: [m] } = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    marketId = m.id;
    productId = crypto.randomUUID(); localProductId = crypto.randomUUID();
    ids.products.push(productId, localProductId);
    await db.query(`INSERT INTO products (id, name, price_kmf, stock, weight_kg, cost_kmf, target_margin_pct) VALUES
      ($1, $2, 10000, 100, 1, 4000, 45), ($3, $4, 10000, 100, 1, 4000, NULL)`,
    [productId, `E2E PMS Produit ${RUN_TAG}`, localProductId, `E2E PMS Local ${RUN_TAG}`]);

    const a = await seedSale({ product: productId });
    const b = await seedSale({ product: productId });
    const c = await seedSale({ product: productId });
    await seedSale({ product: productId }); // non groupée → douane inconnue
    await seedSale({ product: localProductId, fulfillment: 'LOCAL_STOCK', inTransit: false });
    const { shipment } = await svc.createShipment(db, {
      reference: `${RUN_TAG}-ship`, shipment_date: '2026-10-01', cif_value_kmf: 30000, transport_mode: 'sea',
      allocation_method: 'by_cif_value', customs_paid_kmf: '1800.01', freight_kmf: '900',
      parcel_ids: [a.parcelId, b.parcelId, c.parcelId],
    }, null, { marketId });
    ids.shipments.push(shipment.id);
    snapshotBefore = (await db.query(`SELECT order_item_id, cost_breakdown FROM order_item_cost_imputations WHERE order_id = ANY($1::uuid[]) ORDER BY order_item_id`, [ids.orders])).rows;
    result = await listProductMarginSteering({ marketId, sinceDays: 1, limit: 2000 });
  });

  afterAll(async () => {
    const q = (sql, p) => db.query(sql, p).catch(() => {});
    await q('SET session_replication_role = replica');
    await q('DELETE FROM customs_shipment_financial_audit WHERE shipment_id = ANY($1::uuid[])', [ids.shipments]);
    await q('DELETE FROM order_item_real_cost_allocations WHERE order_id = ANY($1::uuid[])', [ids.orders]);
    await q('DELETE FROM order_item_cost_imputations WHERE order_id = ANY($1::uuid[])', [ids.orders]);
    await q('DELETE FROM customs_shipment_parcels WHERE shipment_id = ANY($1::uuid[])', [ids.shipments]);
    await q('DELETE FROM customs_shipments WHERE id = ANY($1::uuid[])', [ids.shipments]);
    await q('DELETE FROM parcel_items WHERE parcel_id = ANY($1::uuid[])', [ids.parcels]);
    await q('DELETE FROM parcels WHERE id = ANY($1::uuid[])', [ids.parcels]);
    await q('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [ids.orders]);
    await q('DELETE FROM orders WHERE id = ANY($1::uuid[])', [ids.orders]);
    await q('SET session_replication_role = origin');
    await q('DELETE FROM products WHERE id = ANY($1::uuid[])', [ids.products]);
    await q('DELETE FROM relais WHERE id = ANY($1::uuid[])', [ids.relais]);
  });

  describe('pilotage par la marge — REAL_DB', () => {
    it('conservation : Σ douane par vente = montant déclaré (1800.01), jamais l\'estimé figé', () => {
      const sales = prod().sales_detail.filter((s) => s.status !== 'incomplete');
      expect(sales).toHaveLength(3);
      const customs = sales.reduce((s, x) => s + x.costs.customs.amount_kmf, 0);
      expect(Math.round(customs * 100)).toBe(180001);
      for (const s of sales) expect(s.costs.customs.state).toBe('real');
    });

    it('NULL ≠ 0 : vente non groupée = incomplete, exclue du cumul', () => {
      const inc = prod().sales_detail.filter((s) => s.status === 'incomplete');
      expect(inc).toHaveLength(1);
      expect(inc[0]).toMatchObject({ reason: 'customs_unknown', margin_pct: null, cost_kmf: null });
      expect(prod()).toMatchObject({ sales: 4, sales_measured: 3, sales_incomplete: 1 });
    });

    it('marge cible figée à la vente (40) prioritaire sur la cible produit courante (45) ; écart en points', () => {
      const p = prod();
      expect(p.product_target_pct).toBe(45);
      expect(p.target_margin_pct).toBe(40);
      // 3 × 10000 − 3 × (4000 + 300 réel) − 1800.01 = 15299.99 → 51 %
      expect(p.cumulative_margin_pct).toBe(51);
      expect(p.gap_pts).toBe(11);
      expect(p.sales_detail[0].target_source).toBe('frozen_at_sale');
    });

    it('impact douane par expédition', () => {
      const s = prod().by_shipment;
      expect(s).toHaveLength(1);
      expect(s[0]).toMatchObject({ shipment_id: ids.shipments[0], sales: 3, sale_kmf: 30000 });
      expect(s[0].customs_impact_pts).toBe(6);
      expect(prod().signal).toBe('watch');
    });

    it('stock local : douane non attendue, estimé théorique 500 ignoré', () => {
      const s = localProd().sales_detail[0];
      expect(s.costs.customs.state).toBe('not_expected');
      expect(s.margin_kmf).toBe(10000 - 4000 - 300);
    });

    it('lecture seule : snapshots figés inchangés ; isolation par marché', async () => {
      const after = (await db.query(`SELECT order_item_id, cost_breakdown FROM order_item_cost_imputations WHERE order_id = ANY($1::uuid[]) ORDER BY order_item_id`, [ids.orders])).rows;
      expect(after).toEqual(snapshotBefore);
      const other = await listProductMarginSteering({ marketId: crypto.randomUUID(), sinceDays: 1 });
      expect(other.products).toHaveLength(0);
    });
  });
}
