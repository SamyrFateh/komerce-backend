'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/customs-shipment-fees-real-db.test.js
 *
 * Feature propriétaire : economic-engine
 *
 * DOUANE-2B sur vraie base : frais typés append-only (inconnu / zéro confirmé / montant),
 * frais multiples ventilés sans doublon ni perte au centime, corrections par credit,
 * refus (pending, inactive, sans colis), journal immuable, ventilation article
 * (cost_type port_transitaire) sans toucher customs/freight, prix et marges inchangés.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('CUSTOMS TYPED FEES — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const svc = require('../../services/customs-shipment-service');
  const fees = require('../../services/customs-shipment-fee-service');

  jest.setTimeout(20000);

  const RUN_TAG = `e2e_test_custfee_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const orderIds = [];
  const parcelIds = [];
  const productIds = [];
  const shipmentIds = [];
  const relaisIds = [];

  let seedCounter = 0;
  async function seedThreeEqualParcelShipment({ customsPaidKmf = null, freightKmf = null, status = 'pending' } = {}) {
    seedCounter += 1;
    const { rows: [market] } = await db.query(`SELECT id FROM markets WHERE code = 'KM'`);
    const relaisId = crypto.randomUUID();
    relaisIds.push(relaisId);
    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, island, market_id)
       VALUES ($1, $2, 'E2E Agent', '+269000111', 'Moroni Test', 'Ngazidja', $3)`,
      [relaisId, `E2E CostAlloc Relais ${RUN_TAG}`, market.id]
    );

    const shipmentId = crypto.randomUUID();
    shipmentIds.push(shipmentId);
    await db.query(
      `INSERT INTO customs_shipments
         (id, reference, shipment_date, transport_mode, cif_value_kmf, customs_paid_kmf, freight_kmf, allocation_method, status, market_id)
       VALUES ($1, $2, CURRENT_DATE, 'sea', 30000, $3, $4, 'by_cif_value', $5, $6)`,
      [shipmentId, `${RUN_TAG}-ship-${seedCounter}`, customsPaidKmf, freightKmf, status, market.id]
    );

    for (let i = 0; i < 3; i++) {
      const orderId = crypto.randomUUID();
      const productId = crypto.randomUUID();
      const parcelId = crypto.randomUUID();
      const orderItemId = crypto.randomUUID();
      orderIds.push(orderId);
      productIds.push(productId);
      parcelIds.push(parcelId);

      await db.query(
        `INSERT INTO products (id, name, price_kmf, stock, weight_kg, cost_kmf)
         VALUES ($1, $2, 10000, 100, 1, 10000)`,
        [productId, `E2E CostAlloc Produit ${RUN_TAG}-${i}`]
      );

      await db.query(
        `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
         VALUES ($1, $2, NULL, $3, $4, 10000, 'cash_relais', 'paid', 'confirmed')`,
        [orderId, `${RUN_TAG}-order-${seedCounter}-${i}`, relaisId, market.id]
      );

      await db.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf)
         VALUES ($1, $2, $3, 1, 10000)`,
        [orderItemId, orderId, productId]
      );

      await db.query(
        `INSERT INTO parcels (id, order_id, reference, status) VALUES ($1, $2, $3, 'in_transit')`,
        [parcelId, orderId, `${RUN_TAG}-parcel-${seedCounter}-${i}`]
      );

      await db.query(
        `INSERT INTO parcel_items (id, parcel_id, order_item_id, product_id, quantity, qty_allocated)
         VALUES ($1, $2, $3, $4, 1, 1)`,
        [crypto.randomUUID(), parcelId, orderItemId, productId]
      );

      // CIF et poids strictement égaux entre les 3 colis : force une
      // division qui ne tombe pas rond (le cas exact du bug).
      await db.query(
        `INSERT INTO customs_shipment_parcels (shipment_id, parcel_id, parcel_cif_kmf, parcel_weight_kg)
         VALUES ($1, $2, 10000, 1)`,
        [shipmentId, parcelId]
      );
    }

    return shipmentId;
  }

  afterAll(async () => {
    if (shipmentIds.length) {
      // journal append-only : nettoyage de test uniquement (jamais un chemin applicatif)
      await db.query('SET session_replication_role = replica').catch(() => {});
      await db.query('DELETE FROM customs_shipment_fees WHERE shipment_id = ANY($1::uuid[])', [shipmentIds]).catch(() => {});
      await db.query('SET session_replication_role = origin').catch(() => {});
      await db.query(
        'DELETE FROM order_item_real_cost_allocations WHERE shipment_id = ANY($1::uuid[])',
        [shipmentIds]
      ).catch(() => {});
      await db.query(
        'DELETE FROM customs_shipment_parcels WHERE shipment_id = ANY($1::uuid[])',
        [shipmentIds]
      ).catch(() => {});
      await db.query('DELETE FROM customs_shipments WHERE id = ANY($1::uuid[])', [shipmentIds]).catch(() => {});
    }
    if (parcelIds.length) {
      await db.query('DELETE FROM parcel_items WHERE parcel_id = ANY($1::uuid[])', [parcelIds]).catch(() => {});
      // parcels est protégé par un trigger de suppression (RAISE EXCEPTION,
      // « Utilisez status=cancelled ») — même contournement que
      // tests/e2e-api/products.kmf-numeric.e2e.test.js : désactiver la
      // réplication de trigger le temps du nettoyage, légitime uniquement
      // ici, jamais un chemin applicatif.
      await db.query('SET session_replication_role = replica').catch(() => {});
      await db.query('DELETE FROM parcels WHERE id = ANY($1::uuid[])', [parcelIds]).catch(() => {});
      await db.query('SET session_replication_role = origin').catch(() => {});
    }
    if (orderIds.length) {
      await db.query(
        'DELETE FROM order_items WHERE order_id = ANY($1::uuid[])',
        [orderIds]
      ).catch(() => {});
      await db.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orderIds]).catch(() => {});
    }
    if (productIds.length) {
      await db.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]).catch(() => {});
    }
    if (relaisIds.length) {
      await db.query('DELETE FROM relais WHERE id = ANY($1::uuid[])', [relaisIds]).catch(() => {});
    }
  });


  const alloc = async (id, type) => {
    const { rows: [r] } = await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_kmf),0)::numeric AS total
         FROM order_item_real_cost_allocations WHERE shipment_id = $1 AND cost_type = $2`, [id, type]);
    return { n: r.n, total: Number(r.total) };
  };
  const snapshot = async () => (await db.query(
    `SELECT o.id, o.total_kmf, o.margin_real_pct, o.margin_alert, o.sourcing_blocked,
            (SELECT json_agg(oi.price_kmf ORDER BY oi.id) FROM order_items oi WHERE oi.order_id = o.id) AS prices
       FROM orders o WHERE o.id = ANY($1::uuid[]) ORDER BY o.id`, [orderIds])).rows;
  const fee = (type, amount, key, extra = {}) =>
    fees.recordFee(db, extra.shipmentId, { fee_type: type, amount_kmf: amount, currency: 'KMF', proof_ref: `FACT-${key}`, idempotency_key: `${RUN_TAG}-${key}`, ...extra.payload }, null);

  describe('frais douaniers typés (REAL_DB)', () => {
    it('1 — inconnu ≠ zéro confirmé ≠ montant ; zéro n\'écrit aucune allocation', async () => {
      const id = await seedThreeEqualParcelShipment();
      await svc.declareCustomsPayment(db, id, { customs_paid_kmf: 150000 }, null);
      expect((await fees.listFees(db, id)).summary.by_type.handling.state).toBe('unknown');
      const r = await fee('handling', 0, 'z1', { shipmentId: id });
      expect(r.summary.by_type.handling).toEqual({ state: 'zero_confirmed', net_kmf: '0.00' });
      expect(await alloc(id, 'port_transitaire')).toEqual({ n: 0, total: 0 });
      expect(await alloc(id, 'customs')).toMatchObject({ total: 150000 });
    });

    it('2 — frais multiples (1000.01 + 500 + 333.33) sur 3 colis : somme exacte, aucun doublon, customs inchangé, rejeu idempotent', async () => {
      const id = await seedThreeEqualParcelShipment();
      await svc.declareCustomsPayment(db, id, { customs_paid_kmf: 150000 }, null);
      const before = await snapshot();
      await fee('handling', '1000.01', 'h', { shipmentId: id });
      await fee('forwarder', 500, 'f', { shipmentId: id });
      const last = await fee('storage', '333.33', 's', { shipmentId: id });
      expect(last.summary.total_net_kmf).toBe('1833.34');
      expect(await alloc(id, 'port_transitaire')).toEqual({ n: 3, total: 1833.34 });
      expect(await alloc(id, 'customs')).toEqual({ n: 3, total: 150000 });

      const replay = await fee('storage', '333.33', 's', { shipmentId: id });
      expect(replay.idempotent_replay).toBe(true);
      await svc.updateShipment(db, id, { customs_paid_kmf: 150000 }); // reventilation complète
      expect(await alloc(id, 'port_transitaire')).toEqual({ n: 3, total: 1833.34 });
      expect((await fees.listFees(db, id)).fees).toHaveLength(3);

      const { rows: bad } = await db.query(
        `SELECT COUNT(*)::int AS n FROM order_item_real_cost_allocations
          WHERE shipment_id = $1 AND cost_type = 'port_transitaire'
            AND (source <> 'customs_shipment_fees' OR is_actual IS NOT TRUE OR NOT (order_id = ANY($2::uuid[])))`, [id, orderIds]);
      expect(bad[0].n).toBe(0);
      expect(await snapshot()).toEqual(before); // prix, totaux, marge, alertes, sourcing inchangés
    });

    it('3 — correction par credit : net recalculé, credit excédentaire refusé, rien n\'est écrit', async () => {
      const id = await seedThreeEqualParcelShipment();
      await svc.declareCustomsPayment(db, id, { customs_paid_kmf: 90000 }, null);
      await fee('handling', 1000, 'c1', { shipmentId: id });
      await fee('handling', 300, 'c2', { shipmentId: id, payload: { kind: 'credit' } });
      expect(await alloc(id, 'port_transitaire')).toEqual({ n: 3, total: 700 });
      await expect(fee('handling', 700.01, 'c3', { shipmentId: id, payload: { kind: 'credit' } }))
        .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_FEE_CREDIT_EXCEEDS_CHARGES' });
      expect(await alloc(id, 'port_transitaire')).toEqual({ n: 3, total: 700 });
      expect((await fees.listFees(db, id)).fees).toHaveLength(2);
    });

    it('4 — refus : pending, inactive, sans colis ; idempotency_key réutilisée avec contenu différent = 409', async () => {
      const pending = await seedThreeEqualParcelShipment();
      await expect(fee('handling', 10, 'p', { shipmentId: pending })).rejects.toMatchObject({ code: 'CUSTOMS_SHIPMENT_NOT_DECLARED' });

      const empty = crypto.randomUUID();
      shipmentIds.push(empty);
      await db.query(
        `INSERT INTO customs_shipments (id, reference, shipment_date, transport_mode, cif_value_kmf, allocation_method, status, customs_paid_kmf)
         VALUES ($1, $2, CURRENT_DATE, 'sea', 0, 'by_cif_value', 'declared', 0)`, [empty, `${RUN_TAG}-empty`]);
      await expect(fee('handling', 10, 'e', { shipmentId: empty })).rejects.toMatchObject({ code: 'CUSTOMS_SHIPMENT_WITHOUT_PARCELS' });

      const off = await seedThreeEqualParcelShipment();
      await svc.declareCustomsPayment(db, off, { customs_paid_kmf: 30000 }, null);
      await fee('storage', 100, 'o1', { shipmentId: off });
      await expect(fee('storage', 101, 'o1', { shipmentId: off })).rejects.toMatchObject({ code: 'CUSTOMS_FEE_IDEMPOTENCY_CONFLICT' });
      await svc.deactivateShipment(db, off, 'annulée (test)');
      expect(await alloc(off, 'port_transitaire')).toEqual({ n: 0, total: 0 }); // plus d'allocation active
      expect((await fees.listFees(db, off)).fees).toHaveLength(1);            // journal conservé
      await expect(fee('handling', 10, 'o2', { shipmentId: off })).rejects.toMatchObject({ code: 'CUSTOMS_SHIPMENT_INACTIVE' });
    });

    it('5 — journal immuable : UPDATE et DELETE refusés ; suppression de l\'expédition refusée (RESTRICT)', async () => {
      const id = await seedThreeEqualParcelShipment();
      await svc.declareCustomsPayment(db, id, { customs_paid_kmf: 30000 }, null);
      await fee('other', 42, 'i', { shipmentId: id });
      await expect(db.query('UPDATE customs_shipment_fees SET amount_kmf = 1 WHERE shipment_id = $1', [id])).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM customs_shipment_fees WHERE shipment_id = $1', [id])).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM customs_shipments WHERE id = $1', [id])).rejects.toThrow();
    });

    it('6 — devise étrangère tracée, KMF supporté fait foi ; aucun champ marché accepté', async () => {
      const id = await seedThreeEqualParcelShipment();
      await svc.declareCustomsPayment(db, id, { customs_paid_kmf: 30000 }, null);
      const r = await fees.recordFee(db, id, {
        fee_type: 'forwarder', amount_kmf: '1722', currency: 'EUR', amount_currency: '3.5',
        proof_ref: 'RELEVE-9', idempotency_key: `${RUN_TAG}-eur`, market_id: crypto.randomUUID(),
      }, null);
      expect(r.fee.currency).toBe('EUR');
      expect(Number(r.fee.amount_currency)).toBe(3.5);
      expect(Number(r.fee.amount_kmf)).toBe(1722);
      expect(await alloc(id, 'port_transitaire')).toEqual({ n: 3, total: 1722 });
    });
  });
}
