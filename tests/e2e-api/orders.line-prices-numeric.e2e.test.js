'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-LINE-PRICES-NUMERIC — LOT 6 du chantier currency debt
 *
 * order_items.price_kmf, basket_items.price_kmf, product_skus.price_kmf et
 * product_variants.price_kmf passent de `integer` à `numeric(12,2)`
 * (migration 219). Ce sont les 4 colonnes les plus exposées de tout le
 * chantier : 86 fichiers chacune.
 *
 * Elles comblent une incohérence réelle laissée par les lots précédents :
 * orders.total_kmf (migration 213) et products.price_kmf (215) étaient déjà
 * numeric, mais les LIGNES qui composent ce total ne l'étaient pas. Le total
 * pouvait porter des centimes que ses propres lignes ne pouvaient pas
 * représenter — un total juste était structurellement impossible sur un
 * marché à décimales.
 *
 * Ce défaut n'est pas théorique : pendant le LOT 2, une insertion de
 * 12345.67 dans order_items.price_kmf avait été silencieusement arrondie par
 * Postgres à 12346, faussant une marge de test. Le test d'alors avait
 * contourné en changeant les montants ; celui-ci vérifie la correction.
 */

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('E2E-LINE-PRICES-NUMERIC — prix ligne integer -> numeric', ({ db }) => {
  const marketId = uuid();
  const userId = uuid();
  const relaisId = uuid();
  let productId;

  let cleanup;

  beforeAll(async () => {
    cleanup = createCleanup(db);

    await db.query(
      `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
       VALUES ($1, $2, $3, 'KMF', 0, TRUE)`,
      [marketId, tag('L6').slice(0, 2).toUpperCase(), tag('marche-e2e-line-prices')]
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

    productId = uuid();
    await db.query(
      `INSERT INTO products (id, name, price_kmf) VALUES ($1, $2, 1000)`,
      [productId, tag('E2E Product')]
    );
    cleanup.track('products', 'id', productId);
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  test('order_items.price_kmf conserve ses centimes — l’arrondi silencieux du LOT 2 ne se reproduit plus', async () => {
    const orderId = uuid();
    await db.query(
      `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, $3, $4, $5, 12345.67, 'cash_relais', 'paid', 'pending')`,
      [orderId, tag('E2E-LINE-ORDER'), userId, relaisId, marketId]
    );
    cleanup.track('orders', 'id', orderId);

    const itemId = uuid();
    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, price_kmf, quantity)
       VALUES ($1, $2, $3, 12345.67, 1)`,
      [itemId, orderId, productId]
    );
    cleanup.track('order_items', 'id', itemId);

    const { rows: [item] } = await db.query('SELECT price_kmf FROM order_items WHERE id = $1', [itemId]);
    // Avant la migration 219, Postgres aurait stocké 12346 ici.
    expect(item.price_kmf).toBe(12345.67);
    expect(typeof item.price_kmf).toBe('number');
  });

  test('la somme des lignes à centimes égale exactement le total de commande', async () => {
    // Le cœur du LOT 6 : un total numeric n'a de sens que si ses lignes le
    // sont aussi. 3 lignes à 4115.22 + 4115.22 + 4115.23 = 12345.67.
    const orderId = uuid();
    await db.query(
      `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, $3, $4, $5, 12345.67, 'cash_relais', 'paid', 'pending')`,
      [orderId, tag('E2E-SUM-ORDER'), userId, relaisId, marketId]
    );
    cleanup.track('orders', 'id', orderId);

    for (const price of [4115.22, 4115.22, 4115.23]) {
      const itemId = uuid();
      await db.query(
        `INSERT INTO order_items (id, order_id, product_id, price_kmf, quantity)
         VALUES ($1, $2, $3, $4, 1)`,
        [itemId, orderId, productId, price]
      );
      cleanup.track('order_items', 'id', itemId);
    }

    // Somme calculée EN BASE (numeric exact), pas en JS flottant.
    const { rows: [agg] } = await db.query(
      `SELECT SUM(price_kmf * quantity) AS lines_total,
              (SELECT total_kmf FROM orders WHERE id = $1) AS order_total
         FROM order_items WHERE order_id = $1`,
      [orderId]
    );
    expect(Number(agg.lines_total)).toBe(12345.67);
    expect(Number(agg.lines_total)).toBe(Number(agg.order_total));
  });

  test('basket_items.price_kmf conserve ses centimes', async () => {
    const basketId = uuid();
    await db.query(
      `INSERT INTO baskets (id, code, type, owner_id) VALUES ($1, $2, 'personal', $3)`,
      [basketId, tag('BSK'), userId]
    );
    cleanup.track('baskets', 'id', basketId);

    const itemId = uuid();
    await db.query(
      `INSERT INTO basket_items (id, basket_id, product_id, price_kmf, quantity)
       VALUES ($1, $2, $3, 999.99, 1)`,
      [itemId, basketId, productId]
    );
    cleanup.track('basket_items', 'id', itemId);

    const { rows: [item] } = await db.query('SELECT price_kmf FROM basket_items WHERE id = $1', [itemId]);
    expect(item.price_kmf).toBe(999.99);
  });

  test('product_skus et product_variants conservent leurs centimes, contraintes intactes', async () => {
    const skuId = uuid();
    await db.query(
      `INSERT INTO product_skus (id, product_id, sku, price_kmf, stock)
       VALUES ($1, $2, $3, 1499.55, 10)`,
      [skuId, productId, tag('SKU')]
    );
    cleanup.track('product_skus', 'id', skuId);

    const variantId = uuid();
    await db.query(
      `INSERT INTO product_variants (id, product_id, variant_type, variant_value, price_kmf)
       VALUES ($1, $2, 'taille', 'M', 2499.95)`,
      [variantId, productId]
    );
    cleanup.track('product_variants', 'id', variantId);

    const { rows: [sku] } = await db.query('SELECT price_kmf FROM product_skus WHERE id = $1', [skuId]);
    const { rows: [variant] } = await db.query('SELECT price_kmf FROM product_variants WHERE id = $1', [variantId]);
    expect(sku.price_kmf).toBe(1499.55);
    expect(variant.price_kmf).toBe(2499.95);

    // Les CHECK (IS NULL OR >= 0) restent valides après conversion.
    await expect(db.query(
      `INSERT INTO product_skus (id, product_id, sku, price_kmf, stock) VALUES ($1, $2, $3, -1.5, 0)`,
      [uuid(), productId, tag('SKU-NEG')]
    )).rejects.toThrow(/prix_non_negatif/);
  });

  test('chk_order_items_price (> 0) tient toujours après conversion', async () => {
    const orderId = uuid();
    await db.query(
      `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, $3, $4, $5, 100, 'cash_relais', 'paid', 'pending')`,
      [orderId, tag('E2E-CHK-ORDER'), userId, relaisId, marketId]
    );
    cleanup.track('orders', 'id', orderId);

    await expect(db.query(
      `INSERT INTO order_items (id, order_id, product_id, price_kmf, quantity) VALUES ($1, $2, $3, 0, 1)`,
      [uuid(), orderId, productId]
    )).rejects.toThrow(/chk_order_items_price/);
  });

  test('les 3 vues recréées par la migration restent interrogeables', async () => {
    await expect(db.query('SELECT * FROM product_variants_ordered LIMIT 1')).resolves.toBeDefined();
    await expect(db.query('SELECT * FROM v_ceremony_orders LIMIT 1')).resolves.toBeDefined();
    await expect(db.query('SELECT * FROM v_shipment_density LIMIT 1')).resolves.toBeDefined();
  });
});
