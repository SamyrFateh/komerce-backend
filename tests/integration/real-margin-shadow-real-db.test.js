'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/real-margin-shadow-real-db.test.js
 *
 * Feature propriétaire : economic-engine
 *
 * Marge réelle canonique en shadow mode sur vraie base : douane déclarée +
 * imputations -> provisional ; douane pending -> incomplete ; marge legacy
 * posée -> delta ; et preuve que margin_real_pct / margin_alert /
 * sourcing_blocked (et cost_real_kmf) restent strictement inchangés.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('REAL MARGIN SHADOW — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const svc = require('../../services/customs-shipment-service');
  const { computeOrderRealMarginShadow, listRealMarginShadow } = require('../../services/cost-allocation/real-margin-shadow');

  jest.setTimeout(30000);

  const RUN_TAG = `e2e_test_rmshadow_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const orderIds = [];
  const parcelIds = [];
  const productIds = [];
  const shipmentIds = [];
  const relaisIds = [];
  let marketId;
  let seq = 0;

  // Imputation figée : achat 4000, fret 300, douane 500 (landed), 10000 de CA.
  const BREAKDOWN = {
    landed_relay: { product_purchase: 4000, freight: 300, customs: 500 },
    business: { payment: 0, risk_provision: 0 },
  };

  async function seedOrder({ declared, marginRealCostKmf = null }) {
    seq += 1;
    const relaisId = crypto.randomUUID();
    const shipmentId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    const productId = crypto.randomUUID();
    const parcelId = crypto.randomUUID();
    const orderItemId = crypto.randomUUID();
    relaisIds.push(relaisId); shipmentIds.push(shipmentId); orderIds.push(orderId);
    productIds.push(productId); parcelIds.push(parcelId);

    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
       VALUES ($1, $2, 'E2E Agent', '+269000111', 'Moroni Test', 'Ngazidja', $3)`,
      [relaisId, `E2E RMShadow Relais ${RUN_TAG}-${seq}`, marketId]
    );
    await db.query(
      `INSERT INTO customs_shipments
         (id, reference, shipment_date, transport_mode, cif_value_kmf, customs_paid_kmf, freight_kmf, allocation_method, status, market_id)
       VALUES ($1, $2, CURRENT_DATE, 'sea', 10000, NULL, 300, 'by_cif_value', 'pending', $3)`,
      [shipmentId, `${RUN_TAG}-ship-${seq}`, marketId]
    );
    await db.query(
      `INSERT INTO products (id, name, price_kmf, stock, weight_kg, cost_kmf) VALUES ($1, $2, 10000, 100, 1, 4100)`,
      [productId, `E2E RMShadow Produit ${RUN_TAG}-${seq}`]
    );
    await db.query(
      `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, NULL, $3, $4, 10000, 'cash_relais', 'paid', 'confirmed')`,
      [orderId, `${RUN_TAG}-order-${seq}`, relaisId, marketId]
    );
    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf) VALUES ($1, $2, $3, 1, 10000)`,
      [orderItemId, orderId, productId]
    );
    await db.query(`INSERT INTO parcels (id, order_id, reference, status) VALUES ($1, $2, $3, 'in_transit')`, [parcelId, orderId, `${RUN_TAG}-parcel-${seq}`]);
    await db.query(
      `INSERT INTO parcel_items (id, parcel_id, order_item_id, product_id, quantity, qty_allocated) VALUES ($1, $2, $3, $4, 1, 1)`,
      [crypto.randomUUID(), parcelId, orderItemId, productId]
    );
    await db.query(
      `INSERT INTO customs_shipment_parcels (shipment_id, parcel_id, parcel_cif_kmf, parcel_weight_kg) VALUES ($1, $2, 10000, 1)`,
      [shipmentId, parcelId]
    );
    await db.query(
      `INSERT INTO order_item_cost_imputations
         (order_id, order_item_id, product_id, quantity, sale_unit_price_kmf, sale_total_kmf,
          estimated_landed_relay_cost_kmf, estimated_business_variable_cost_kmf, estimated_business_complete_cost_kmf, cost_breakdown)
       VALUES ($1, $2, $3, 1, 10000, 10000, 4800, 4800, 4800, $4::jsonb)`,
      [orderId, orderItemId, productId, JSON.stringify(BREAKDOWN)]
    );
    if (declared) await svc.declareCustomsPayment(db, shipmentId, { customs_paid_kmf: 600, freight_kmf: 300 }, null);
    if (marginRealCostKmf != null) {
      // Seed uniquement : pose du legacy via le trigger compute_real_margin.
      await db.query('UPDATE orders SET cost_real_kmf = $2 WHERE id = $1', [orderId, marginRealCostKmf]);
    }
    return orderId;
  }

  beforeAll(async () => {
    const { rows: [m] } = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    marketId = m.id;
  });

  afterAll(async () => {
    if (orderIds.length) {
      await db.query('DELETE FROM order_item_real_cost_allocations WHERE order_id = ANY($1::uuid[])', [orderIds]).catch(() => {});
      await db.query('DELETE FROM order_item_cost_imputations WHERE order_id = ANY($1::uuid[])', [orderIds]).catch(() => {});
    }
    if (shipmentIds.length) {
      await db.query('DELETE FROM customs_shipment_parcels WHERE shipment_id = ANY($1::uuid[])', [shipmentIds]).catch(() => {});
      await db.query('DELETE FROM customs_shipments WHERE id = ANY($1::uuid[])', [shipmentIds]).catch(() => {});
    }
    if (parcelIds.length) {
      await db.query('DELETE FROM parcel_items WHERE parcel_id = ANY($1::uuid[])', [parcelIds]).catch(() => {});
      // parcels protégé par trigger de suppression : contournement de nettoyage test uniquement.
      await db.query('SET session_replication_role = replica').catch(() => {});
      await db.query('DELETE FROM parcels WHERE id = ANY($1::uuid[])', [parcelIds]).catch(() => {});
      await db.query('SET session_replication_role = origin').catch(() => {});
    }
    if (orderIds.length) {
      await db.query('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [orderIds]).catch(() => {});
      await db.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds]).catch(() => {});
    }
    if (productIds.length) await db.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]).catch(() => {});
    if (relaisIds.length) await db.query('DELETE FROM relais WHERE id = ANY($1::uuid[])', [relaisIds]).catch(() => {});
  });

  const legacyState = async (ids) => (await db.query(
    `SELECT id, margin_real_pct, margin_alert, sourcing_blocked, cost_real_kmf, cost_douane_kmf, cost_transport_kmf, total_kmf
       FROM orders WHERE id = ANY($1::uuid[]) ORDER BY id`, [ids])).rows;

  describe('marge réelle shadow (REAL_DB)', () => {
    let declaredId; let pendingId; let legacyId; let results;
    let before; let after;

    beforeAll(async () => {
      declaredId = await seedOrder({ declared: true });
      pendingId = await seedOrder({ declared: false });
      legacyId = await seedOrder({ declared: true, marginRealCostKmf: 7000 });
      before = await legacyState([declaredId, pendingId, legacyId]);
      results = {
        declared: await computeOrderRealMarginShadow(declaredId),
        pending: await computeOrderRealMarginShadow(pendingId),
        legacy: await computeOrderRealMarginShadow(legacyId, { marketId }),
      };
      after = await legacyState([declaredId, pendingId, legacyId]);
    });

    it('douane déclarée + imputations -> provisional (douane et fret réels, achat catalogue/estimé)', () => {
      const r = results.declared;
      expect(r.completeness).toBe('provisional');
      expect(r.costs.by_type.customs.state).toBe('real');
      expect(r.costs.by_type.customs.real_kmf).toBe(600);
      expect(r.costs.by_type.freight.state).toBe('real');
      expect(r.costs.by_type.product_purchase.state).toBe('estimated_only');
      expect(r.margin.basis).toBe('real_plus_estimated');
      // 10000 - achat estimé 4000 - fret réel 300 - douane réelle 600
      expect(r.margin.shadow_kmf).toBe(5100);
      expect(r.margin.shadow_pct).toBe(51);
      expect(r.purchase.fx_borne).toBeNull();
    });

    it('douane pending -> incomplete, marge null, douane unknown', () => {
      const r = results.pending;
      expect(r.completeness).toBe('incomplete');
      expect(r.costs.unknown_types).toContain('customs');
      expect(r.margin.shadow_pct).toBeNull();
    });

    it('marge legacy posée -> delta calculé', () => {
      const r = results.legacy;
      expect(r.legacy.margin_real_pct).toBe(30);
      expect(r.legacy.cost_real_kmf).toBe(7000);
      expect(r.delta_pct_points).toBe(21); // 51 - 30
    });

    it('margin_real_pct / margin_alert / sourcing_blocked / cost_real_kmf strictement inchangés', () => {
      expect(after).toEqual(before);
    });

    it('listing par marché : agrégat par complétude + isolation', async () => {
      const l = await listRealMarginShadow({ marketId, limit: 200, sinceDays: 1 });
      const mine = l.items.filter((i) => [declaredId, pendingId, legacyId].includes(i.order_id));
      expect(mine).toHaveLength(3);
      expect(l.aggregate.by_completeness.provisional).toBeGreaterThanOrEqual(2);
      expect(l.aggregate.by_completeness.incomplete).toBeGreaterThanOrEqual(1);
      expect(l.aggregate.orders_with_legacy_margin).toBeGreaterThanOrEqual(1);
      const other = await listRealMarginShadow({ marketId: crypto.randomUUID(), limit: 200, sinceDays: 1 });
      expect(other.items).toHaveLength(0);
      // Rapport de mesure (visible avec --verbose)
      // eslint-disable-next-line no-console
      console.info('RMSHADOW_MEASURE', JSON.stringify({ by_completeness: l.aggregate.by_completeness, avg_delta: l.aggregate.avg_delta_pct_points, legacy: l.aggregate.orders_with_legacy_margin, mine: mine.map((m) => ({ c: m.completeness, p: m.shadow_pct, d: m.delta_pct_points })) }));
    });
  });
}
