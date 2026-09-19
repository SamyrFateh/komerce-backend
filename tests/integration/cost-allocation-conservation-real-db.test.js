'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * tests/integration/cost-allocation-conservation-real-db.test.js
 *
 * Feature propriétaire : economic-engine
 *
 * Contexte — un bug financier réel trouvé et corrigé en écrivant cette
 * suite : services/cost-allocation/_helpers.js, fonction shareByWeight
 * (ventile customs/fret vers les colis puis vers les lignes de commande,
 * services/cost-allocation/allocate.js) arrondissait CHAQUE part
 * indépendamment. Trois parts de poids égal sur 1000 KMF donnaient
 * 333+333+333=999 : 1 KMF disparaissait sans jamais atterrir dans
 * order_item_real_cost_allocations, sans trace, sans erreur — une dérive
 * de réconciliation comptable silencieuse. Les tests unitaires existants
 * ne couvraient que des divisions qui tombent rond (900 en 1:2) ; un test
 * caractérisait même explicitement l'ancien bug comme comportement voulu
 * (« arrondit au KMF entier (Math.round) », result.every(share === 333)).
 *
 * Correctif : méthode du plus grand reste (même idiome que
 * allocateConserving dans services/pricing-period-structure.js) — chaque
 * part est arrondie vers le bas, puis le reliquat entier est distribué
 * une unité à la fois aux parts dont la fraction tronquée était la plus
 * grande. La somme égale TOUJOURS exactement le total.
 *
 * Ce que le test unitaire de shareByWeight (fonction pure) ne peut pas
 * prouver à lui seul : que la conservation tient aussi à travers le VRAI
 * chemin d'écriture — allocateShipmentRealCosts() insère réellement dans
 * order_item_real_cost_allocations, avec un split à DEUX niveaux
 * (shipment → parcels, puis parcel → order_items). Cette suite construit
 * un shipment à 3 colis de poids/CIF strictement égaux (le cas qui
 * déclenchait la perte de 1 KMF) et vérifie que la somme des lignes
 * réellement écrites en base égale le customs_paid_kmf/freight_kmf
 * déclaré sur le shipment, au centime près.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('COST ALLOCATION CONSERVATION — REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const { allocateShipmentRealCosts } = require('../../services/cost-allocation/allocate');

  jest.setTimeout(20000);

  const RUN_TAG = `e2e_test_costalloc_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const orderIds = [];
  const parcelIds = [];
  const productIds = [];
  const shipmentIds = [];
  const relaisIds = [];

  let seedCounter = 0;
  async function seedThreeEqualParcelShipment({ customsPaidKmf, freightKmf }) {
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
         (id, reference, shipment_date, transport_mode, cif_value_kmf, customs_paid_kmf, freight_kmf, allocation_method)
       VALUES ($1, $2, CURRENT_DATE, 'air', 30000, $3, $4, 'by_cif_value')`,
      [shipmentId, `${RUN_TAG}-ship-${seedCounter}`, customsPaidKmf, freightKmf]
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
        `INSERT INTO parcels (id, order_id, reference) VALUES ($1, $2, $3)`,
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

  describe('allocateShipmentRealCosts — conservation exacte du total (REAL_DB)', () => {
    it('1 — 3 colis strictement égaux, customs 1000 KMF : la somme des lignes écrites égale exactement 1000, pas 999', async () => {
      const shipmentId = await seedThreeEqualParcelShipment({ customsPaidKmf: 1000, freightKmf: 0 });

      const result = await allocateShipmentRealCosts(shipmentId);
      expect(result.error).toBeUndefined();

      const { rows } = await db.query(
        `SELECT amount_kmf FROM order_item_real_cost_allocations
          WHERE shipment_id = $1 AND cost_type = 'customs'`,
        [shipmentId]
      );
      expect(rows).toHaveLength(3);

      const sum = rows.reduce((s, r) => s + Number(r.amount_kmf), 0);
      expect(sum).toBe(1000); // pas 999 — c'est exactement le bug corrigé

      // Chaque part individuelle reste proche de l'équirépartition (333 ou 334).
      expect(rows.every(r => Number(r.amount_kmf) === 333 || Number(r.amount_kmf) === 334)).toBe(true);
    });

    it('2 — customs ET freight simultanément : les deux ventilations conservent chacune leur propre total', async () => {
      const shipmentId = await seedThreeEqualParcelShipment({ customsPaidKmf: 2000, freightKmf: 500 });

      const result = await allocateShipmentRealCosts(shipmentId);
      expect(result.error).toBeUndefined();

      const { rows: customsRows } = await db.query(
        `SELECT amount_kmf FROM order_item_real_cost_allocations
          WHERE shipment_id = $1 AND cost_type = 'customs'`,
        [shipmentId]
      );
      const { rows: freightRows } = await db.query(
        `SELECT amount_kmf FROM order_item_real_cost_allocations
          WHERE shipment_id = $1 AND cost_type = 'freight'`,
        [shipmentId]
      );

      const customsSum = customsRows.reduce((s, r) => s + Number(r.amount_kmf), 0);
      const freightSum = freightRows.reduce((s, r) => s + Number(r.amount_kmf), 0);

      expect(customsSum).toBe(2000);
      expect(freightSum).toBe(500);
    });

    it("3 — IDEMPOTENCE : rejouer l'allocation sur le même shipment ne double pas les lignes ni ne casse la conservation", async () => {
      const shipmentId = await seedThreeEqualParcelShipment({ customsPaidKmf: 1000, freightKmf: 0 });

      await allocateShipmentRealCosts(shipmentId);
      const firstRun = await db.query(
        `SELECT amount_kmf FROM order_item_real_cost_allocations WHERE shipment_id = $1 AND cost_type = 'customs'`,
        [shipmentId]
      );
      expect(firstRun.rows).toHaveLength(3);

      await allocateShipmentRealCosts(shipmentId);
      const secondRun = await db.query(
        `SELECT amount_kmf FROM order_item_real_cost_allocations WHERE shipment_id = $1 AND cost_type = 'customs'`,
        [shipmentId]
      );
      expect(secondRun.rows).toHaveLength(3); // pas 6 — les anciennes lignes sont purgées avant réinsertion

      const sum = secondRun.rows.reduce((s, r) => s + Number(r.amount_kmf), 0);
      expect(sum).toBe(1000);
    });
  });
}
