'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/canonical-margin-writer-real-db.test.js
 *
 * Feature propriétaire : economic-engine
 *
 * A8 — écrivain canonique désactivé par défaut : preuve sur vraie base
 * (aucune écriture si désactivé, NULL si incomplet, idempotence, rollback,
 * conservation de la marge shadow).
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);
let mockRules = {};
jest.mock('../../utils/rules', () => ({ getRuleNumber: async (k, d) => (k in mockRules ? mockRules[k] : d) }));

if (!hasIntegrationEnv) {
  describe.skip('CANONICAL MARGIN WRITER — REAL_DB — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const svc = require('../../services/customs-shipment-service');
  const { computeOrderRealMarginShadow } = require('../../services/cost-allocation/real-margin-shadow');
  const writer = require('../../services/cost-allocation/canonical-margin-writer');

  jest.setTimeout(30000);

  // Migration 302 : les règles existent (PATCH /api/admin/rules/:key exige une ligne) et sont DÉSACTIVÉES.
  describe('migration 302 — règles applicatives du writer', () => {
    it.each([writer.RULE_ENABLED, writer.RULE_PROVISIONAL])('%s existe, vaut 0, number 0..1, active', async (key) => {
      const { rows } = await db.query('SELECT value, value_type, min_value, max_value, is_active FROM business_rules WHERE key = $1', [key]);
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toEqual({ value: 0 });
      expect(rows[0].value_type).toBe('number');
      expect([Number(rows[0].min_value), Number(rows[0].max_value)]).toEqual([0, 1]);
      expect(rows[0].is_active).toBe(true);
    });
  });

  const RUN_TAG = `e2e_test_cmwriter_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
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

  async function seedOrder({ declared, marginRealCostKmf = null, quantity = 1, fulfillment = null, grouped = true }) {
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
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf, fulfillment_source) VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderItemId, orderId, productId, quantity, 10000 / quantity, fulfillment]
    );
    await db.query(`INSERT INTO parcels (id, order_id, reference, status) VALUES ($1, $2, $3, 'in_transit')`, [parcelId, orderId, `${RUN_TAG}-parcel-${seq}`]);
    await db.query(
      `INSERT INTO parcel_items (id, parcel_id, order_item_id, product_id, quantity, qty_allocated) VALUES ($1, $2, $3, $4, 1, 1)`,
      [crypto.randomUUID(), parcelId, orderItemId, productId]
    );
    if (grouped) {
      await db.query(
        `INSERT INTO customs_shipment_parcels (shipment_id, parcel_id, parcel_cif_kmf, parcel_weight_kg) VALUES ($1, $2, 10000, 1)`,
        [shipmentId, parcelId]
      );
    }
    await db.query(
      `INSERT INTO order_item_cost_imputations
         (order_id, order_item_id, product_id, quantity, sale_unit_price_kmf, sale_total_kmf,
          estimated_landed_relay_cost_kmf, estimated_business_variable_cost_kmf, estimated_business_complete_cost_kmf, cost_breakdown)
       VALUES ($1, $2, $3, $5, $6, 10000, 4800, 4800, 4800, $4::jsonb)`,
      [orderId, orderItemId, productId, JSON.stringify(quantity === 1 ? BREAKDOWN : {
        landed_relay: { product_purchase: 4000 / quantity, freight: 300 / quantity, customs: 500 / quantity },
        business: { payment: 0, risk_provision: 0 },
      }), quantity, 10000 / quantity]
    );
    if (declared && grouped) await svc.declareCustomsPayment(db, shipmentId, { customs_paid_kmf: 600, freight_kmf: 300 }, null);
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

  const ROW = `SELECT margin_real_pct, margin_alert, sourcing_blocked, cost_real_kmf, cost_closed_at, updated_at, total_kmf, status FROM orders WHERE id = $1`;
  const snap = async (id) => (await db.query(ROW, [id])).rows[0];
  const on = (extra = {}) => { mockRules = { CANONICAL_MARGIN_WRITER_ENABLED: 1, ...extra }; };
  beforeEach(() => { mockRules = {}; });

  describe('A8 — écrivain canonique (REAL_DB)', () => {
    it('désactivé : AUCUNE écriture, ligne strictement identique (legacy posé)', async () => {
      const id = await seedOrder({ declared: true, marginRealCostKmf: 5000 });
      const before = await snap(id);
      expect(Number(before.margin_real_pct)).toBe(50);
      const r = await writer.applyCanonicalMargin(id);
      expect(r).toMatchObject({ enabled: false, wrote: false });
      expect(await snap(id)).toEqual(before);
    });

    it('activé : coût attendu inconnu (non groupé) → marge NULL, jamais 0 ; legacy fictif remplacé', async () => {
      const id = await seedOrder({ declared: false, grouped: false, marginRealCostKmf: 5000 });
      on();
      const r = await writer.applyCanonicalMargin(id);
      expect(r.wrote).toBe(true);
      const after = await snap(id);
      expect(after.margin_real_pct).toBeNull();
      expect(after.margin_alert).toBe(false);
      expect(after.cost_real_kmf).toEqual((await snap(id)).cost_real_kmf);
    });

    it('activé : provisional → NULL par défaut ; valeur shadow avec opt-in ; idempotent ; conservation', async () => {
      const id = await seedOrder({ declared: true });
      const sh = await computeOrderRealMarginShadow(id);
      expect(sh.completeness).toBe('provisional');
      // conservation : CA net − Σ coûts retenus = marge shadow (achat + fret + douane + frais, sans double comptage)
      const costs = Object.entries(sh.costs.by_type).filter(([t, e]) => t !== 'risk_provision' && e.state !== 'not_expected')
        .reduce((s, [, e]) => s + (e.state === 'real' ? e.real_kmf : e.estimated_kmf), 0);
      expect(Math.round(sh.revenue.net_kmf - costs)).toBe(sh.margin.shadow_kmf);

      on();
      await writer.applyCanonicalMargin(id);
      expect((await snap(id)).margin_real_pct).toBeNull();

      on({ CANONICAL_MARGIN_WRITE_PROVISIONAL: 1 });
      const r1 = await writer.applyCanonicalMargin(id);
      expect(r1.wrote).toBe(true);
      const s1 = await snap(id);
      expect(Number(s1.margin_real_pct)).toBeCloseTo(sh.margin.shadow_pct, 2);
      const r2 = await writer.applyCanonicalMargin(id);
      expect(r2.wrote).toBe(false);
      expect(await snap(id)).toEqual(s1);
    });

    it('rollback : écriture dans une transaction annulée → aucune trace', async () => {
      const id = await seedOrder({ declared: true, marginRealCostKmf: 5000 });
      const before = await snap(id);
      on({ CANONICAL_MARGIN_WRITE_PROVISIONAL: 1 });
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const r = await writer.applyCanonicalMargin(id, { client });
        expect(r.wrote).toBe(true);
        await client.query('ROLLBACK');
      } finally { client.release(); }
      expect(await snap(id)).toEqual(before);
    });

    it('n\'écrit ni cost_real_kmf, ni cost_closed_at ; sourcing_blocked jamais posé', async () => {
      const id = await seedOrder({ declared: true });
      on({ CANONICAL_MARGIN_WRITE_PROVISIONAL: 1 });
      const before = await snap(id);
      await writer.applyCanonicalMargin(id);
      const after = await snap(id);
      expect(after.cost_real_kmf).toEqual(before.cost_real_kmf);
      expect(after.cost_closed_at).toEqual(before.cost_closed_at);
      expect(after.sourcing_blocked).toBe(false);
    });
  });
}
