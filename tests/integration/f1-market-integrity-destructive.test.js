'use strict';

/** @test-kind integration @test-runner jest @test-requires postgres */
/**
 * F1 — Market Integrity / Immutable Order Market — tests destructifs.
 *
 * Précondition : DATABASE_URL pointe vers une base construite depuis
 * db/schema.sql PLUS migrations/229_f1_market_integrity_guards.sql
 * (candidate — pas encore mergée sur main, voir F1-B).
 *
 * Couvre les 5 scénarios de la doctrine F1 + l'analyse de concurrence
 * (TOCTOU sur un relais qui change de Market pendant qu'une commande lui
 * est réassignée).
 */
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MARKET_KM = '00000000-0000-0000-0000-0000000000f1';
const MARKET_CM = '00000000-0000-0000-0000-0000000000f2';
const RELAIS_KM_A = '00000000-0000-0000-0000-0000000000f3';
const RELAIS_KM_B = '00000000-0000-0000-0000-0000000000f4';
const RELAIS_CM = '00000000-0000-0000-0000-0000000000f5';
const RELAIS_KM_UNUSED = '00000000-0000-0000-0000-0000000000f6';
const ORDER_ID = '00000000-0000-0000-0000-0000000000f7';

jest.setTimeout(30000);

async function resetFixture() {
  await pool.query(`
    INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
    VALUES
      ('${MARKET_KM}', 'F1KM', 'F1 Test Market KM', 'KMF', 0, TRUE),
      ('${MARKET_CM}', 'F1CM', 'F1 Test Market CM', 'XAF', 0, TRUE)
    ON CONFLICT (id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO relais (id, name, agent_name, phone, address, market_id)
    VALUES
      ('${RELAIS_KM_A}', 'F1 Relais KM A', 'Agent A', '+269000001', 'Adresse A', '${MARKET_KM}'),
      ('${RELAIS_KM_B}', 'F1 Relais KM B', 'Agent B', '+269000002', 'Adresse B', '${MARKET_KM}'),
      ('${RELAIS_CM}',   'F1 Relais CM',   'Agent C', '+237000003', 'Adresse C', '${MARKET_CM}'),
      ('${RELAIS_KM_UNUSED}', 'F1 Relais KM Unused', 'Agent D', '+269000004', 'Adresse D', '${MARKET_KM}')
    ON CONFLICT (id) DO UPDATE SET market_id = EXCLUDED.market_id;
  `);
  await pool.query(`
    INSERT INTO orders (id, reference, market_id, relais_id, total_kmf, payment_mode, status)
    VALUES ('${ORDER_ID}', 'KOM-TEST-F1', '${MARKET_KM}', '${RELAIS_KM_A}', 10000, 'cash_relais', 'pending')
    ON CONFLICT (id) DO UPDATE SET market_id = EXCLUDED.market_id, relais_id = EXCLUDED.relais_id, status = 'pending';
  `);
}

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetFixture();
});

describe('F1 — orders.market_id immutable (F1.1)', () => {
  test('1. UPDATE orders SET market_id = <autre marché> → FAIL', async () => {
    await expect(
      pool.query('UPDATE orders SET market_id = $1 WHERE id = $2', [MARKET_CM, ORDER_ID])
    ).rejects.toThrow(/orders_market_id_immutable/);
  });

  test('UPDATE orders SET market_id = <même valeur> → PASS (no-op autorisé)', async () => {
    await expect(
      pool.query('UPDATE orders SET market_id = $1 WHERE id = $2', [MARKET_KM, ORDER_ID])
    ).resolves.toBeDefined();
  });
});

