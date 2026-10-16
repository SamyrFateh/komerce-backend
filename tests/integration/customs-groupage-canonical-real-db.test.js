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
  const feeSvc = require('../../services/customs-shipment-fee-service');

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
    await q('DELETE FROM customs_shipment_parcel_events WHERE shipment_id = ANY($1::uuid[])', [ids.shipments]);
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

  describe('A1/A2 — composition directe du groupage (ajout / retrait avant clôture)', () => {
    const setStatus = (parcelId, status) => db.query(
      'UPDATE parcels p SET status = $2, relais_id = o.relais_id FROM orders o WHERE o.id = p.order_id AND p.id = $1', [parcelId, status]);
    const events = async (shipmentId) => (await db.query(
      'SELECT parcel_id, event, reason, actor_id FROM customs_shipment_parcel_events WHERE shipment_id = $1 ORDER BY id', [shipmentId])).rows;
    const legacy = async (orderIds) => (await db.query(
      'SELECT id, margin_alert, sourcing_blocked, total_kmf FROM orders WHERE id = ANY($1::uuid[]) ORDER BY id', [orderIds])).rows;

    it('A2 — seuls les colis shipped / in_transit sont groupables ; préparation et arrivé refusés', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }, { order: 'B', cif: 10000, weight: 1, vol: 1000 }, { order: 'C', cif: 10000, weight: 1, vol: 1000 }]);
      await setStatus(ps[0].parcelId, 'preparation');
      await setStatus(ps[1].parcelId, 'arrived');
      await setStatus(ps[2].parcelId, 'shipped');
      for (const p of [ps[0], ps[1]]) {
        await expect(makeShipment([p], { allocation_method: 'by_cif_value' })).rejects.toMatchObject({ status: 409, code: 'CUSTOMS_PARCEL_NOT_ELIGIBLE' });
      }
      const s = await makeShipment([ps[2]], { allocation_method: 'by_cif_value', customs_paid_kmf: 300 });
      // arrivée après groupage : ne bloque ni la correction ni la réventilation
      await setStatus(ps[2].parcelId, 'arrived');
      await svc.updateShipment(db, s.id, { customs_paid_kmf: 400 }, {});
      expect(await allocTotal(s.id, 'customs')).toBe(400);
    });

    it('A1 — ajout sur expédition déclarée : reventilation conservée, événement tracé, idempotent', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }, { order: 'B', cif: 10000, weight: 1, vol: 1000 }, { order: 'C', cif: 10000, weight: 1, vol: 1000 }]);
      const s = await makeShipment([ps[0], ps[1]], { allocation_method: 'by_cif_value', customs_paid_kmf: 900 });
      const before = await legacy(ps.map((p) => p.orderId));
      const r = await svc.addParcelsToShipment(db, s.id, [ps[2].parcelId], { id: null, reason: 'colis C arrivé au quai' });
      expect(r.added).toEqual([ps[2].parcelId]);
      expect(await allocTotal(s.id, 'customs')).toBe(900);
      const byOrder = await allocByOrder(s.id, 'customs');
      expect(byOrder[ps[2].orderId]).toBe(300);
      expect(byOrder[ps[0].orderId]).toBe(300);
      expect(await events(s.id)).toEqual([{ parcel_id: ps[2].parcelId, event: 'attach', reason: 'colis C arrivé au quai', actor_id: null }]);
      // rejeu : aucun changement, aucun événement supplémentaire
      const again = await svc.addParcelsToShipment(db, s.id, [ps[2].parcelId], { reason: 'rejeu' });
      expect(again.idempotent).toBe(true);
      expect((await events(s.id)).length).toBe(1);
      expect(await allocTotal(s.id, 'customs')).toBe(900);
      // prix, alertes, sourcing inchangés
      expect(await legacy(ps.map((p) => p.orderId))).toEqual(before);
    });

    it('A1 — retrait sur expédition déclarée : conservation sur les colis restants, événement detach, pas de dernier colis', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }, { order: 'B', cif: 20000, weight: 1, vol: 1000 }]);
      const s = await makeShipment(ps, { allocation_method: 'by_cif_value', customs_paid_kmf: 900, freight_kmf: 90 });
      await svc.removeParcelsFromShipment(db, s.id, [ps[0].parcelId], { id: null, reason: 'colis A retiré du conteneur' });
      expect(await allocTotal(s.id, 'customs')).toBe(900);
      expect(await allocTotal(s.id, 'freight')).toBe(90);
      expect((await allocByOrder(s.id, 'customs'))[ps[0].orderId]).toBeUndefined();
      expect((await events(s.id)).map((e) => e.event)).toEqual(['detach']);
      await expect(svc.removeParcelsFromShipment(db, s.id, [ps[1].parcelId], { reason: 'vider' }))
        .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_SHIPMENT_WITHOUT_PARCELS' });
      await expect(svc.removeParcelsFromShipment(db, s.id, [ps[0].parcelId], { reason: 'déjà retiré' }))
        .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_PARCEL_NOT_IN_SHIPMENT' });
      expect(await allocTotal(s.id, 'customs')).toBe(900);
    });

    it('A1 — pending : rattachement sans ventilation fabriquée ; reason obligatoire ; clôturée et désactivée refusées', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }, { order: 'B', cif: 10000, weight: 1, vol: 1000 }]);
      const s = await makeShipment([ps[0]], { allocation_method: 'by_cif_value' });
      await svc.addParcelsToShipment(db, s.id, [ps[1].parcelId], { reason: 'ajout pending' });
      expect((await db.query('SELECT COUNT(*)::int n FROM order_item_real_cost_allocations WHERE shipment_id = $1', [s.id])).rows[0].n).toBe(0);
      await expect(svc.addParcelsToShipment(db, s.id, [ps[1].parcelId], {})).rejects.toMatchObject({ status: 400, code: 'CUSTOMS_MEMBERSHIP_REASON_REQUIRED' });
      await svc.declareCustomsPayment(db, s.id, { customs_paid_kmf: 600 }, null);
      await db.query(`UPDATE customs_shipments SET status = 'confirmed' WHERE id = $1`, [s.id]);
      await expect(svc.removeParcelsFromShipment(db, s.id, [ps[1].parcelId], { reason: 'après clôture' }))
        .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_SHIPMENT_CLOSED' });
      expect(await allocTotal(s.id, 'customs')).toBe(600);
      const ps2 = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }]);
      const s2 = await makeShipment(ps2, { allocation_method: 'by_cif_value' });
      await svc.deactivateShipment(db, s2.id, 'test');
      await expect(svc.addParcelsToShipment(db, s2.id, [ps2[0].parcelId], { reason: 'x' })).rejects.toMatchObject({ status: 409, code: 'CUSTOMS_SHIPMENT_INACTIVE' });
    });

    it('A1 — concurrence : le même colis ajouté en parallèle à deux expéditions n\'est accepté qu\'une fois', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }, { order: 'B', cif: 10000, weight: 1, vol: 1000 }, { order: 'C', cif: 10000, weight: 1, vol: 1000 }]);
      const s1 = await makeShipment([ps[0]], { allocation_method: 'by_cif_value' });
      const s2 = await makeShipment([ps[1]], { allocation_method: 'by_cif_value' });
      const res = await Promise.allSettled([
        svc.addParcelsToShipment(db, s1.id, [ps[2].parcelId], { reason: 'course 1' }),
        svc.addParcelsToShipment(db, s2.id, [ps[2].parcelId], { reason: 'course 2' }),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = res.find((r) => r.status === 'rejected');
      expect(lost.reason).toMatchObject({ code: 'CUSTOMS_PARCEL_ALREADY_GROUPED' });
      const { rows: [c] } = await db.query('SELECT COUNT(*)::int n FROM customs_shipment_parcels WHERE parcel_id = $1', [ps[2].parcelId]);
      expect(c.n).toBe(1);
    });

    it('A1 — le journal des événements est immuable', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 10000, weight: 1, vol: 1000 }, { order: 'B', cif: 10000, weight: 1, vol: 1000 }]);
      const s = await makeShipment([ps[0]], { allocation_method: 'by_cif_value' });
      await svc.addParcelsToShipment(db, s.id, [ps[1].parcelId], { reason: 'preuve' });
      await expect(db.query('UPDATE customs_shipment_parcel_events SET reason = $2 WHERE shipment_id = $1', [s.id, 'x'])).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM customs_shipment_parcel_events WHERE shipment_id = $1', [s.id])).rejects.toThrow(/append-only/);
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

    it('G3b — manual : parts saisies, somme exacte au centime, ventilation sur les articles, audit tracé', async () => {
      const ps = await seedParcels(SPECS);
      const shares = [
        { parcel_id: ps[0].parcelId, customs_share_kmf: '400.01' },
        { parcel_id: ps[1].parcelId, customs_share_kmf: '300' },
        { parcel_id: ps[2].parcelId, customs_share_kmf: '300' },
      ];
      const s = await makeShipment(ps, { allocation_method: 'manual', customs_paid_kmf: '1000.01', parcel_shares: shares });
      expect(Math.round((await allocTotal(s.id, 'customs')) * 100)).toBe(100001);
      const { rows } = await db.query(
        'SELECT parcel_id, customs_share_kmf, manual_override, allocation_basis FROM customs_shipment_parcels WHERE shipment_id = $1', [s.id]);
      expect(rows.every((r) => r.manual_override === true && r.allocation_basis === 'manual')).toBe(true);
      expect(Number(rows.find((r) => r.parcel_id === ps[0].parcelId).customs_share_kmf)).toBe(400.01);
      expect((await allocByOrder(s.id, 'customs'))[ps[2].orderId]).toBe(300);
    });

    it('G3c — manual : somme ≠ montant, colis manquant/inconnu, montant invalide → refus, rien d\'écrit', async () => {
      const ps = await seedParcels(SPECS);
      const mk = (a, b, c) => [
        { parcel_id: ps[0].parcelId, customs_share_kmf: a },
        { parcel_id: ps[1].parcelId, customs_share_kmf: b },
        { parcel_id: ps[2].parcelId, customs_share_kmf: c },
      ];
      await expect(makeShipment(ps, { allocation_method: 'manual', customs_paid_kmf: 1000, parcel_shares: mk(400, 300, 299.99) }))
        .rejects.toMatchObject({ status: 422, code: 'COST_ALLOCATION_INCOMPLETE' });
      await expect(makeShipment(ps, { allocation_method: 'manual', customs_paid_kmf: 1000, parcel_shares: mk(500, 500, 0).slice(0, 2) }))
        .rejects.toMatchObject({ status: 422, code: 'COST_ALLOCATION_INCOMPLETE' });
      await expect(makeShipment(ps, { allocation_method: 'manual', customs_paid_kmf: 1000, parcel_shares: mk(-1, 500, 501) }))
        .rejects.toMatchObject({ status: 400, code: 'CUSTOMS_SHARES_INVALID' });
      await expect(makeShipment(ps, { allocation_method: 'manual', customs_paid_kmf: 1000, parcel_shares: mk(333.333, 333, 333.667) }))
        .rejects.toMatchObject({ status: 400, code: 'CUSTOMS_SHARES_INVALID' });
      await expect(makeShipment(ps, { allocation_method: 'by_weight', customs_paid_kmf: 1000, parcel_shares: mk(1, 1, 998) }))
        .rejects.toMatchObject({ status: 400, code: 'CUSTOMS_SHARES_REQUIRE_MANUAL' });
    });

    it('G3d — manual : correction du montant et retrait de colis exigent de nouvelles parts ; ajout/retrait avec parts conservés', async () => {
      const ps = await seedParcels(SPECS);
      const sh = (arr) => arr.map(([i, v]) => ({ parcel_id: ps[i].parcelId, customs_share_kmf: v }));
      const s = await makeShipment(ps, { allocation_method: 'manual', customs_paid_kmf: 1000, parcel_shares: sh([[0, 500], [1, 300], [2, 200]]) });
      // montant modifié sans nouvelles parts : refus, ventilation précédente intacte
      await expect(svc.updateShipment(db, s.id, { customs_paid_kmf: 1200 }, {})).rejects.toMatchObject({ status: 422 });
      expect(await allocTotal(s.id, 'customs')).toBe(1000);
      // montant + parts : accepté, trace d'audit
      await svc.updateShipment(db, s.id, { customs_paid_kmf: 1200, parcel_shares: sh([[0, 600], [1, 300], [2, 300]]), reason: 'facture rectifiée' }, {});
      expect(await allocTotal(s.id, 'customs')).toBe(1200);
      const { rows: [a] } = await db.query(
        `SELECT COUNT(*)::int n FROM customs_shipment_financial_audit WHERE shipment_id = $1 AND new_values->'allocation_config'->'manual_shares' IS NOT NULL`, [s.id]);
      expect(a.n).toBeGreaterThanOrEqual(1);
      // retrait sans parts à jour : refus ; avec parts : conservé
      await expect(svc.removeParcelsFromShipment(db, s.id, [ps[2].parcelId], { reason: 'retrait' })).rejects.toMatchObject({ status: 422 });
      expect(await allocTotal(s.id, 'customs')).toBe(1200);
      await svc.removeParcelsFromShipment(db, s.id, [ps[2].parcelId], { reason: 'retrait', parcel_shares: sh([[0, 800], [1, 400]]) });
      expect(await allocTotal(s.id, 'customs')).toBe(1200);
      expect((await allocByOrder(s.id, 'customs'))[ps[2].orderId]).toBeUndefined();
    });

    it('G3e — manual : zéro confirmé sans parts accepté ; inconnu ne ventile rien', async () => {
      const ps = await seedParcels(SPECS);
      const z = await makeShipment(ps, { allocation_method: 'manual', customs_paid_kmf: 0 });
      expect(z.status).toBe('declared');
      expect(await allocTotal(z.id, 'customs')).toBe(0);
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


  describe('A3 — frais typés : méthode de répartition par nature', () => {
    const SPECS = [
      { order: 'A', cif: 3333, weight: 2.5, vol: 40000 },
      { order: 'A', cif: 6667, weight: 1.25, vol: 10000 },
      { order: 'B', cif: 1, weight: 7, vol: 90000 },
    ];
    const fee = (sid, feeType, amount, key, kind = 'charge') => feeSvc.recordFee(db, sid, {
      fee_type: feeType, kind, amount_kmf: amount, proof_ref: `proof-${key}`, idempotency_key: `${RUN_TAG}-${key}`,
    }, null);
    const feeCents = async (sid) => Math.round((await allocTotal(sid, 'port_transitaire')) * 100);
    const feeByParcelOrder = async (sid) => allocByOrder(sid, 'port_transitaire');

    it('A3 — défaut inchangé ; une nature par volume et une par poids sont chacune conservées au centime', async () => {
      const ps = await seedParcels(SPECS);
      const s = await makeShipment(ps, { allocation_method: 'by_cif_value', customs_paid_kmf: '1000.00',
        allocation_config: { fee_allocation: { storage: { method: 'by_volume' }, handling: { method: 'by_weight' } } } });
      await fee(s.id, 'storage', '100.01', 'st');
      await fee(s.id, 'handling', '50.03', 'ha');
      await fee(s.id, 'forwarder', '10.01', 'fw'); // sans règle : clé de la douane (CIF)
      expect(await feeCents(s.id)).toBe(10001 + 5003 + 1001);
      const byOrder = await feeByParcelOrder(s.id);
      // B porte 90000/140000 du volume, 7/10.75 du poids, ~0 du CIF : sa part prouve que les clés diffèrent par nature
      expect(byOrder[ps[2].orderId]).toBeGreaterThan(64);
    });

    it('A3 — mixed et manual (proportions) : conservation exacte, parts manuelles respectées', async () => {
      const ps = await seedParcels(SPECS);
      const shares = { [ps[0].parcelId]: 1, [ps[1].parcelId]: 1, [ps[2].parcelId]: 2 };
      const s = await makeShipment(ps, { allocation_method: 'by_cif_value', customs_paid_kmf: '1000.00',
        allocation_config: { fee_allocation: { other: { method: 'manual', shares }, exceptional: { method: 'mixed', cif: 0.3, weight: 0.7 } } } });
      await fee(s.id, 'other', '100.00', 'o1');
      await fee(s.id, 'exceptional', '33.33', 'e1');
      expect(await feeCents(s.id)).toBe(13333);
      const { rows } = await db.query(
        `SELECT order_id, SUM(amount_kmf) FILTER (WHERE source = 'customs_shipment_fees') AS t FROM order_item_real_cost_allocations
          WHERE shipment_id = $1 AND cost_type = 'port_transitaire' GROUP BY order_id`, [s.id]);
      expect(rows).toHaveLength(2);
    });

    it('A3 — config invalide refusée (nature inconnue, méthode inconnue, manual sans parts) ; manual périmé après retrait = 422', async () => {
      const ps = await seedParcels(SPECS);
      await expect(makeShipment(ps, { allocation_config: { fee_allocation: { nope: { method: 'by_weight' } } } }))
        .rejects.toMatchObject({ code: 'CUSTOMS_FEE_ALLOCATION_INVALID' });
      await expect(makeShipment(ps, { allocation_config: { fee_allocation: { storage: { method: 'x' } } } }))
        .rejects.toMatchObject({ code: 'CUSTOMS_FEE_ALLOCATION_INVALID' });
      await expect(makeShipment(ps, { allocation_config: { fee_allocation: { storage: { method: 'manual' } } } }))
        .rejects.toMatchObject({ code: 'CUSTOMS_FEE_ALLOCATION_INVALID' });
      const stale = { [ps[0].parcelId]: 1 };
      const s = await makeShipment(ps, { allocation_method: 'by_cif_value', customs_paid_kmf: '100.00',
        allocation_config: { fee_allocation: { storage: { method: 'manual', shares: stale } } } });
      await expect(fee(s.id, 'storage', '10.00', 'bad')).rejects.toMatchObject({ status: 422 });
      const { rows } = await db.query('SELECT 1 FROM customs_shipment_fees WHERE shipment_id = $1', [s.id]);
      expect(rows).toHaveLength(0);
    });

    it('A3 — la configuration par nature est auditée (journal financier)', async () => {
      const ps = await seedParcels(SPECS);
      const s = await makeShipment(ps, { customs_paid_kmf: '100.00' });
      await svc.updateShipment(db, s.id, { allocation_config: { fee_allocation: { storage: { method: 'by_weight' } } } },
        { id: null, reason: 'A3 test' });
      const { rows } = await db.query(
        `SELECT 1 FROM customs_shipment_financial_audit WHERE shipment_id = $1 AND new_values->'allocation_config'->'fee_allocation' IS NOT NULL`, [s.id]);
      expect(rows.length).toBeGreaterThan(0);
    });
  });


  describe('A5 — annulation après groupage : la perte reste sur la commande annulée', () => {
    it('A5 — commande annulée après groupage : part historique conservée, aucune redistribution silencieuse, retrait explicite = seule voie', async () => {
      const { allocateShipmentRealCosts } = require('../../services/transport-cost-allocation');
      const ps = await seedParcels([
        { order: 'A', cif: 5000, weight: 2, vol: 10000 },
        { order: 'B', cif: 5000, weight: 2, vol: 10000 },
        { order: 'C', cif: 10000, weight: 4, vol: 20000 },
      ]);
      const s = await makeShipment(ps, { allocation_method: 'by_cif_value', customs_paid_kmf: '1000.00', freight_kmf: '200.00' });
      const before = await allocByOrder(s.id, 'customs');
      const freightBefore = await allocByOrder(s.id, 'freight');
      expect(before[ps[1].orderId]).toBe(250);
      await db.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [ps[1].orderId]);
      await allocateShipmentRealCosts(s.id);
      expect(await allocByOrder(s.id, 'customs')).toEqual(before);
      expect(await allocByOrder(s.id, 'freight')).toEqual(freightBefore);
      expect(await allocTotal(s.id, 'customs')).toBe(1000);
      // la seule voie de redistribution est le retrait explicite du colis (tracé)
      await svc.removeParcelsFromShipment(db, s.id, [ps[1].parcelId], { id: null, reason: 'A5 retrait explicite' });
      const after = await allocByOrder(s.id, 'customs');
      expect(after[ps[1].orderId]).toBeUndefined();
      expect(await allocTotal(s.id, 'customs')).toBe(1000);
      const { rows } = await db.query(
        `SELECT 1 FROM customs_shipment_parcel_events WHERE shipment_id = $1 AND parcel_id = $2 AND event = 'detach'`, [s.id, ps[1].parcelId]);
      expect(rows).toHaveLength(1);
    });
  });


  describe('A6 — frais après clôture : correction tracée, montant d\'origine jamais réécrit', () => {
    it('A6 — expédition confirmée : motif obligatoire, ligne post_closure, original intact, ventilation conservée, UPDATE refusé', async () => {
      const ps = await seedParcels([{ order: 'A', cif: 6000, weight: 1, vol: 1000 }, { order: 'B', cif: 4000, weight: 1, vol: 1000 }]);
      const s = await makeShipment(ps, { allocation_method: 'by_cif_value', customs_paid_kmf: '100.00' });
      const rec = (extra) => feeSvc.recordFee(db, s.id, { fee_type: 'storage', amount_kmf: '40.00', proof_ref: 'p', ...extra }, null);
      const orig = await rec({ idempotency_key: `${RUN_TAG}-a6-1` });
      expect(orig.fee.post_closure).toBe(false);
      await db.query(`UPDATE customs_shipments SET status = 'confirmed' WHERE id = $1`, [s.id]);
      await expect(rec({ idempotency_key: `${RUN_TAG}-a6-2` })).rejects.toMatchObject({ code: 'CUSTOMS_FEE_POST_CLOSURE_REASON_REQUIRED' });
      const corr = await rec({ idempotency_key: `${RUN_TAG}-a6-3`, kind: 'credit', amount_kmf: '15.00', notes: 'remise surestaries reçue après clôture' });
      expect(corr.fee.post_closure).toBe(true);
      expect(Math.round((await allocTotal(s.id, 'port_transitaire')) * 100)).toBe(2500);
      const { rows } = await db.query('SELECT id, amount_kmf, post_closure FROM customs_shipment_fees WHERE shipment_id = $1 ORDER BY recorded_at', [s.id]);
      expect(rows.map((r) => [Number(r.amount_kmf), r.post_closure])).toEqual([[40, false], [15, true]]);
      await expect(db.query('UPDATE customs_shipment_fees SET amount_kmf = 1 WHERE id = $1', [orig.fee.id])).rejects.toBeTruthy();
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
