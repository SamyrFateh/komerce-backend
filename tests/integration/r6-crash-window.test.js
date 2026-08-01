'use strict';
/**
 * @integration  r6-crash-window.test.js
 * @brief [R6] Prouve la fenêtre crash post-COMMIT (DEBT-07) et valide le
 *             pattern outbox transactionnel comme remède.
 *
 * La preuve utilise désormais une table TEMPORARY liée à une connexion de
 * test dédiée. Elle ne crée plus jamais public.outbox_events dans la base
 * ciblée par DATABASE_URL.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const R6_USER    = '69859cd3-43e1-5816-83d6-656b259fb0bf';
const R6_RELAIS  = 'e3cb3621-14a1-5f85-a6e4-b9fab941f8f7';
const R6_PRODUCT = 'e43c4bda-7240-5d89-826f-a3503c2d28d6';
const R6_ORDER1  = '5e236ec3-345d-56f2-9be6-17fdd7180ddf';
const R6_ORDER2  = '7e7d877e-e728-511e-92e6-6118ca858f68';

let client;

jest.setTimeout(15000);

beforeAll(async () => {
  client = await pool.connect();

  await client.query(`
    CREATE TEMPORARY TABLE outbox_events (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type   text NOT NULL,
      payload      jsonb NOT NULL,
      created_at   timestamptz DEFAULT NOW(),
      processed_at timestamptz,
      attempts     int DEFAULT 0,
      last_error   text
    ) ON COMMIT PRESERVE ROWS
  `);

  await client.query(`
    INSERT INTO users (id, full_name, email, role)
    VALUES ('${R6_USER}', 'R6 Test', 'r6-crash@komerce.test', 'client')
    ON CONFLICT (id) DO NOTHING
  `);
  await client.query(`
    INSERT INTO relais (id, name, agent_name, phone, address)
    VALUES ('${R6_RELAIS}', 'R6 Relais', 'Agent R6', '+269990001', 'R6 Addr')
    ON CONFLICT (id) DO NOTHING
  `);
  await client.query(`
    INSERT INTO products (id, name, price_kmf)
    VALUES ('${R6_PRODUCT}', 'Produit R6', 5000)
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  if (client) {
    await client.query(`DELETE FROM orders WHERE id IN ('${R6_ORDER1}', '${R6_ORDER2}')`);
    await client.query(`DELETE FROM products WHERE id = '${R6_PRODUCT}'`);
    await client.query(`DELETE FROM relais WHERE id = '${R6_RELAIS}'`);
    await client.query(`DELETE FROM users WHERE id = '${R6_USER}'`);
    client.release();
  }
  await pool.end();
});

describe('[R6] Crash-window post-COMMIT — preuve et outbox', () => {
  test('PROOF — un effet post-COMMIT peut être perdu si le process crash', async () => {
    let effectExecuted = false;
    let orderCreated = false;

    await client.query('BEGIN');
    try {
      await client.query(`
        INSERT INTO orders (id, reference, relais_id, total_kmf, payment_mode, status)
        VALUES ('${R6_ORDER1}', 'KOM-R6-CRASH', '${R6_RELAIS}', 5000, 'cash_relais', 'preparation')
        ON CONFLICT (id) DO UPDATE SET reference = EXCLUDED.reference
      `);
      await client.query('COMMIT');
      orderCreated = true;

      const crashingEffect = async () => {
        throw new Error('[R6] crash simulé post-COMMIT');
      };
      try {
        await crashingEffect();
        effectExecuted = true;
      } catch (_) {
        // Dans un vrai crash, même ce catch n'existe pas.
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }

    expect(orderCreated).toBe(true);
    expect(effectExecuted).toBe(false);
  });

  test('OUTBOX — un effet inscrit dans la TX est durable et rejouable', async () => {
    await client.query('BEGIN');
    try {
      await client.query(`
        INSERT INTO orders (id, reference, relais_id, total_kmf, payment_mode, status)
        VALUES ('${R6_ORDER2}', 'KOM-R6-OUTBOX', '${R6_RELAIS}', 5000, 'cash_relais', 'preparation')
        ON CONFLICT (id) DO UPDATE SET reference = EXCLUDED.reference
      `);

      await client.query(`
        INSERT INTO outbox_events (event_type, payload)
        VALUES ('order.created', $1::jsonb)
      `, [JSON.stringify({
        orderId: R6_ORDER2,
        reference: 'KOM-R6-OUTBOX',
        phones: ['+26933199001'],
        reason: 'r6-proof',
      })]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }

    const { rows } = await client.query(
      `SELECT id, event_type, processed_at, attempts
       FROM outbox_events WHERE payload->>'reference' = 'KOM-R6-OUTBOX'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe('order.created');
    expect(rows[0].processed_at).toBeNull();

    await client.query(
      `UPDATE outbox_events SET processed_at = NOW(), attempts = 1 WHERE id = $1`,
      [rows[0].id]
    );

    const { rows: [checked] } = await client.query(
      `SELECT processed_at FROM outbox_events WHERE id = $1`,
      [rows[0].id]
    );
    expect(checked.processed_at).not.toBeNull();
  });
});