describe('F1 — réassignation de relais dans le même Market (F1.2)', () => {
  test('2. relais_id A(KM) → B(KM), même market → PASS', async () => {
    await expect(
      pool.query('UPDATE orders SET relais_id = $1 WHERE id = $2', [RELAIS_KM_B, ORDER_ID])
    ).resolves.toBeDefined();

    const { rows } = await pool.query('SELECT relais_id, market_id FROM orders WHERE id = $1', [ORDER_ID]);
    expect(rows[0].relais_id).toBe(RELAIS_KM_B);
    expect(rows[0].market_id).toBe(MARKET_KM);
  });

  test('3. relais_id A(KM) → relais CM → FAIL', async () => {
    await expect(
      pool.query('UPDATE orders SET relais_id = $1 WHERE id = $2', [RELAIS_CM, ORDER_ID])
    ).rejects.toThrow(/orders_relais_reassignment_cross_market/);
  });

  test('relais_id → relais inexistant → FAIL (non résolvable)', async () => {
    await expect(
      pool.query('UPDATE orders SET relais_id = $1 WHERE id = $2', ['00000000-0000-0000-0000-00000000dead', ORDER_ID])
    ).rejects.toThrow(/orders_relais_id_unresolvable/);
  });
});

describe('F1 — pas de drift silencieux de relais.market_id référencé (F1.3)', () => {
  test('4. relais KM référencé par une commande historique → UPDATE market_id = CM → FAIL', async () => {
    // RELAIS_KM_A est référencé par ORDER_ID (fixture initiale).
    await expect(
      pool.query('UPDATE relais SET market_id = $1 WHERE id = $2', [MARKET_CM, RELAIS_KM_A])
    ).rejects.toThrow(/relais_market_id_immutable_once_referenced/);
  });

  test('5. relais KM jamais référencé → UPDATE market_id = CM → PASS (arbitrage documenté)', async () => {
    // Arbitrage F1 (§5, doctrine) : un relais non référencé par aucune
    // commande n'a pas encore d'historique à protéger — la mutation est
    // techniquement possible. Documenté explicitement plutôt qu'imposé
    // par défaut : si le modèle réel traite relais.market_id comme une
    // identité permanente même hors référencement, ce test doit devenir
    // un FAIL et l'arbitrage doit être réécrit en conséquence.
    await expect(
      pool.query('UPDATE relais SET market_id = $1 WHERE id = $2', [MARKET_CM, RELAIS_KM_UNUSED])
    ).resolves.toBeDefined();
  });
});

describe('F1 — concurrence : pas de TOCTOU entre réassignation de relais et drift de marché', () => {
  test('TX1 réassigne order → relais B pendant que TX2 tente de déplacer relais B vers CM : un seul gagne, jamais un état incohérent', async () => {
    const client1 = await pool.connect();
    const client2 = await pool.connect();
    try {
      await client1.query('BEGIN');
      await client2.query('BEGIN');

      // TX1 prend le verrou FOR SHARE sur relais B en premier (résolution
      // du nouveau relais dans le trigger F1.2).
      const tx1Promise = client1.query(
        'UPDATE orders SET relais_id = $1 WHERE id = $2',
        [RELAIS_KM_B, ORDER_ID]
      );

      // Laisse le temps à TX1 d'acquérir son verrou avant que TX2 ne
      // tente sa propre mutation sur la même ligne relais.
      await new Promise((resolve) => setTimeout(resolve, 100));

      const tx2Promise = client2.query(
        'UPDATE relais SET market_id = $1 WHERE id = $2',
        [MARKET_CM, RELAIS_KM_B]
      );

      await tx1Promise;
      await client1.query('COMMIT');

      // TX2 était bloquée derrière le verrou FOR SHARE de TX1 ; une fois
      // TX1 committée, relais B est référencé par ORDER_ID → F1.3 doit
      // rejeter TX2.
      await expect(tx2Promise).rejects.toThrow(/relais_market_id_immutable_once_referenced/);
      await client2.query('ROLLBACK').catch(() => {});

      const { rows } = await pool.query('SELECT relais_id, market_id FROM orders WHERE id = $1', [ORDER_ID]);
      expect(rows[0].relais_id).toBe(RELAIS_KM_B);
      expect(rows[0].market_id).toBe(MARKET_KM);

      const { rows: relaisRows } = await pool.query('SELECT market_id FROM relais WHERE id = $1', [RELAIS_KM_B]);
      expect(relaisRows[0].market_id).toBe(MARKET_KM);
    } finally {
      client1.release();
      client2.release();
    }
  });
});
