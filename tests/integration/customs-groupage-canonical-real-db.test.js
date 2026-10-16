'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/customs-groupage-canonical-real-db.test.js
 *
 * Feature propriétaire : economic-engine
 *
 * Groupage canonique : matrice des variations sur vraie base, en complément de #2554 → #2577 —
 * unicité du rattachement colis ↔ expédition active, méthodes de répartition (CIF / poids / volume /
 * mixte / manuelle), conservation au centime, retrait de colis, correction tardive tracée,
 * verrouillage après confirmation, isolation de marché.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('GROUPAGE CANONIQUE — REAL_DB — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const svc = require('../../services/customs-shipment-service');

  jest.setTimeout(40000);

  const RUN_TAG = `e2e_test_grp_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const ids = { orders: [], parcels: [], products: [], relais: [], shipments: [] };
  let marketId;
  let otherMarketId;
  let seq = 0;

  async function seedRelais(mkt) {
    const relaisId = crypto.randomUUID();
    ids.relais.push(relaisId);
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
       VALUES ($1, $2, 'E2E Agent', '+269000111', 'Moroni Test', 'Ngazidja', $3)`,
      [relaisId, `E2E Grp Relais ${RUN_TAG}-${++seq}`, mkt]
    );
    return relaisId;
  }

  // specs : [{ order: 'A', cif, weight, vol }] -> un colis (in_transit) et un article par entrée.
  async function seedParcels(specs, mkt = marketId) {
    const relaisId = await seedRelais(mkt);
    const orders = new Map();
    const out = [];
    for (const s of specs) {
      if (!orders.has(s.order)) {
        const orderId = crypto.randomUUID();
        ids.orders.push(orderId);
        await db.query(
          `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
           VALUES ($1, $2, NULL, $3, $4, 100000, 'cash_relais', 'paid', 'confirmed')`,
          [orderId, `${RUN_TAG}-o-${++seq}`, relaisId, mkt]
        );
        orders.set(s.order, orderId);
      }
      const orderId = orders.get(s.order);
      const productId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const parcelId = crypto.randomUUID();
      ids.products.push(productId); ids.parcels.push(parcelId);
      await db.query(`INSERT INTO products (id, name, price_kmf, stock, weight_kg, cost_kmf) VALUES ($1, $2, 10000, 100, 1, 4000)`,
        [productId, `E2E Grp Produit ${RUN_TAG}-${++seq}`]);
      await db.query(`INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf) VALUES ($1, $2, $3, 1, 10000)`, [itemId, orderId, productId]);
      await db.query(
        `INSERT INTO parcels (id, order_id, reference, status, customs_value_kmf, customs_weight_kg, volume_cm3)
         VALUES ($1, $2, $3, 'in_transit', $4, $5, $6)`,
        [parcelId, orderId, `${RUN_TAG}-p-${++seq}`, s.cif, s.weight, s.vol]);
      await db.query(`INSERT INTO parcel_items (id, parcel_id, order_item_id, product_id, quantity, qty_allocated) VALUES ($1, $2, $3, $4, 1, 1)`,
        [crypto.randomUUID(), parcelId, itemId, productId]);
      out.push({ parcelId, orderId });
    }
    return out;
  }

  async function makeShipment(parcels, extra = {}, mkt = marketId) {
    const { shipment } = await svc.createShipment(db, {
      reference: `${RUN_TAG}-s-${++seq}`, shipment_date: '2026-10-01', cif_value_kmf: 100000,
      transport_mode: 'sea', parcel_ids: parcels.map((p) => p.parcelId), ...extra,
    }, null, { marketId: mkt });
    ids.shipments.push(shipment.id);
    return shipment;
  }

  const allocTotal = async (shipmentId, type) => Number((await db.query(
    `SELECT COALESCE(SUM(amount_kmf),0) AS t FROM order_item_real_cost_allocations
      WHERE shipment_id = $1 AND cost_type = $2 AND is_actual = TRUE`, [shipmentId, type])).rows[0].t);
  const allocByOrder = async (shipmentId, type) => Object.fromEntries((await db.query(
    `SELECT order_id, SUM(amount_kmf) AS t FROM order_item_real_cost_allocations
      WHERE shipment_id = $1 AND cost_type = $2 AND is_actual = TRUE GROUP BY order_id`, [shipmentId, type])).rows.map((r) => [r.order_id, Number(r.t)]));

  beforeAll(async () => {
    const { rows } = await db.query(`SELECT id, code FROM markets ORDER BY (code = 'KM') DESC, code LIMIT 2`);
    marketId = rows[0].id;
    otherMarketId = rows[1] ? rows[1].id : null;
  });

  afterAll(async () => {
    const q = (sql, p) => db.query(sql, p).catch(() => {});
    await q('SET session_replication_role = replica');
    await q('DELETE FROM customs_shipment_fees WHERE shipment_id = ANY($1::uuid[])', [ids.shipments]);
    await q('DELETE FROM customs_shipment_financial_audit WHERE shipment_id = ANY($1::uuid[])', [ids.shipments]);
    await q('DELETE FROM order_item_real_cost_allocations WHERE order_id = ANY($1::uuid[])', [ids.orders]);
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

  describe('groupage canonique — unicité du rattachement', () => {
    it('G1 — un colis déjà dans une expédition active ne peut pas être rattaché à une seconde', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }, { order: 'B', cif: 10000, weight: 1, vol: 1000 }]);
      await makeShipment(ps, { allocation_method: 'by_cif_value', customs_paid_kmf: 1000 });
      await expect(makeShipment([ps[0]], { allocation_method: 'by_cif_value', customs_paid_kmf: 500 }))
        .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_PARCEL_ALREADY_GROUPED' });
    });

    it('G1b — rattachement en pending puis déclaration : le même colis ne peut pas porter deux expéditions actives', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }]);
      await makeShipment(ps, { allocation_method: 'by_cif_value' });
      await expect(makeShipment(ps, { allocation_method: 'by_cif_value' }))
        .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_PARCEL_ALREADY_GROUPED' });
    });
  });

  describe('groupage canonique — éligibilité des colis', () => {
    it('G9 — un colis annulé ou d\'une commande annulée ne peut pas être rattaché', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }, { order: 'B', cif: 10000, weight: 1, vol: 1000 }]);
      await db.query(`UPDATE parcels SET status = 'cancelled' WHERE id = $1`, [ps[0].parcelId]);
      await expect(makeShipment([ps[0]], { allocation_method: 'by_cif_value', customs_paid_kmf: 500 }))
        .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_PARCEL_NOT_ELIGIBLE' });
      await db.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [ps[1].orderId]);
      await expect(makeShipment([ps[1]], { allocation_method: 'by_cif_value', customs_paid_kmf: 500 }))
        .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_PARCEL_NOT_ELIGIBLE' });
    });
  });

  describe('groupage canonique — méthodes de répartition et conservation', () => {
    const SPECS = [
      { order: 'A', cif: 3333, weight: 2.5, vol: 40000 },
      { order: 'A', cif: 6667, weight: 1.25, vol: 10000 },
      { order: 'B', cif: 1, weight: 7, vol: 90000 },
    ];
    for (const method of ['by_cif_value', 'by_weight', 'by_volume', 'mixed']) {
      it(`G2 — ${method} : droits 1000.01 conservés au centime, parts colis = parts commandes`, async () => {
        const ps = await seedParcels(SPECS);
        const s = await makeShipment(ps, { allocation_method: method, customs_paid_kmf: '1000.01', freight_kmf: '300.07' });
        expect(Math.round((await allocTotal(s.id, 'customs')) * 100)).toBe(100001);
        expect(Math.round((await allocTotal(s.id, 'freight')) * 100)).toBe(30007);
        const { rows: [c] } = await db.query(
          `SELECT ROUND(SUM(customs_share_kmf) * 100)::int AS cents FROM customs_shipment_parcels WHERE shipment_id = $1`, [s.id]);
        expect(c.cents).toBe(100001);
        const byOrder = await allocByOrder(s.id, 'customs');
        const { rows: shares } = await db.query(
          `SELECT p.order_id, ROUND(SUM(csp.customs_share_kmf) * 100)::int AS cents
             FROM customs_shipment_parcels csp JOIN parcels p ON p.id = csp.parcel_id WHERE csp.shipment_id = $1 GROUP BY p.order_id`, [s.id]);
        for (const r of shares) expect(Math.round(byOrder[r.order_id] * 100)).toBe(r.cents);
      });
    }

    it('G3 — manual : sans part saisie, la déclaration d\'un montant > 0 est refusée (rien d\'écrit)', async () => {
      const ps = await seedParcels(SPECS);
      await expect(makeShipment(ps, { allocation_method: 'manual', customs_paid_kmf: 1000 }))
        .rejects.toMatchObject({ status: 422, code: 'COST_ALLOCATION_INCOMPLETE' });
    });

    it('G4 — zéro confirmé ≠ inconnu : 0 ventile des parts nulles ; NULL ne ventile rien', async () => {
      const ps = await seedParcels(SPECS);
      const z = await makeShipment(ps, { allocation_method: 'by_weight', customs_paid_kmf: 0 });
      expect(z.status).toBe('declared');
      expect(await allocTotal(z.id, 'customs')).toBe(0);
      const ps2 = await seedParcels(SPECS);
      const u = await makeShipment(ps2, { allocation_method: 'by_weight' });
      expect(u.status).toBe('pending');
      expect(u.customs_paid_kmf).toBeNull();
      expect((await db.query('SELECT COUNT(*)::int n FROM order_item_real_cost_allocations WHERE shipment_id = $1', [u.id])).rows[0].n).toBe(0);
    });
  });

  describe('groupage canonique — retrait, correction tardive, verrouillage, marché', () => {
    it('G5 — retrait de colis : désactivation puis réactivation sur un sous-ensemble, conservation sur les colis restants', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }, { order: 'B', cif: 10000, weight: 1, vol: 1000 }, { order: 'C', cif: 10000, weight: 1, vol: 1000 }]);
      const s = await makeShipment(ps, { allocation_method: 'by_cif_value', customs_paid_kmf: 900 });
      await svc.deactivateShipment(db, s.id, 'retrait colis C');
      expect(await allocTotal(s.id, 'customs')).toBe(0);
      await svc.activateShipment(db, s.id, [ps[0].parcelId, ps[1].parcelId]);
      expect(await allocTotal(s.id, 'customs')).toBe(900);
      const byOrder = await allocByOrder(s.id, 'customs');
      expect(byOrder[ps[2].orderId]).toBeUndefined();
      expect(byOrder[ps[0].orderId]).toBe(450);
      // le colis retiré n'est plus rattaché : une reventilation ultérieure ne le réintroduit pas
      const { rows: [linked] } = await db.query('SELECT COUNT(*)::int AS n FROM customs_shipment_parcels WHERE shipment_id = $1', [s.id]);
      expect(linked.n).toBe(2);
      await svc.updateShipment(db, s.id, { customs_paid_kmf: 1000 }, {});
      expect((await allocByOrder(s.id, 'customs'))[ps[2].orderId]).toBeUndefined();
      expect(await allocTotal(s.id, 'customs')).toBe(1000);
    });

    it('G6 — correction tardive du montant sur une expédition déclarée : réallocation conservée + journal d\'audit', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }, { order: 'B', cif: 20000, weight: 1, vol: 1000 }]);
      const s = await makeShipment(ps, { allocation_method: 'by_cif_value', customs_paid_kmf: 900 });
      await svc.updateShipment(db, s.id, { customs_paid_kmf: 1200 }, { actorId: null, reason: 'correction facture transitaire' });
      expect(await allocTotal(s.id, 'customs')).toBe(1200);
      const { rows: [a] } = await db.query('SELECT COUNT(*)::int n FROM customs_shipment_financial_audit WHERE shipment_id = $1', [s.id]);
      expect(a.n).toBeGreaterThanOrEqual(1);
    });

    it('G7 — expédition confirmée : montant verrouillé (409)', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }]);
      const s = await makeShipment(ps, { allocation_method: 'by_cif_value', customs_paid_kmf: 500 });
      await db.query(`UPDATE customs_shipments SET status = 'confirmed' WHERE id = $1`, [s.id]);
      await expect(svc.updateShipment(db, s.id, { customs_paid_kmf: 700 }, {})).rejects.toMatchObject({ status: 409 });
      expect(await allocTotal(s.id, 'customs')).toBe(500);
    });

    it('G8 — isolation de marché : colis d\'un autre marché refusé, rien d\'écrit', async () => {
      if (!otherMarketId) return;
      const foreign = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }], otherMarketId);
      await expect(makeShipment(foreign, { allocation_method: 'by_cif_value', customs_paid_kmf: 500 }, marketId))
        .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_PARCEL_MARKET_MISMATCH' });
    });
  });
}
