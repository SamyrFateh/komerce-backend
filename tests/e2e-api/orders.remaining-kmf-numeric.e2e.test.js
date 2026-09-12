'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-ORDERS-REMAINING-KMF-NUMERIC — LOT 1b du chantier currency debt
 *
 * Les 10 colonnes monétaires restantes d'orders (migration 214) sont passées
 * de `integer` à `numeric(14,2)`, suite de la migration 213 (total_kmf).
 *
 * Périmètre plus restreint que total_kmf (2 à 11 fichiers par colonne, contre
 * 93) : le vrai risque ici n'est pas l'arithmétique bare côté JS (déjà
 * couverte par le parseur global, tests/unit/db-numeric-type-parser.test.js),
 * mais deux dépendances trouvées par EXÉCUTION réelle, invisibles à la
 * lecture du dump :
 *
 * 1. v_order_margins référence cost_estimated_kmf et cost_real_kmf —
 *    recréée par la migration.
 * 2. trg_compute_real_margin est un trigger "BEFORE UPDATE OF cost_real_kmf"
 *    (déclenchement sur une colonne précise, pas juste une lecture dans le
 *    corps de la fonction) — Postgres bloque un ALTER TYPE sur une colonne
 *    référencée par la DÉFINITION d'un trigger. Recréé à l'identique.
 *
 * Ce test vérifie spécifiquement que ce trigger column-specific se déclenche
 * toujours UNIQUEMENT sur UPDATE de cost_real_kmf après sa recréation — pas
 * sur un UPDATE d'une autre colonne, ce qui serait une régression de
 * comportement discrète (le trigger se déclencherait sur davantage de
 * colonnes qu'avant, ou sur aucune).
 */

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('E2E-ORDERS-REMAINING-KMF-NUMERIC — conversion integer -> numeric', ({ db }) => {
  const marketId = uuid();
  const userId = uuid();
  const relaisId = uuid();

  let cleanup;

  beforeAll(async () => {
    cleanup = createCleanup(db);

    await db.query(
      `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
       VALUES ($1, $2, $3, 'KMF', 0, TRUE)`,
      [marketId, tag('E2').slice(0, 2).toUpperCase(), tag('marche-e2e-remaining-kmf')]
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

  async function insertOrder(overrides = {}) {
    const id = uuid();
    await db.query(
      `INSERT INTO orders (
         id, reference, user_id, relais_id, market_id, total_kmf,
         cost_transport_kmf, cost_douane_kmf, discount_kmf, wallet_applied_kmf,
         prepaid_amount_kmf, remaining_cash_kmf, transport_price_kmf,
         payment_mode, payment_status, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'cash_relais', 'paid', 'pending')`,
      [
        id, tag('E2E-ORDER'), userId, relaisId, marketId,
        overrides.total_kmf ?? 10000,
        overrides.cost_transport_kmf ?? 1500.5,
        overrides.cost_douane_kmf ?? 750.25,
        overrides.discount_kmf ?? 200.1,
        overrides.wallet_applied_kmf ?? 100.99,
        overrides.prepaid_amount_kmf ?? 5000.5,
        overrides.remaining_cash_kmf ?? 4899.5,
        overrides.transport_price_kmf ?? 1500.5,
      ]
    );
    cleanup.track('orders', 'id', id);
    return id;
  }

  test('les 10 colonnes sont décodées en number et conservent leurs centimes', async () => {
    const id = await insertOrder();
    const { rows: [order] } = await db.query(
      `SELECT cost_transport_kmf, cost_douane_kmf, discount_kmf, wallet_applied_kmf,
              prepaid_amount_kmf, remaining_cash_kmf, transport_price_kmf
         FROM orders WHERE id = $1`,
      [id]
    );
    expect(order).toMatchObject({
      cost_transport_kmf: 1500.5,
      cost_douane_kmf: 750.25,
      discount_kmf: 200.1,
      wallet_applied_kmf: 100.99,
      prepaid_amount_kmf: 5000.5,
      remaining_cash_kmf: 4899.5,
      transport_price_kmf: 1500.5,
    });
    for (const key of Object.keys(order)) {
      expect(typeof order[key]).toBe('number');
    }
  });

  test('cost_estimated_kmf et cost_real_kmf : centimes préservés, arithmétique correcte', async () => {
    const id = await insertOrder({ total_kmf: 12345.67 });
    await db.query(
      'UPDATE orders SET cost_estimated_kmf = $2, cost_real_kmf = $3 WHERE id = $1',
      [id, 8000.25, 7500.1]
    );
    const { rows: [order] } = await db.query(
      'SELECT cost_estimated_kmf, cost_real_kmf FROM orders WHERE id = $1',
      [id]
    );
    expect(order.cost_estimated_kmf).toBe(8000.25);
    expect(order.cost_real_kmf).toBe(7500.1);
    // Arithmétique bare : si le parseur NUMERIC n'était pas installé, ceci
    // concatènerait des chaînes plutôt que de soustraire.
    expect(order.cost_estimated_kmf - order.cost_real_kmf).toBeCloseTo(500.15, 2);
  });

  test('unsold_price_kmf conserve des centimes réels — ne tronque plus à l’entier', async () => {
    const id = await insertOrder({ total_kmf: 12345.67 });
    await db.query('UPDATE orders SET unsold_price_kmf = ROUND(total_kmf * 0.75, 2) WHERE id = $1', [id]);
    const { rows: [order] } = await db.query('SELECT unsold_price_kmf FROM orders WHERE id = $1', [id]);
    // Avant cette migration, unsold_price_kmf (integer) aurait tronqué
    // 9259.25 en 9259. Il conserve désormais les centimes.
    expect(order.unsold_price_kmf).toBe(9259.25);
  });

  test('trg_compute_real_margin (BEFORE UPDATE OF cost_real_kmf) se déclenche toujours, après recréation', async () => {
    const id = await insertOrder({ total_kmf: 12345.67 });
    await db.query('UPDATE orders SET cost_real_kmf = $2 WHERE id = $1', [id, 10000.5]);

    const { rows: [order] } = await db.query(
      'SELECT margin_real_pct FROM orders WHERE id = $1',
      [id]
    );
    expect(order.margin_real_pct).not.toBeNull();

    const expected = Math.round(((12345.67 - 10000.5) / 12345.67) * 100 * 1000) / 1000;
    expect(order.margin_real_pct).toBe(expected);
  });

  test('trg_compute_real_margin reste column-specific (OF cost_real_kmf) — pas un trigger générique', async () => {
    // compute_real_margin() garde en interne "IF NEW.cost_closed_at IS NULL"
    // et recalcule de façon idempotente à partir des mêmes valeurs : un test
    // qui n'observerait que margin_real_pct/cost_closed_at après un second
    // UPDATE sans rapport ne détecterait PAS une régression "OF cost_real_kmf"
    // perdue (trigger redevenu générique) — vérifié par mutation, ce test-là
    // a été écrit puis rejeté pour cette raison précise. La seule vérification
    // fiable est l'inspection directe de la définition du trigger en base,
    // pas une inférence depuis ses effets de bord.
    const { rows: [trg] } = await db.query(
      `SELECT pg_get_triggerdef(oid) AS def
         FROM pg_trigger
        WHERE tgrelid = 'orders'::regclass AND tgname = 'trg_compute_real_margin'`
    );
    expect(trg).toBeDefined();
    expect(trg.def).toMatch(/BEFORE UPDATE OF cost_real_kmf ON/);
  });

  test('v_order_margins reste interrogeable après recréation, avec les nouveaux types', async () => {
    const id = await insertOrder({ total_kmf: 5000 });
    await db.query('UPDATE orders SET cost_real_kmf = $2, cost_estimated_kmf = $3 WHERE id = $1', [id, 3000.5, 3200.25]);

    const { rows } = await db.query(
      'SELECT cost_estimated_kmf, cost_real_kmf FROM v_order_margins WHERE id = $1',
      [id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cost_estimated_kmf).toBe(3200.25);
    expect(rows[0].cost_real_kmf).toBe(3000.5);
  });
});
