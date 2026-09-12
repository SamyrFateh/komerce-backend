'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-CUSTOMS-UNSOLD-FABRICS-NUMERIC — LOT 8 du chantier currency debt
 *
 * Clôture du reliquat convertible : les 13 dernières colonnes monétaires
 * integer hors exchange_rates (migration 221).
 *
 * Le cas intéressant est customs_history : deux COLONNES GÉNÉRÉES
 * (customs_delta_kmf et customs_delta_pct) dérivent de customs_estimated_kmf
 * et customs_real_kmf. Postgres refuse d'altérer le type d'une colonne dont
 * dépend une generated column — un blocage que ni pg_depend ni pg_trigger ne
 * signalent, et dont l'erreur ne nomme qu'un bloqueur à la fois : la seconde
 * n'a été révélée qu'en réexécutant après avoir traité la première.
 *
 * La migration les supprime puis les recrée. Ce test vérifie qu'elles
 * RECALCULENT correctement sur des montants à centimes, pas seulement
 * qu'elles existent encore.
 *
 * Hors périmètre, délibérément : exchange_rates.aed_kmf/eur_kmf sont des
 * TAUX, pas des montants. Un taux en integer fausse toute conversion, pas
 * une ligne — problème distinct méritant son propre chantier.
 */

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('E2E-CUSTOMS-UNSOLD-FABRICS-NUMERIC — clôture reliquat integer -> numeric', ({ db }) => {
  let cleanup;

  beforeAll(async () => {
    cleanup = createCleanup(db);
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  test('customs_history : les colonnes générées recalculent juste sur des centimes', async () => {
    const id = uuid();
    await db.query(
      `INSERT INTO customs_history (id, sh_category, customs_estimated_kmf, customs_real_kmf)
       VALUES ($1, $2, 10000.50, 12500.75)`,
      [id, tag('SH')]
    );
    cleanup.track('customs_history', 'id', id);

    const { rows: [row] } = await db.query(
      `SELECT customs_estimated_kmf, customs_real_kmf, customs_delta_kmf, customs_delta_pct
         FROM customs_history WHERE id = $1`,
      [id]
    );

    expect(row.customs_estimated_kmf).toBe(10000.5);
    expect(row.customs_real_kmf).toBe(12500.75);
    // Colonne générée : 12500.75 - 10000.50 = 2500.25. En integer, les deux
    // sources auraient été arrondies et l'écart aurait été faux.
    expect(row.customs_delta_kmf).toBe(2500.25);
    // Le pourcentage dérivé reste cohérent avec les valeurs exactes :
    // (12500.75 / 10000.50 - 1) * 100 = 25.00125 %. Valeur vérifiée par
    // calcul, pas recopiée depuis la sortie du test — une première version
    // attendait 25.0025, une erreur d'arithmétique de ma part que la base a
    // correctement contredite.
    expect(Number(row.customs_delta_pct)).toBeCloseTo(25.0012, 3);
  });

  test('la colonne générée se recalcule après mise à jour d’une source', async () => {
    const id = uuid();
    await db.query(
      `INSERT INTO customs_history (id, sh_category, customs_estimated_kmf, customs_real_kmf)
       VALUES ($1, $2, 1000.00, 1000.00)`,
      [id, tag('SH')]
    );
    cleanup.track('customs_history', 'id', id);

    await db.query('UPDATE customs_history SET customs_real_kmf = 1099.99 WHERE id = $1', [id]);

    const { rows: [row] } = await db.query(
      'SELECT customs_delta_kmf FROM customs_history WHERE id = $1',
      [id]
    );
    expect(row.customs_delta_kmf).toBe(99.99);
  });

  test('disputes.refund_kmf conserve ses centimes — un remboursement de litige n’est plus arrondi', async () => {
    const marketId = uuid();
    const userId = uuid();
    const relaisId = uuid();
    const orderId = uuid();

    await db.query(
      `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
       VALUES ($1, $2, $3, 'KMF', 0, TRUE)`,
      [marketId, tag('L8').slice(0, 2).toUpperCase(), tag('marche-e2e-lot8')]
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

    await db.query(
      `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, $3, $4, $5, 5000.55, 'cash_relais', 'paid', 'pending')`,
      [orderId, tag('E2E-L8-ORDER'), userId, relaisId, marketId]
    );
    cleanup.track('orders', 'id', orderId);

    const disputeId = uuid();
    await db.query(
      `INSERT INTO disputes (id, order_id, type, level, status, description, refund_kmf, created_by)
       VALUES ($1, $2, 'delivery', 1, 'open', 'E2E LOT8', 1234.56, $3)`,
      [disputeId, orderId, userId]
    );
    cleanup.track('disputes', 'id', disputeId);

    const { rows: [d] } = await db.query('SELECT refund_kmf FROM disputes WHERE id = $1', [disputeId]);
    expect(d.refund_kmf).toBe(1234.56);
  });

  test('unsold_items et fabrics conservent leurs centimes', async () => {
    const fabricId = uuid();
    await db.query(
      `INSERT INTO fabrics (id, name, price_per_meter_aed, price_per_meter_kmf, price_per_yard_kmf)
       VALUES ($1, $2, 25.50, 1500.75, 1372.25)`,
      [fabricId, tag('E2E Fabric')]
    );
    cleanup.track('fabrics', 'id', fabricId);

    const { rows: [f] } = await db.query(
      'SELECT price_per_meter_kmf, price_per_yard_kmf FROM fabrics WHERE id = $1',
      [fabricId]
    );
    expect(f.price_per_meter_kmf).toBe(1500.75);
    expect(f.price_per_yard_kmf).toBe(1372.25);
  });

  test('il ne reste AUCUNE colonne monétaire integer hors exchange_rates', async () => {
    // Assertion de clôture du chantier. exchange_rates.aed_kmf/eur_kmf sont
    // des TAUX, maintenus hors périmètre depuis l'audit : les convertir
    // relève d'un chantier distinct avec sa propre décision de précision.
    const { rows } = await db.query(`
      SELECT c.table_name || '.' || c.column_name AS col
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_name = c.table_name AND t.table_schema = 'public'
       WHERE c.table_schema = 'public'
         AND t.table_type = 'BASE TABLE'
         AND c.column_name ~ '_(kmf|eur|aed|usd|xaf)$'
         AND c.data_type IN ('integer', 'bigint')
       ORDER BY 1
    `);
    const remaining = rows.map(r => r.col);
    expect(remaining).toEqual(['exchange_rates.aed_kmf', 'exchange_rates.eur_kmf']);
  });
});
