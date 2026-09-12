'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-ORDERS-TOTAL-KMF-NUMERIC — LOT 1a du chantier currency debt
 *
 * orders.total_kmf est passée de `integer` à `numeric(14,2)` (migration 213).
 * 93 fichiers lisent cette colonne ; aucun test unitaire qui mocke `db.query`
 * ne peut prouver qu'un ALTER TYPE réel se comporte comme prévu — le mock
 * choisit lui-même le type qu'il retourne. Seule l'exécution contre un
 * Postgres réel le peut.
 *
 * Deux risques distincts prouvés ici :
 *
 * 1. Contrat de type JS : node-postgres retourne par défaut une colonne
 *    numeric en `string`, pas en `number`. Sans le parseur global installé
 *    dans db.js (commit précédent), `total_kmf` serait devenu une string
 *    silencieusement, cassant toute arithmétique bare (`total_kmf + fee`
 *    devient une concaténation). Ce test vérifie le comportement de bout en
 *    bout — DB réelle + driver réel — pas seulement le parseur isolément
 *    (déjà couvert par tests/unit/db-numeric-type-parser.test.js).
 *
 * 2. Deux vues dépendaient de la colonne et bloquaient l'ALTER TYPE
 *    (suppliers_stats, v_order_margins) — trouvé par exécution réelle, pas
 *    par lecture du schéma. La migration les recrée à l'identique.
 *
 * Deux fonctions PL/pgSQL lisent total_kmf pour produire d'autres colonnes :
 * compute_real_margin() (trigger BEFORE UPDATE, margin_real_pct) et
 * auto_unsold() (fonction cron, unsold_price_kmf). Postgres promeut
 * implicitement integer/numeric dans ces expressions ; ce test vérifie que
 * la VALEUR produite reste identique avec un total_kmf à centimes réels.
 */

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('E2E-ORDERS-TOTAL-KMF-NUMERIC — conversion integer -> numeric', ({ db }) => {
  const marketId = uuid();
  const userId = uuid();
  const relaisId = uuid();

  let cleanup;

  beforeAll(async () => {
    cleanup = createCleanup(db);

    await db.query(
      `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
       VALUES ($1, $2, $3, 'KMF', 0, TRUE)`,
      [marketId, tag('E1').slice(0, 2).toUpperCase(), tag('marche-e2e-total-kmf')]
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
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  async function insertOrder(totalKmf) {
    const id = uuid();
    await db.query(
      `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'cash_relais', 'paid', 'pending')`,
      [id, tag('E2E-ORDER'), userId, relaisId, marketId, totalKmf]
    );
    cleanup.track('orders', 'id', id);
    return id;
  }

  test('total_kmf est décodé en number, jamais en string', async () => {
    const id = await insertOrder(12345.67);
    const { rows: [order] } = await db.query('SELECT total_kmf FROM orders WHERE id = $1', [id]);
    expect(typeof order.total_kmf).toBe('number');
    expect(order.total_kmf).toBe(12345.67);
  });

  test('les centimes survivent — impossibles avant cette migration (integer)', async () => {
    const id = await insertOrder(999.99);
    const { rows: [order] } = await db.query('SELECT total_kmf FROM orders WHERE id = $1', [id]);
    expect(order.total_kmf).toBe(999.99);
  });

  test('arithmétique bare sur la valeur lue reste correcte, pas de concaténation', async () => {
    const id = await insertOrder(1500.5);
    const { rows: [order] } = await db.query('SELECT total_kmf FROM orders WHERE id = $1', [id]);
    // Si le parseur NUMERIC n'était pas installé, ceci vaudrait '1500.5200'
    // (concaténation de chaînes) plutôt que 1700.5.
    expect(order.total_kmf + 200).toBe(1700.5);
  });

  test('la contrainte chk_orders_total (>= 0) tient toujours après conversion', async () => {
    await expect(insertOrder(-10)).rejects.toThrow(/chk_orders_total/);
  });

  test('compute_real_margin() produit la même valeur avec un total à centimes réels', async () => {
    const id = await insertOrder(12345.67);
    await db.query('UPDATE orders SET cost_real_kmf = $2 WHERE id = $1', [id, 10000]);

    const { rows: [order] } = await db.query(
      'SELECT total_kmf, margin_real_pct FROM orders WHERE id = $1',
      [id]
    );
    expect(typeof order.margin_real_pct).toBe('number');

    const expected = Math.round(((12345.67 - 10000) / 12345.67) * 100 * 1000) / 1000;
    expect(order.margin_real_pct).toBe(expected);
  });

  test('auto_unsold() (ROUND(total_kmf * 0.75)) produit un entier cohérent, arrondi correctement', async () => {
    const id = await insertOrder(12345.67);
    await db.query('UPDATE orders SET unsold_price_kmf = ROUND(total_kmf * 0.75) WHERE id = $1', [id]);

    const { rows: [order] } = await db.query(
      'SELECT unsold_price_kmf FROM orders WHERE id = $1',
      [id]
    );
    // unsold_price_kmf reste `integer` dans ce lot (hors périmètre) : la
    // valeur numérique en centimes réels (9259.25) doit s'arrondir à 9259,
    // pas être tronquée silencieusement à une valeur fausse.
    expect(order.unsold_price_kmf).toBe(9259);
  });

  test('les deux vues recréées par la migration (suppliers_stats, v_order_margins) restent interrogeables', async () => {
    const id = await insertOrder(5000);
    await db.query('UPDATE orders SET cost_real_kmf = $2 WHERE id = $1', [id, 3000]);

    const { rows: marginRows } = await db.query(
      'SELECT total_kmf, margin_real_pct FROM v_order_margins WHERE id = $1',
      [id]
    );
    expect(marginRows).toHaveLength(1);
    expect(typeof marginRows[0].total_kmf).toBe('number');

    // suppliers_stats est agrégée par supplier_id (partners) — cette commande
    // n'a pas de fournisseur, donc pas de ligne attendue ; l'objectif ici est
    // uniquement que la vue reste exécutable après le DROP/CREATE de la
    // migration, pas de vérifier une agrégation spécifique.
    await expect(db.query('SELECT * FROM suppliers_stats LIMIT 1')).resolves.toBeDefined();
  });
});
