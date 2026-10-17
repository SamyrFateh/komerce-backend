'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/customs-certification-real-db.test.js
 *
 * Feature propriétaire : economic-engine
 *
 * DOUANE-2D — certification de bout en bout, en complément des preuves existantes (cycle de vie,
 * frais typés, conservation, marge shadow) : groupage multi-commandes (droits + fret + frais),
 * conservation entre commandes, idempotence, marge shadow par commande vs état opérationnel
 * inchangé, commande annulée (not_applicable), correction à la baisse, zéro confirmé sans effet.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);
// A8 : règles applicatives contrôlées par le test (défaut = writer désactivé).
let mockRules = {};
jest.mock('../../utils/rules', () => ({
  ...jest.requireActual('../../utils/rules'),
  getRuleNumber: async (k, d) => (k in mockRules ? mockRules[k] : d),
}));

if (!hasIntegrationEnv) {
  describe.skip('CUSTOMS CERTIFICATION — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const svc = require('../../services/customs-shipment-service');
  const fees = require('../../services/customs-shipment-fee-service');
  const { computeOrderRealMarginShadow } = require('../../services/cost-allocation/real-margin-shadow');
  const { allocateShipmentRealCosts } = require('../../services/cost-allocation');

  jest.setTimeout(30000);

  const RUN_TAG = `e2e_test_dcert_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const ids = { orders: [], parcels: [], products: [], relais: [], shipments: [] };
  let marketId;
  let seq = 0;

  const BREAKDOWN = { landed_relay: { product_purchase: 4000, freight: 0, customs: 0 }, business: { payment: 0, risk_provision: 0 } };

  // Groupage : 1 expédition, 2 commandes (A : 2 colis, B : 1 colis), CIF égal par colis (10000).
  async function seedGroupage() {
    seq += 1;
    const relaisId = crypto.randomUUID();
    const shipmentId = crypto.randomUUID();
    ids.relais.push(relaisId); ids.shipments.push(shipmentId);
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
       VALUES ($1, $2, 'E2E Agent', '+269000111', 'Moroni Test', 'Ngazidja', $3)`,
      [relaisId, `E2E DCert Relais ${RUN_TAG}-${seq}`, marketId]
    );
    await db.query(
      `INSERT INTO customs_shipments
         (id, reference, shipment_date, transport_mode, cif_value_kmf, customs_paid_kmf, freight_kmf, allocation_method, status, market_id)
       VALUES ($1, $2, CURRENT_DATE, 'sea', 30000, NULL, NULL, 'by_cif_value', 'pending', $3)`,
      [shipmentId, `${RUN_TAG}-ship-${seq}`, marketId]
    );
    const orders = [];
    for (const nParcels of [2, 1]) {
      const orderId = crypto.randomUUID();
      const productId = crypto.randomUUID();
      ids.orders.push(orderId); ids.products.push(productId); orders.push(orderId);
      await db.query(
        `INSERT INTO products (id, name, price_kmf, stock, weight_kg, cost_kmf) VALUES ($1, $2, 10000, 100, 1, 4000)`,
        [productId, `E2E DCert Produit ${RUN_TAG}-${seq}-${orders.length}`]
      );
      await db.query(
        `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
         VALUES ($1, $2, NULL, $3, $4, $5, 'cash_relais', 'paid', 'confirmed')`,
        [orderId, `${RUN_TAG}-order-${seq}-${orders.length}`, relaisId, marketId, 10000 * nParcels]
      );
      for (let p = 0; p < nParcels; p++) {
        const itemId = crypto.randomUUID();
        const parcelId = crypto.randomUUID();
        ids.parcels.push(parcelId);
        await db.query(
          `INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf) VALUES ($1, $2, $3, 1, 10000)`,
          [itemId, orderId, productId]
        );
        await db.query(
          `INSERT INTO order_item_cost_imputations
             (order_id, order_item_id, product_id, quantity, sale_unit_price_kmf, sale_total_kmf,
              estimated_landed_relay_cost_kmf, estimated_business_variable_cost_kmf, estimated_business_complete_cost_kmf, cost_breakdown)
           VALUES ($1, $2, $3, 1, 10000, 10000, 4000, 4000, 4000, $4::jsonb)`,
          [orderId, itemId, productId, JSON.stringify(BREAKDOWN)]
        );
        await db.query(`INSERT INTO parcels (id, order_id, reference, status) VALUES ($1, $2, $3, 'in_transit')`, [parcelId, orderId, `${RUN_TAG}-parcel-${seq}-${orders.length}-${p}`]);
        await db.query(
          `INSERT INTO parcel_items (id, parcel_id, order_item_id, product_id, quantity, qty_allocated) VALUES ($1, $2, $3, $4, 1, 1)`,
          [crypto.randomUUID(), parcelId, itemId, productId]
        );
        await db.query(
          `INSERT INTO customs_shipment_parcels (shipment_id, parcel_id, parcel_cif_kmf, parcel_weight_kg) VALUES ($1, $2, 10000, 1)`,
          [shipmentId, parcelId]
        );
      }
    }
    return { shipmentId, orderA: orders[0], orderB: orders[1] };
  }

  const sumAlloc = async (orderId, type) => {
    const { rows: [r] } = await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_kmf),0)::float AS total
         FROM order_item_real_cost_allocations WHERE order_id = $1 AND cost_type = $2 AND is_actual = TRUE`, [orderId, type]);
    return r;
  };
  const legacyState = async (orderIds) => (await db.query(
    `SELECT id, margin_real_pct, margin_alert, sourcing_blocked, cost_real_kmf, total_kmf
       FROM orders WHERE id = ANY($1::uuid[]) ORDER BY id`, [orderIds])).rows;
  const fee = (shipmentId, type, amount, key, kind = 'charge') =>
    fees.recordFee(db, shipmentId, { fee_type: type, kind, amount_kmf: amount, currency: 'KMF', proof_ref: `FACT-${key}`, idempotency_key: `${RUN_TAG}-${key}` }, null);

  beforeAll(async () => {
    const { rows: [m] } = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    marketId = m.id;
  });

  afterAll(async () => {
    const q = (sql, p) => db.query(sql, p).catch(() => {});
    await q('SET session_replication_role = replica');
    await q('DELETE FROM customs_shipment_fees WHERE shipment_id = ANY($1::uuid[])', [ids.shipments]);
    await q('DELETE FROM customs_shipment_financial_audit WHERE shipment_id = ANY($1::uuid[])', [ids.shipments]);
    await q('SET session_replication_role = origin');
    await q('DELETE FROM order_item_real_cost_allocations WHERE order_id = ANY($1::uuid[])', [ids.orders]);
    await q('DELETE FROM order_item_cost_imputations WHERE order_id = ANY($1::uuid[])', [ids.orders]);
    await q('DELETE FROM customs_shipment_parcels WHERE shipment_id = ANY($1::uuid[])', [ids.shipments]);
    await q('DELETE FROM customs_shipments WHERE id = ANY($1::uuid[])', [ids.shipments]);
    await q('DELETE FROM parcel_items WHERE parcel_id = ANY($1::uuid[])', [ids.parcels]);
    await q('SET session_replication_role = replica');
    await q('DELETE FROM parcels WHERE id = ANY($1::uuid[])', [ids.parcels]);
    await q('SET session_replication_role = origin');
    await q('DELETE FROM order_items WHERE order_id = ANY($1::uuid[])', [ids.orders]);
    await q('DELETE FROM orders WHERE id = ANY($1::uuid[])', [ids.orders]);
    await q('DELETE FROM products WHERE id = ANY($1::uuid[])', [ids.products]);
    await q('DELETE FROM relais WHERE id = ANY($1::uuid[])', [ids.relais]);
  });

  describe('certification douane — groupage multi-commandes (REAL_DB)', () => {
    let g; let afterDeclare;

    beforeAll(async () => {
      g = await seedGroupage();
    });

    it('1 — avant déclaration : tout est inconnu, aucune allocation, marge shadow incomplète', async () => {
      expect((await sumAlloc(g.orderA, 'customs')).n).toBe(0);
      const a = await computeOrderRealMarginShadow(g.orderA);
      expect(a.completeness).toBe('incomplete');
      expect(a.costs.unknown_types).toContain('customs');
      expect(a.margin.shadow_pct).toBeNull();
    });

    it('2 — droits + fret + frais multiples : conservation exacte entre les 2 commandes, sans doublon', async () => {
      await svc.declareCustomsPayment(db, g.shipmentId, { customs_paid_kmf: 1000, freight_kmf: 300 }, null);
      // La déclaration pose l'état opérationnel historique (recomputeCustomsCosts, inchangé) :
      // c'est la référence que les frais ne doivent plus modifier.
      afterDeclare = await legacyState([g.orderA, g.orderB]);
      await fee(g.shipmentId, 'handling', '100.01', 'h1');
      await fee(g.shipmentId, 'forwarder', '50', 'f1');

      // A porte 2 colis sur 3, B 1 sur 3 ; chaque total conservé au centime.
      const cA = await sumAlloc(g.orderA, 'customs'); const cB = await sumAlloc(g.orderB, 'customs');
      expect(cA.total + cB.total).toBeCloseTo(1000, 2);
      // le centime résiduel est attribué à un colis dans l'ordre des identifiants (aléatoires) : A ∈ {666.66, 666.67}
      expect([66666, 66667]).toContain(Math.round(cA.total * 100));
      const fA = await sumAlloc(g.orderA, 'freight'); const fB = await sumAlloc(g.orderB, 'freight');
      expect(fA.total + fB.total).toBeCloseTo(300, 2);
      const pA = await sumAlloc(g.orderA, 'port_transitaire'); const pB = await sumAlloc(g.orderB, 'port_transitaire');
      expect(Math.round((pA.total + pB.total) * 100)).toBe(15001);
      // une ligne par article (3 articles) et par type : aucun doublon
      expect(cA.n + cB.n).toBe(3);
      expect(pA.n + pB.n).toBe(3);
      // les frais n'ont modifié aucune donnée opérationnelle posée par la déclaration
      expect(await legacyState([g.orderA, g.orderB])).toEqual(afterDeclare);
    });

    it('3 — rejouer l\'allocation ne change rien (idempotence)', async () => {
      const snap = async () => JSON.stringify([await sumAlloc(g.orderA, 'customs'), await sumAlloc(g.orderB, 'port_transitaire')]);
      const s1 = await snap();
      const client = await db.connect();
      try { await client.query('BEGIN'); await allocateShipmentRealCosts(g.shipmentId, client); await client.query('COMMIT'); }
      finally { client.release(); }
      expect(await snap()).toBe(s1);
    });

    it('4 — marge shadow par commande : réel + estimé, frais pris en compte ; état opérationnel strictement inchangé', async () => {
      const a = await computeOrderRealMarginShadow(g.orderA);
      const b = await computeOrderRealMarginShadow(g.orderB);
      expect(a.completeness).toBe('provisional');
      expect(a.costs.by_type.customs.state).toBe('real');
      // le shadow arrondit au KMF entier ; la somme des deux commandes reste égale au total déclaré
      expect(a.costs.by_type.customs.real_kmf + b.costs.by_type.customs.real_kmf).toBe(1000);
      // le shadow ne remplace pas l'opérationnel : il le compare sans le modifier
      expect(a.legacy.margin_real_pct).toBe(afterDeclare.find((o) => o.id === g.orderA).margin_real_pct);
      expect(await legacyState([g.orderA, g.orderB])).toEqual(afterDeclare);
    });

    it('5 — correction à la baisse (credit) : réallocation conservée, historique des frais conservé', async () => {
      await fee(g.shipmentId, 'handling', '40.01', 'c1', 'credit');
      const pA = await sumAlloc(g.orderA, 'port_transitaire'); const pB = await sumAlloc(g.orderB, 'port_transitaire');
      expect(Math.round((pA.total + pB.total) * 100)).toBe(11000);
      const { rows: [c] } = await db.query('SELECT COUNT(*)::int AS n FROM customs_shipment_fees WHERE shipment_id = $1', [g.shipmentId]);
      expect(c.n).toBe(3);
      expect(await legacyState([g.orderA, g.orderB])).toEqual(afterDeclare);
    });

    it('6 — zéro confirmé : aucune allocation ajoutée, totaux inchangés', async () => {
      const b0 = await sumAlloc(g.orderB, 'port_transitaire');
      await fee(g.shipmentId, 'storage', '0', 'z1');
      expect(await sumAlloc(g.orderB, 'port_transitaire')).toEqual(b0);
    });

    it('7 — commande annulée : marge shadow not_applicable, l\'autre commande intacte', async () => {
      const cBefore = await sumAlloc(g.orderA, 'customs');
      await db.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [g.orderB]);
      const b = await computeOrderRealMarginShadow(g.orderB);
      expect(b.completeness).toBe('not_applicable');
      expect(await sumAlloc(g.orderA, 'customs')).toEqual(cBefore);
    });
  });

  describe('A8 — writer canonique ACTIF : les événements métier écrivent la marge (REAL_DB)', () => {
    const canonical = require('../../services/cost-allocation/canonical-margin-writer');
    const { transitionOrderStatus } = require('../../services/order-status-machine');
    const marginOf = async (id) => (await db.query('SELECT margin_real_pct, margin_alert, sourcing_blocked FROM orders WHERE id = $1', [id])).rows[0];
    let g;

    beforeAll(async () => {
      mockRules = { CANONICAL_MARGIN_WRITER_ENABLED: 1, CANONICAL_MARGIN_WRITE_PROVISIONAL: 1 };
      g = await seedGroupage();
    });
    afterAll(() => { mockRules = {}; });

    it('A — douane inconnue : aucune marge écrite (NULL, jamais 0)', async () => {
      expect((await marginOf(g.orderA)).margin_real_pct).toBeNull();
    });

    it('B — déclaration douane : l\'événement écrit la marge CANONIQUE (pas la formule legacy), pour les 2 commandes', async () => {
      await svc.declareCustomsPayment(db, g.shipmentId, { customs_paid_kmf: 1000, freight_kmf: 300 }, null);
      for (const id of [g.orderA, g.orderB]) {
        const sh = await computeOrderRealMarginShadow(id);
        expect(sh.completeness).toBe('provisional');
        const m = await marginOf(id);
        expect(Number(m.margin_real_pct)).toBeCloseTo(sh.margin.shadow_pct, 2);
        const { rows: [o] } = await db.query('SELECT total_kmf, cost_transport_kmf, cost_douane_kmf FROM orders WHERE id = $1', [id]);
        const legacy = ((o.total_kmf - (o.cost_transport_kmf || 0) - (o.cost_douane_kmf || 0)) / o.total_kmf) * 100;
        expect(Number(m.margin_real_pct)).not.toBeCloseTo(legacy, 1); // l'ancien écrivain ne s'exécute plus
      }
    });

    it('C — frais supplémentaire (hausse) puis crédit (baisse) : marge recalculée à chaque événement, conservation', async () => {
      const before = Number((await marginOf(g.orderA)).margin_real_pct);
      await fee(g.shipmentId, 'handling', '300', 'w1');
      const up = Number((await marginOf(g.orderA)).margin_real_pct);
      expect(up).toBeLessThan(before);
      expect(up).toBeCloseTo((await computeOrderRealMarginShadow(g.orderA)).margin.shadow_pct, 2);
      await fee(g.shipmentId, 'handling', '300', 'w2', 'credit');
      expect(Number((await marginOf(g.orderA)).margin_real_pct)).toBeCloseTo(before, 2);
      const cA = await sumAlloc(g.orderA, 'customs'); const cB = await sumAlloc(g.orderB, 'customs');
      expect(cA.total + cB.total).toBeCloseTo(1000, 2);
    });

    it('D — idempotence : rejouer le writer n\'écrit rien', async () => {
      const r = await canonical.refreshCanonicalMarginForOrders([g.orderA, g.orderB]);
      expect(r).toMatchObject({ enabled: true, failed: 0, written: 0 });
    });

    it('E — annulation via la machine d\'état : marge canonique NULL (not_applicable), l\'autre commande intacte', async () => {
      const aBefore = await marginOf(g.orderA);
      await db.withTransaction((client) => transitionOrderStatus({
        orderId: g.orderB, newStatus: 'cancelled', actor: { id: null, role: 'system' }, source: 'cancel', dbClient: client,
      }));
      expect((await marginOf(g.orderB)).margin_real_pct).toBeNull();
      expect(await marginOf(g.orderA)).toEqual(aBefore);
      expect((await marginOf(g.orderB)).sourcing_blocked).toBe(false);
    });

    it('F — douane explicitement à ZÉRO : réel 0 (pas inconnu), marge écrite', async () => {
      const z = await seedGroupage();
      await svc.declareCustomsPayment(db, z.shipmentId, { customs_paid_kmf: 0, freight_kmf: 0 }, null);
      const sh = await computeOrderRealMarginShadow(z.orderA);
      expect(sh.costs.by_type.customs).toMatchObject({ state: 'real', real_kmf: 0 });
      expect(sh.completeness).toBe('provisional');
      expect((await marginOf(z.orderA)).margin_real_pct).not.toBeNull();
    });

    it('H — correction du montant douane à la hausse puis à la baisse : marge canonique suit, conservation exacte', async () => {
      const k = await seedGroupage();
      await svc.declareCustomsPayment(db, k.shipmentId, { customs_paid_kmf: 1000, freight_kmf: 0 }, null);
      const m0 = Number((await marginOf(k.orderA)).margin_real_pct);
      await svc.updateShipment(db, k.shipmentId, { customs_paid_kmf: 1500 }, { reason: 'correction hausse' });
      const m1 = Number((await marginOf(k.orderA)).margin_real_pct);
      expect(m1).toBeLessThan(m0);
      await svc.updateShipment(db, k.shipmentId, { customs_paid_kmf: 700 }, { reason: 'correction baisse' });
      const m2 = Number((await marginOf(k.orderA)).margin_real_pct);
      expect(m2).toBeGreaterThan(m0);
      const cA = await sumAlloc(k.orderA, 'customs'); const cB = await sumAlloc(k.orderB, 'customs');
      expect(Math.round((cA.total + cB.total) * 100)).toBe(70000);
      expect(m2).toBeCloseTo((await computeOrderRealMarginShadow(k.orderA)).margin.shadow_pct, 2);
    });

    it('G — désactivé : plus aucune écriture canonique (retour arrière) ; la prochaine déclaration repasse par l\'ancien écrivain', async () => {
      mockRules = {};
      const h = await seedGroupage();
      await svc.declareCustomsPayment(db, h.shipmentId, { customs_paid_kmf: 900, freight_kmf: 0 }, null);
      const { rows: [o] } = await db.query('SELECT total_kmf, cost_douane_kmf, cost_transport_kmf, margin_real_pct FROM orders WHERE id = $1', [h.orderA]);
      const legacy = Math.round(((o.total_kmf - (o.cost_transport_kmf || 0) - (o.cost_douane_kmf || 0)) / o.total_kmf) * 10000) / 100;
      expect(Number(o.margin_real_pct)).toBeCloseTo(legacy, 2);
      mockRules = { CANONICAL_MARGIN_WRITER_ENABLED: 1, CANONICAL_MARGIN_WRITE_PROVISIONAL: 1 };
    });
  });
}
