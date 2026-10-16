'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/customs-allocation-lifecycle-real-db.test.js
 *
 * Feature propriétaire : economic-engine
 *
 * Cycle de vie des allocations douanières sur vraie base : NULL = inconnu,
 * 0 explicite = pas de frais, conservation au centime, idempotence,
 * réallocation atomique, désactivation sans allocation active, refus de
 * supprimer un historique financier, prix client inchangés.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('CUSTOMS ALLOCATION LIFECYCLE — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const svc = require('../../services/customs-shipment-service');

  jest.setTimeout(20000);

  const RUN_TAG = `e2e_test_custlife_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
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


  const sumCustoms = async (shipmentId) => {
    const { rows: [r] } = await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_kmf),0)::numeric AS total
         FROM order_item_real_cost_allocations WHERE shipment_id = $1 AND cost_type = 'customs'`, [shipmentId]);
    return { n: r.n, total: Number(r.total) };
  };
  const shipRow = async (id) => (await db.query('SELECT * FROM customs_shipments WHERE id = $1', [id])).rows[0];
  const orderTotals = async () => (await db.query(
    'SELECT id, total_kmf FROM orders WHERE id = ANY($1::uuid[]) ORDER BY id', [orderIds])).rows;
  const itemPrices = async () => (await db.query(
    'SELECT id, price_kmf FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY id', [orderIds])).rows;

  describe('cycle de vie des allocations douanières (REAL_DB)', () => {
    it('1 — pending : montant inconnu (NULL), aucune allocation, pas de marge sur douane inconnue', async () => {
      const id = await seedThreeEqualParcelShipment();
      const ship = await shipRow(id);
      expect(ship.status).toBe('pending');
      expect(ship.customs_paid_kmf).toBeNull();
      expect(await sumCustoms(id)).toEqual({ n: 0, total: 0 });
    });

    it('2 — déclaration 0 explicite : déclaré, pas de frais, conservation 0', async () => {
      const id = await seedThreeEqualParcelShipment();
      const r = await svc.declareCustomsPayment(db, id, { customs_paid_kmf: 0 }, null);
      expect(r.status).toBe('declared');
      const ship = await shipRow(id);
      expect(Number(ship.customs_paid_kmf)).toBe(0);
      expect((await sumCustoms(id)).total).toBe(0);
    });

    it('3 — 150000 sur 3 colis : somme exacte, idempotent, pas d\'orphelin, prix client inchangés', async () => {
      const id = await seedThreeEqualParcelShipment();
      const prices0 = await itemPrices();
      const totals0 = await orderTotals();

      await svc.declareCustomsPayment(db, id, { customs_paid_kmf: 150000 }, null);
      const first = await sumCustoms(id);
      expect(first.total).toBe(150000);
      expect(first.n).toBe(3);

      const { rows: [csp] } = await db.query(
        'SELECT COALESCE(SUM(customs_share_kmf),0)::numeric AS t FROM customs_shipment_parcels WHERE shipment_id = $1', [id]);
      expect(Number(csp.t)).toBe(150000);

      // ré-exécution : mêmes résultats, aucune duplication
      const again = await svc.updateShipment(db, id, { customs_paid_kmf: 150000 });
      expect(again.reallocated).toBe(true);
      expect(await sumCustoms(id)).toEqual(first);

      const { rows: [orph] } = await db.query(
        `SELECT COUNT(*)::int AS n FROM order_item_real_cost_allocations a
          WHERE a.cost_type = 'customs' AND a.shipment_id IS NULL AND a.order_id = ANY($1::uuid[])`, [orderIds]);
      expect(orph.n).toBe(0);

      expect(await itemPrices()).toEqual(prices0);
      expect(await orderTotals()).toEqual(totals0);
    });

    it('4 — changement de montant : réallocation atomique ; montant invalide refusé sans rien changer', async () => {
      const id = await seedThreeEqualParcelShipment();
      await svc.declareCustomsPayment(db, id, { customs_paid_kmf: 100000 }, null);
      await svc.updateShipment(db, id, { customs_paid_kmf: 100001 });
      expect((await sumCustoms(id)).total).toBe(100001);

      await expect(svc.updateShipment(db, id, { customs_paid_kmf: -5 })).rejects.toMatchObject({ status: 400 });
      expect((await sumCustoms(id)).total).toBe(100001);
      expect(Number((await shipRow(id)).customs_paid_kmf)).toBe(100001);
    });

    it('5 — désactivation : plus aucune allocation active, historique conservé ; suppression d\'une déclarée refusée', async () => {
      const id = await seedThreeEqualParcelShipment();
      await svc.declareCustomsPayment(db, id, { customs_paid_kmf: 90000 }, null);
      await svc.deactivateShipment(db, id, 'annulée (test)');
      expect(await sumCustoms(id)).toEqual({ n: 0, total: 0 });
      const ship = await shipRow(id);
      expect(ship.is_active).toBe(false);
      expect(Number(ship.customs_paid_kmf)).toBe(90000);

      await expect(svc.deleteShipment(db, id)).rejects.toMatchObject({
        status: 409, code: 'CUSTOMS_SHIPMENT_HAS_FINANCIAL_HISTORY',
      });
      expect(await shipRow(id)).toBeTruthy();
    });

    it('6 — déclaration sans colis porteur refusée (409) : rien d\'écrit', async () => {
      const id = crypto.randomUUID();
      shipmentIds.push(id);
      await db.query(
        `INSERT INTO customs_shipments (id, reference, shipment_date, transport_mode, cif_value_kmf, allocation_method, status)
         VALUES ($1, $2, CURRENT_DATE, 'sea', 0, 'by_cif_value', 'pending')`, [id, `${RUN_TAG}-empty`]);
      await expect(svc.declareCustomsPayment(db, id, { customs_paid_kmf: 5000 }, null))
        .rejects.toMatchObject({ status: 409, code: 'CUSTOMS_SHIPMENT_WITHOUT_PARCELS' });
      const ship = await shipRow(id);
      expect(ship.status).toBe('pending');
      expect(ship.customs_paid_kmf).toBeNull();
    });
  });
}
