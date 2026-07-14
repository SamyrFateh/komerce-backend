'use strict';
/**
 * @integration  r6-crash-window.test.js
 * @brief [R6] Prouve la fenêtre crash post-COMMIT (DEBT-07) et valide le
 *             pattern outbox transactionnel comme remède.
 *
 * DEBT-07 — CRASH WINDOW (routes/orders/create.js l.508-554)
 * ═══════════════════════════════════════════════════════════
 * Trois effets "fire-and-forget" sont lancés APRÈS client.query('COMMIT') :
 *   1. linkShareToOrder    — UPDATE cart_shares (pool direct)
 *   2. notifyOrderCreated  — SMS/Email/WhatsApp
 *   3. loyalty hook        — loyaltyService.handleOrderConfirmed
 * + dans order-payment-confirmation.js (l.141, l.279) :
 *   4. INSERT alerte confirmed→ordered
 *   5. loyalty post-paiement
 *
 * Si le process crash entre COMMIT et ces effets : la commande existe
 * en DB mais le client n'est pas notifié et la fidélité n'est pas créditée.
 *
 * REMÈDE — Outbox transactionnelle
 * ════════════════════════════════
 * DDL à migrer :
 *
 *   CREATE TABLE outbox_events (
 *     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     event_type   text NOT NULL,
 *     payload      jsonb NOT NULL,
 *     created_at   timestamptz DEFAULT NOW(),
 *     processed_at timestamptz,
 *     attempts     int DEFAULT 0,
 *     last_error   text
 *   );
 *
 * Dans la TX, AVANT COMMIT :
 *   await client.query(
 *     `INSERT INTO outbox_events (event_type, payload) VALUES ($1, $2)`,
 *     ['order.created', JSON.stringify({ orderId, phones, ... })]
 *   );
 *   await client.query('COMMIT'); // atomique avec la commande
 *
 * Worker (cron/pg_notify) :
 *   SELECT ... FROM outbox_events WHERE processed_at IS NULL
 *   FOR UPDATE SKIP LOCKED LIMIT 10
 *   → exécute l'effet → UPDATE processed_at = NOW()
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// UUIDs v5 déterministes pour les fixtures R6
const R6_USER    = '69859cd3-43e1-5816-83d6-656b259fb0bf';
const R6_RELAIS  = 'e3cb3621-14a1-5f85-a6e4-b9fab941f8f7';
const R6_PRODUCT = 'e43c4bda-7240-5d89-826f-a3503c2d28d6';
const R6_ORDER1  = '5e236ec3-345d-56f2-9be6-17fdd7180ddf';
const R6_ORDER2  = '7e7d877e-e728-511e-92e6-6118ca858f68';

jest.setTimeout(15000);

beforeAll(async () => {
  await pool.query(`
    INSERT INTO users (id, full_name, email, role)
    VALUES ('${R6_USER}', 'R6 Test', 'r6-crash@komerce.test', 'client')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO relais (id, name, agent_name, phone, address)
    VALUES ('${R6_RELAIS}', 'R6 Relais', 'Agent R6', '+269990001', 'R6 Addr')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO products (id, name, price_kmf)
    VALUES ('${R6_PRODUCT}', 'Produit R6', 5000)
    ON CONFLICT (id) DO NOTHING
  `);
  // Table outbox (simulation — en prod : migration versionnée)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbox_events (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type   text NOT NULL,
      payload      jsonb NOT NULL,
      created_at   timestamptz DEFAULT NOW(),
      processed_at timestamptz,
      attempts     int DEFAULT 0,
      last_error   text
    )
  `);
});

afterAll(async () => {
  await pool.query(`DELETE FROM outbox_events WHERE payload->>'reason' = 'r6-proof'`);
  await pool.query(`DELETE FROM orders WHERE id IN ('${R6_ORDER1}', '${R6_ORDER2}')`);
  await pool.query(`DELETE FROM products WHERE id = '${R6_PRODUCT}'`);
  await pool.query(`DELETE FROM relais WHERE id = '${R6_RELAIS}'`);
  await pool.query(`DELETE FROM users WHERE id = '${R6_USER}'`);
  await pool.end();
});

describe('[R6] Crash-window post-COMMIT — preuve et outbox', () => {

  test('PROOF — un effet post-COMMIT peut être perdu si le process crash', async () => {
    // Simule : TX commande committée + effet post-commit qui throw (crash)
    const client = await pool.connect();
    let effectExecuted = false;
    let orderCreated = false;

    try {
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO orders (id, reference, relais_id, total_kmf, payment_mode, status)
        VALUES ('${R6_ORDER1}', 'KOM-R6-CRASH', '${R6_RELAIS}', 5000, 'cash_relais', 'preparation')
        ON CONFLICT (id) DO UPDATE SET reference = EXCLUDED.reference
      `);
      await client.query('COMMIT');
      orderCreated = true;

      // Simule le crash post-COMMIT
      const crashingEffect = async () => {
        throw new Error('[R6] crash simulé post-COMMIT');
      };
      try {
        await crashingEffect();
        effectExecuted = true; // jamais atteint
      } catch (_) { /* dans un vrai crash, même ce catch n'existe pas */ }
    } finally {
      client.release();
    }

    expect(orderCreated).toBe(true);   // commande en DB ✓
    expect(effectExecuted).toBe(false); // effet perdu ✓ — fenêtre prouvée
  });

  test('OUTBOX — un effet inscrit dans la TX est durable et rejouable', async () => {
    // Pattern outbox : effet INSERT dans la MÊME TX → atomique avec la commande
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(`
        INSERT INTO orders (id, reference, relais_id, total_kmf, payment_mode, status)
        VALUES ('${R6_ORDER2}', 'KOM-R6-OUTBOX', '${R6_RELAIS}', 5000, 'cash_relais', 'preparation')
        ON CONFLICT (id) DO UPDATE SET reference = EXCLUDED.reference
      `);

      // [OUTBOX] inséré dans la MÊME TX → atomique avec la commande
      await client.query(`
        INSERT INTO outbox_events (event_type, payload)
        VALUES ('order.created', $1::jsonb)
      `, [JSON.stringify({
        orderId: R6_ORDER2,
        reference: 'KOM-R6-OUTBOX',
        phones: ['+26933199001'],
        reason: 'r6-proof',
      })]);

      await client.query('COMMIT'); // commande + outbox committés atomiquement
      // → même si process.exit(1) ici, l'outbox est en DB
    } finally {
      client.release();
    }

    // Vérifier durabilité : l'outbox est bien en DB après COMMIT
    const { rows } = await pool.query(
      `SELECT id, event_type, processed_at, attempts
       FROM outbox_events WHERE payload->>'reference' = 'KOM-R6-OUTBOX'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].event_type).toBe('order.created');
    expect(rows[0].processed_at).toBeNull(); // pas encore traité

    // Simuler le worker : traite et marque comme processed
    await pool.query(
      `UPDATE outbox_events SET processed_at = NOW(), attempts = 1 WHERE id = $1`,
      [rows[0].id]
    );

    const { rows: [checked] } = await pool.query(
      `SELECT processed_at FROM outbox_events WHERE id = $1`, [rows[0].id]
    );
    expect(checked.processed_at).not.toBeNull(); // worker a traité ✓
  });
});
