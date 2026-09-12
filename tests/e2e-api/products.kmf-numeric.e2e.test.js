'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-PRODUCTS-KMF-NUMERIC — LOT 2 du chantier currency debt
 *
 * products.price_kmf, cost_kmf, unsold_price_kmf passent de `integer` à
 * `numeric(12,2)` (migration 215). price_kmf est le second cas le plus
 * critique après orders.total_kmf : 76 fichiers le référencent.
 *
 * v_shipment_density (dépend de products.cost_kmf, trouvé par pg_depend —
 * pas par lecture du dump) agrège une marge embarquée à travers une chaîne à
 * cinq tables (customs_shipment_parcels -> parcels -> parcel_items ->
 * order_items -> products). Ce test construit cette chaîne complète plutôt
 * que de se contenter de vérifier que la vue reste interrogeable : la vraie
 * question n'est pas "la vue parse-t-elle encore ?" mais "la marge calculée
 * reste-t-elle exacte au centime près, à travers l'agrégation ?".
 */

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('E2E-PRODUCTS-KMF-NUMERIC — conversion integer -> numeric', ({ db }) => {
  let cleanup;

  beforeAll(async () => {
    cleanup = createCleanup(db);
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  async function insertProduct(overrides = {}) {
    const id = uuid();
    await db.query(
      `INSERT INTO products (id, name, price_kmf, cost_kmf, unsold_price_kmf)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, tag('E2E Product'), overrides.price_kmf ?? 5000.5, overrides.cost_kmf ?? null, overrides.unsold_price_kmf ?? null]
    );
    cleanup.track('products', 'id', id);
    return id;
  }

  test('price_kmf, cost_kmf, unsold_price_kmf décodent en number et conservent leurs centimes', async () => {
    const id = await insertProduct({ price_kmf: 12345.67, cost_kmf: 8000.25, unsold_price_kmf: 9999.99 });
    const { rows: [p] } = await db.query(
      'SELECT price_kmf, cost_kmf, unsold_price_kmf FROM products WHERE id = $1',
      [id]
    );
    expect(p.price_kmf).toBe(12345.67);
    expect(p.cost_kmf).toBe(8000.25);
    expect(p.unsold_price_kmf).toBe(9999.99);
    expect(typeof p.price_kmf).toBe('number');
    expect(typeof p.cost_kmf).toBe('number');
    expect(typeof p.unsold_price_kmf).toBe('number');
  });

  test('chk_products_price (price_kmf > 0) tient toujours après conversion', async () => {
    await expect(insertProduct({ price_kmf: 0 })).rejects.toThrow(/chk_products_price/);
    await expect(insertProduct({ price_kmf: -5.5 })).rejects.toThrow(/chk_products_price/);
  });

  test('price_kmf est indépendant de price_eur/price_aed (déjà numeric, non touchées par cette migration)', async () => {
    const id = uuid();
    await db.query(
      `INSERT INTO products (id, name, price_kmf, price_eur, price_aed)
       VALUES ($1, $2, 10000.5, 20.33, 75.1)`,
      [id, tag('E2E Product Multi-devise')]
    );
    cleanup.track('products', 'id', id);
    const { rows: [p] } = await db.query('SELECT price_kmf, price_eur, price_aed FROM products WHERE id = $1', [id]);
    expect(p.price_kmf).toBe(10000.5);
    expect(p.price_eur).toBe(20.33);
    expect(p.price_aed).toBe(75.1);
  });

  describe('v_shipment_density — marge embarquée exacte au centime à travers la chaîne à 5 tables', () => {
    const marketId = uuid();
    const userId = uuid();
    const relaisId = uuid();
    let productId;
    let orderId;
    let orderItemId;
    let parcelId;
    let shipmentId;

    beforeAll(async () => {
      await db.query(
        `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
         VALUES ($1, $2, $3, 'KMF', 0, TRUE)`,
        [marketId, tag('E3').slice(0, 2).toUpperCase(), tag('marche-e2e-shipment-density')]
      );
      cleanup.track('markets', 'id', marketId);

      await db.query(
        `INSERT INTO users (id, full_name, email, password_hash, role)
         VALUES ($1, $2, $3, 'e2e-not-a-real-hash', 'client')`,
        [userId, tag('E2E User'), tag('user') + '@e2e.invalid']
      );
      cleanup.track('users', 'id', userId);

      await db.query(
        `INSERT INTO relais (id, name, agent_name, phone, address, market_id)
         VALUES ($1, $2, 'E2E Agent', $3, 'E2E Address', $4)`,
        [relaisId, tag('E2E Relais'), '+269' + String(Math.floor(1e8 + Math.random() * 8e8)), marketId]
      );
      cleanup.track('relais', 'id', relaisId);

      // Produit vendu à un prix hors-lot (order_items.price_kmf reste
      // integer — table hors périmètre de cette migration). cost_kmf, lui,
      // porte des centimes réels : c'est la seule colonne sous test ici, et
      // la quantité 1 évite que sa fraction s'annule dans l'agrégation.
      productId = await insertProduct({ price_kmf: 12345.67, cost_kmf: 7000.33 });

      orderId = uuid();
      await db.query(
        `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
         VALUES ($1, $2, $3, $4, $5, 12000, 'cash_relais', 'paid', 'pending')`,
        [orderId, tag('E2E-SHIP-ORDER'), userId, relaisId, marketId]
      );
      cleanup.track('orders', 'id', orderId);

      orderItemId = uuid();
      await db.query(
        `INSERT INTO order_items (id, order_id, product_id, price_kmf)
         VALUES ($1, $2, $3, 12000)`,
        [orderItemId, orderId, productId]
      );
      cleanup.track('order_items', 'id', orderItemId);

      parcelId = uuid();
      await db.query(
        `INSERT INTO parcels (id, order_id, reference)
         VALUES ($1, $2, $3)`,
        [parcelId, orderId, tag('E2E-PARCEL')]
      );
      // parcels est protégé par un trigger de suppression (RAISE EXCEPTION,
      // "Utilisez status=cancelled") — trouvé par exécution réelle. Un simple
      // passage à status=cancelled ne suffit pas au nettoyage : la ligne
      // existe toujours, et supprimer orders (son parent) déclenche une
      // cascade qui tente de supprimer le parcel et retombe sur le même
      // trigger. Même contournement que pour market_settlements plus tôt
      // dans ce chantier : désactiver la réplication de trigger le temps du
      // nettoyage — légitime uniquement ici, jamais un chemin applicatif.
      cleanup.trackSql(
        `SET session_replication_role = replica;
         DELETE FROM parcels WHERE id = '${parcelId}';
         SET session_replication_role = origin;`
      );

      await db.query(
        `INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
         VALUES ($1, $2, $3, 1)`,
        [parcelId, orderItemId, productId]
      );
      cleanup.trackSql('DELETE FROM parcel_items WHERE parcel_id = $1', [parcelId]);

      shipmentId = uuid();
      await db.query(
        `INSERT INTO customs_shipments (id, reference, shipment_date, cif_value_kmf, is_active)
         VALUES ($1, $2, CURRENT_DATE, 100000, TRUE)`,
        [shipmentId, tag('E2E-SHIPMENT')]
      );
      cleanup.track('customs_shipments', 'id', shipmentId);

      await db.query(
        `INSERT INTO customs_shipment_parcels (shipment_id, parcel_id)
         VALUES ($1, $2)`,
        [shipmentId, parcelId]
      );
      cleanup.trackSql('DELETE FROM customs_shipment_parcels WHERE shipment_id = $1', [shipmentId]);
    });

    test('margin_embarked_kmf agrège les centimes correctement', async () => {
      const { rows: [row] } = await db.query(
        'SELECT margin_embarked_kmf FROM v_shipment_density WHERE shipment_id = $1',
        [shipmentId]
      );
      expect(row).toBeDefined();
      // (12000 - 7000.33) * 1 = 4999.67. Avant cette migration, cost_kmf
      // tronqué à 7000 aurait donné 5000 — 33 centimes d'écart, invisible
      // sans ce test.
      expect(Number(row.margin_embarked_kmf)).toBeCloseTo(4999.67, 2);
    });
  });
});
