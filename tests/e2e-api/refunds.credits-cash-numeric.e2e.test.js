'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-REFUNDS-CREDITS-CASH-NUMERIC — LOT 7 du chantier currency debt
 *
 * refunds.amount_kmf, store_credits.amount_kmf/remaining_kmf,
 * cash_collections.amount_kmf et cash_deposits.amount_kmf passent de
 * `integer` à `numeric(14,2)` (migration 220). 43 fichiers les référencent —
 * le reliquat le plus exposé après le LOT 6.
 *
 * Ce sont des montants réellement remis ou dus à une personne : un
 * remboursement, un avoir, de l'argent liquide compté. Les arrondir à
 * l'unité fait perdre des centimes à quelqu'un, à chaque opération.
 *
 * Aucune vue, aucun trigger, aucune contrainte ne dépend de ces colonnes
 * (vérifié sur base migrée avant écriture) : ce test se concentre donc sur
 * la conservation des centimes et sur l'invariant amount/remaining des
 * avoirs, plutôt que sur la survie d'objets dépendants.
 */

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('E2E-REFUNDS-CREDITS-CASH-NUMERIC — flux financiers integer -> numeric', ({ db }) => {
  const marketId = uuid();
  const userId = uuid();
  const relaisId = uuid();
  let orderId;

  let cleanup;

  beforeAll(async () => {
    cleanup = createCleanup(db);

    await db.query(
      `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
       VALUES ($1, $2, $3, 'KMF', 0, TRUE)`,
      [marketId, tag('L7').slice(0, 2).toUpperCase(), tag('marche-e2e-lot7')]
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

    orderId = uuid();
    await db.query(
      `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, $3, $4, $5, 12345.67, 'cash_relais', 'paid', 'pending')`,
      [orderId, tag('E2E-LOT7-ORDER'), userId, relaisId, marketId]
    );
    cleanup.track('orders', 'id', orderId);
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  test('refunds.amount_kmf conserve ses centimes — un remboursement n’est plus arrondi', async () => {
    const id = uuid();
    await db.query(
      `INSERT INTO refunds (id, order_id, amount_kmf, refund_type, refund_method)
       VALUES ($1, $2, 4115.23, 'partial', 'wallet')`,
      [id, orderId]
    );
    cleanup.track('refunds', 'id', id);

    const { rows: [r] } = await db.query('SELECT amount_kmf FROM refunds WHERE id = $1', [id]);
    expect(r.amount_kmf).toBe(4115.23);
    expect(typeof r.amount_kmf).toBe('number');
  });

  test('un remboursement total égale exactement le total de commande, au centime', async () => {
    // Invariant métier : rembourser intégralement une commande à centimes
    // doit être possible à l'exact. Avec amount_kmf en integer, le client
    // perdait les centimes à chaque remboursement total.
    const id = uuid();
    await db.query(
      `INSERT INTO refunds (id, order_id, amount_kmf, refund_type, refund_method)
       VALUES ($1, $2, (SELECT total_kmf FROM orders WHERE id = $2), 'full', 'wallet')`,
      [id, orderId]
    );
    cleanup.track('refunds', 'id', id);

    const { rows: [row] } = await db.query(
      `SELECT r.amount_kmf, o.total_kmf FROM refunds r
       JOIN orders o ON o.id = r.order_id WHERE r.id = $1`,
      [id]
    );
    expect(Number(row.amount_kmf)).toBe(Number(row.total_kmf));
    expect(Number(row.amount_kmf)).toBe(12345.67);
  });

  test('store_credits : un avoir à centimes se consomme partiellement sans résidu non représentable', async () => {
    // amount_kmf et remaining_kmf convertis ENSEMBLE délibérément : un avoir
    // dont le montant porte des centimes mais dont le solde ne peut pas les
    // représenter produirait un résidu non consommable à chaque usage
    // partiel — même défaut que total/lignes corrigé au LOT 6.
    const id = uuid();
    await db.query(
      `INSERT INTO store_credits (id, user_id, amount_kmf, remaining_kmf)
       VALUES ($1, $2, 1000.75, 1000.75)`,
      [id, userId]
    );
    cleanup.track('store_credits', 'id', id);

    // Consommation partielle de 300.25 -> reste 700.50 exactement.
    await db.query(
      'UPDATE store_credits SET remaining_kmf = remaining_kmf - 300.25 WHERE id = $1',
      [id]
    );

    const { rows: [c] } = await db.query(
      'SELECT amount_kmf, remaining_kmf FROM store_credits WHERE id = $1',
      [id]
    );
    expect(c.amount_kmf).toBe(1000.75);
    expect(c.remaining_kmf).toBe(700.5);
    // Le solde consommé se déduit exactement, sans dérive.
    expect(Number(c.amount_kmf) - Number(c.remaining_kmf)).toBeCloseTo(300.25, 2);
  });

  test('cash_collections et cash_deposits conservent leurs centimes', async () => {
    const collectionId = uuid();
    await db.query(
      `INSERT INTO cash_collections (id, order_id, amount_kmf, collected_by)
       VALUES ($1, $2, 8888.88, $3)`,
      [collectionId, orderId, userId]
    );
    cleanup.track('cash_collections', 'id', collectionId);

    const depositId = uuid();
    await db.query(
      `INSERT INTO cash_deposits (id, agent_id, amount_kmf, deposit_method, period_start, period_end)
       VALUES ($1, $2, 7777.77, 'bank', CURRENT_DATE, CURRENT_DATE)`,
      [depositId, userId]
    );
    cleanup.track('cash_deposits', 'id', depositId);

    const { rows: [col] } = await db.query('SELECT amount_kmf FROM cash_collections WHERE id = $1', [collectionId]);
    const { rows: [dep] } = await db.query('SELECT amount_kmf FROM cash_deposits WHERE id = $1', [depositId]);
    expect(col.amount_kmf).toBe(8888.88);
    expect(dep.amount_kmf).toBe(7777.77);
  });

  test('la somme SQL de plusieurs encaissements à centimes est exacte', async () => {
    // Agrégation en base (numeric exact), pas en JS flottant : c'est ce que
    // fait la réconciliation cash réelle.
    // idx_cash_coll_order impose UN encaissement par commande (contrainte
    // métier réelle, découverte à l'exécution) : chaque montant a donc sa
    // propre commande.
    const ids = [];
    for (const amount of [1111.11, 2222.22, 3333.33]) {
      const oId = uuid();
      await db.query(
        `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'cash_relais', 'paid', 'pending')`,
        [oId, tag('E2E-SUM-ORD'), userId, relaisId, marketId, amount]
      );
      cleanup.track('orders', 'id', oId);

      const id = uuid();
      await db.query(
        `INSERT INTO cash_collections (id, order_id, amount_kmf, collected_by)
         VALUES ($1, $2, $3, $4)`,
        [id, oId, amount, userId]
      );
      cleanup.track('cash_collections', 'id', id);
      ids.push(id);
    }

    const { rows: [agg] } = await db.query(
      'SELECT SUM(amount_kmf) AS total FROM cash_collections WHERE id = ANY($1)',
      [ids]
    );
    expect(Number(agg.total)).toBe(6666.66);
  });
});
