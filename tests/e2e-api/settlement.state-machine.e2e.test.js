'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-SETTLEMENT — machine à états et immutabilité du règlement en SQL direct
 *
 * Complète E2E-MA-03, mergé via #1316 : ce dernier prouve le chemin nominal
 * HTTP -> services -> PostgreSQL. Cette suite fait l'inverse : elle contourne
 * volontairement services/market-settlement-service.js et tente directement
 * les violations en SQL, afin de prouver que la base elle-même les refuse.
 *
 * La distinction est volontaire : un chemin applicatif correct ne garantit
 * pas qu'un script de maintenance, une migration future ou un service distrait
 * ne puisse casser la vérité financière. Ici, les invariants de la migration
 * 208 sont exercés contre un vrai PostgreSQL.
 *
 * Ownership : settlement. Cette feature possède market_settlements,
 * market_settlement_events, la migration 208 et la machine
 * READY -> REQUESTED -> PAID -> RECEIVED. Market-delegation ne possède que
 * l'autorisation/orchestration pays autour de cette boundary lifecycle.
 */

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

describeE2E('E2E-SETTLEMENT — state machine DB (SQL direct)', ({ db }) => {
  const marketId = uuid();
  const otherMarketId = uuid();
  const assignmentId = uuid();
  const centralUserId = uuid();
  const operatorUserId = uuid();

  const settlementIds = new Set();
  let cleanup;

  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pick = () => LETTERS[Math.floor(Math.random() * 26)] + LETTERS[Math.floor(Math.random() * 26)];
  const marketCode = pick();
  let otherMarketCode = pick();
  while (otherMarketCode === marketCode) otherMarketCode = pick();

  async function insertReady(overrides = {}) {
    const id = overrides.id || uuid();
    const {
      amount = 1500.5,
      currency = 'XAF',
      market = marketId,
      assignment = assignmentId,
    } = overrides;

    await db.query(
      `INSERT INTO market_settlements
         (id, market_id, assignment_id, amount, currency, attested_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'READY')`,
      [id, market, assignment, amount, currency, centralUserId]
    );
    settlementIds.add(id);
    return id;
  }

  async function cleanupSettlementsWithTriggerBypass() {
    if (!settlementIds.size) return;

    // Le registre settlement est non-destructif en runtime. Le teardown E2E
    // utilise donc une connexion dédiée + transaction, avec SET LOCAL : le
    // bypass de triggers est automatiquement annulé au COMMIT/ROLLBACK et ne
    // peut pas contaminer une connexion rendue au pool.
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL session_replication_role = replica');
        const ids = [...settlementIds];
        await client.query(
          'DELETE FROM market_settlement_events WHERE settlement_id = ANY($1::uuid[])',
          [ids]
        );
        await client.query(
          'DELETE FROM market_settlements WHERE id = ANY($1::uuid[])',
          [ids]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);

    await db.query(
      `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
       VALUES ($1, $2, $3, 'XAF', 0, TRUE)`,
      [marketId, marketCode, tag('marche-e2e')]
    );
    cleanup.track('markets', 'id', marketId);

    await db.query(
      `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
       VALUES ($1, $2, $3, 'XAF', 0, TRUE)`,
      [otherMarketId, otherMarketCode, tag('marche-e2e-autre')]
    );
    cleanup.track('markets', 'id', otherMarketId);

    for (const [id, email] of [
      [centralUserId, `${tag('central')}@e2e.invalid`],
      [operatorUserId, `${tag('operateur')}@e2e.invalid`],
    ]) {
      await db.query(
        `INSERT INTO users (id, full_name, email, password_hash, role)
         VALUES ($1, $2, $3, 'e2e-not-a-real-hash', 'admin')`,
        [id, tag('E2E User'), email]
      );
      cleanup.track('users', 'id', id);
    }

    await db.query(
      `INSERT INTO market_operating_assignments (id, market_id, status, granted_by)
       VALUES ($1, $2, 'ACTIVE', $3)`,
      [assignmentId, marketId, centralUserId]
    );
    cleanup.track('market_operating_assignments', 'id', assignmentId);
  });

  afterAll(async () => {
    await cleanupSettlementsWithTriggerBypass();
    if (cleanup) await cleanup.run();
  });

  describe('création — naissance READY uniquement', () => {
    test('une attestation READY valide est acceptée', async () => {
      const id = await insertReady();
      const { rows } = await db.query(
        'SELECT status, source FROM market_settlements WHERE id = $1',
        [id]
      );
      expect(rows[0]).toMatchObject({ status: 'READY', source: 'CENTRAL_ATTESTATION' });
    });

    test('naître directement en PAID est refusé', async () => {
      await expect(db.query(
        `INSERT INTO market_settlements
           (market_id, assignment_id, amount, currency, attested_by, status,
            requested_by, requested_at, paid_by, paid_at, payment_reference)
         VALUES ($1, $2, 100, 'XAF', $3, 'PAID', $3, NOW(), $3, NOW(), 'VIR-1')`,
        [marketId, assignmentId, centralUserId]
      )).rejects.toThrow(/market_settlement_must_start_ready/);
    });

    test('préremplir un champ d’étape future à la création est refusé', async () => {
      await expect(db.query(
        `INSERT INTO market_settlements
           (market_id, assignment_id, amount, currency, attested_by, status, receipt_note)
         VALUES ($1, $2, 100, 'XAF', $3, 'READY', 'reçu par avance')`,
        [marketId, assignmentId, centralUserId]
      )).rejects.toThrow(/market_settlement_future_stage_fields_forbidden/);
    });

    test('un montant nul est refusé', async () => {
      await expect(db.query(
        `INSERT INTO market_settlements
           (market_id, assignment_id, amount, currency, attested_by)
         VALUES ($1, $2, 0, 'XAF', $3)`,
        [marketId, assignmentId, centralUserId]
      )).rejects.toThrow();
    });

    test('une devise différente de celle du marché est refusée', async () => {
      await expect(db.query(
        `INSERT INTO market_settlements
           (market_id, assignment_id, amount, currency, attested_by)
         VALUES ($1, $2, 100, 'EUR', $3)`,
        [marketId, assignmentId, centralUserId]
      )).rejects.toThrow(/market_settlement_currency_mismatch/);
    });

    test('un assignment appartenant à un autre marché est refusé', async () => {
      await expect(db.query(
        `INSERT INTO market_settlements
           (market_id, assignment_id, amount, currency, attested_by)
         VALUES ($1, $2, 100, 'XAF', $3)`,
        [otherMarketId, assignmentId, centralUserId]
      )).rejects.toThrow(/market_settlement_assignment_market_mismatch/);
    });
  });

  describe('immutabilité — la vérité attestée ne se réécrit jamais', () => {
    test('modifier le montant après attestation est refusé', async () => {
      const id = await insertReady({ amount: 900 });
      await expect(
        db.query('UPDATE market_settlements SET amount = 950 WHERE id = $1', [id])
      ).rejects.toThrow(/market_settlement_attestation_immutable/);
    });

    test('modifier la devise après attestation est refusé', async () => {
      const id = await insertReady();
      await expect(
        db.query(`UPDATE market_settlements SET currency = 'EUR' WHERE id = $1`, [id])
      ).rejects.toThrow(/market_settlement_attestation_immutable/);
    });

    test('changer de marché après attestation est refusé', async () => {
      const id = await insertReady();
      await expect(
        db.query('UPDATE market_settlements SET market_id = $2 WHERE id = $1', [id, otherMarketId])
      ).rejects.toThrow(/market_settlement_attestation_immutable/);
    });

    test('changer l’auteur de l’attestation est refusé', async () => {
      const id = await insertReady();
      await expect(
        db.query('UPDATE market_settlements SET attested_by = $2 WHERE id = $1', [id, operatorUserId])
      ).rejects.toThrow(/market_settlement_attestation_immutable/);
    });
  });

  describe('transitions — aucune étape ne peut être sautée', () => {
    test('READY -> REQUESTED est accepté', async () => {
      const id = await insertReady();
      await db.query(
        `UPDATE market_settlements
            SET status = 'REQUESTED', requested_by = $2, requested_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      );
      const { rows } = await db.query(
        'SELECT status FROM market_settlements WHERE id = $1',
        [id]
      );
      expect(rows[0].status).toBe('REQUESTED');
    });

    test('READY -> RECEIVED est refusé', async () => {
      const id = await insertReady();
      await expect(db.query(
        `UPDATE market_settlements
            SET status = 'RECEIVED', requested_by = $2, requested_at = NOW(),
                paid_by = $2, paid_at = NOW(), payment_reference = 'VIR-X',
                received_by = $2, received_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      )).rejects.toThrow();
    });

    test('REQUESTED -> RECEIVED est refusé', async () => {
      const id = await insertReady();
      await db.query(
        `UPDATE market_settlements
            SET status = 'REQUESTED', requested_by = $2, requested_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      );
      await expect(db.query(
        `UPDATE market_settlements
            SET status = 'RECEIVED', received_by = $2, received_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      )).rejects.toThrow();
    });

    test('REQUESTED -> PAID sans référence de paiement est refusé', async () => {
      const id = await insertReady();
      await db.query(
        `UPDATE market_settlements
            SET status = 'REQUESTED', requested_by = $2, requested_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      );
      await expect(db.query(
        `UPDATE market_settlements
            SET status = 'PAID', paid_by = $2, paid_at = NOW(), payment_reference = '   '
          WHERE id = $1`,
        [id, centralUserId]
      )).rejects.toThrow();
    });

    test('cycle complet READY -> REQUESTED -> PAID -> RECEIVED conserve le montant', async () => {
      const id = await insertReady({ amount: 2400 });

      await db.query(
        `UPDATE market_settlements
            SET status = 'REQUESTED', requested_by = $2, requested_at = NOW()
          WHERE id = $1`,
        [id, operatorUserId]
      );
      await db.query(
        `UPDATE market_settlements
            SET status = 'PAID', paid_by = $2, paid_at = NOW(), payment_reference = $3
          WHERE id = $1`,
        [id, centralUserId, tag('VIR')]
      );
      await db.query(
        `UPDATE market_settlements
            SET status = 'RECEIVED', received_by = $2, received_at = NOW(), receipt_note = 'reçu'
          WHERE id = $1`,
        [id, operatorUserId]
      );

      const { rows } = await db.query(
        'SELECT status, amount, currency FROM market_settlements WHERE id = $1',
        [id]
      );
      expect(rows[0].status).toBe('RECEIVED');
      expect(Number(rows[0].amount)).toBe(2400);
      expect(rows[0].currency).toBe('XAF');
    });
  });
});
