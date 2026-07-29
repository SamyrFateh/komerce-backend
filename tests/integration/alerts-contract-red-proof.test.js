/**
 * ALERTS CONTRACT RECOVERY — RED PROOFS (REAL_DB_INTEGRATION).
 *
 * Mission §4 : "ne pas coder avant les preuves rouges P0". Ce fichier
 * reproduit, contre une vraie Postgres et le schéma physique réel de
 * `alerts`, le mécanisme de panne que PR563 avait identifié et que le
 * rollback V2.10 n'a fait que déplacer (plus d'interception globale, mais
 * les writers legacy sont toujours là) :
 *
 *   1. Un INSERT `alerts` avec les colonnes legacy (level, source, message,
 *      payload) échoue contre le schéma réel (colonne inexistante).
 *   2. Dans une transaction, cet échec met le client PostgreSQL en état
 *      "aborted" — un `catch` JavaScript autour du seul INSERT ne suffit
 *      pas : toute query suivante sur le MÊME client échoue avec
 *      `current transaction is aborted`, y compris un COMMIT.
 *
 * Ces deux comportements sont volontairement gardés VERTS après migration
 * (ce ne sont pas des régressions à supprimer) : ils documentent le
 * mécanisme de panne que createAlert() + la migration des writers ferment
 * définitivement. Les preuves des 6 cas P0 eux-mêmes vivent dans
 * alerts-contract-real-db.test.js et dans les suites de service dédiées.
 */

'use strict';

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('ALERTS CONTRACT — RED proofs (REAL_DB) — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const db = require('../../db');

  jest.setTimeout(20000);

  afterAll(async () => {
    await db.pool.end();
  });

  describe('ALERTS CONTRACT — mechanism of failure (documented, kept green)', () => {
    it('RED-1 — a legacy-schema INSERT into alerts fails against the real schema', async () => {
      await expect(
        db.query(
          `INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4)`,
          ['critical', 'red_proof', 'red proof message', JSON.stringify({ a: 1 })]
        )
      ).rejects.toMatchObject({ code: '42703' });
    });

    it('RED-2 — inside a transaction, the failed legacy INSERT poisons the client: next query fails', async () => {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // A perfectly valid write happens first (mirrors P0-A/B: an UPDATE
        // orders.notes before the legacy alert insert).
        await client.query('SELECT 1');

        let caught = null;
        try {
          await client.query(
            `INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4)`,
            ['critical', 'red_proof_tx', 'red proof tx message', JSON.stringify({ a: 1 })]
          );
        } catch (err) {
          caught = err; // mirrors the try/catch already present in P0-A..F today
        }
        expect(caught).toMatchObject({ code: '42703' });

        // The mission's central claim: catching the JS error is NOT enough.
        // The client is now in "aborted transaction" state at the Postgres
        // level — every subsequent statement on this SAME client fails,
        // including statements that have nothing to do with alerts.
        await expect(client.query('SELECT 1')).rejects.toMatchObject({ code: '25P02' });
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    });

    it('RED-2b — WORSE than a loud failure: COMMIT on an aborted client succeeds (no exception) but silently discards the whole business transaction', async () => {
      // This is the sharpest version of the mission's central claim. It is
      // NOT "the alert insert throws and someone forgets to catch it" — the
      // catch blocks already present in P0-A..F DO catch it. The real danger
      // is that COMMIT itself does not throw: PostgreSQL treats COMMIT on an
      // aborted transaction as an implicit ROLLBACK and returns success. Any
      // caller code that does `await client.query('COMMIT')` without
      // independently verifying the transaction's fate believes it succeeded
      // while every prior write in that transaction (order status, stock
      // decrement, pickup secret, PayPal fields...) was silently discarded.
      const client = await db.pool.connect();
      const marker = `red-proof-marker-${Date.now()}`;
      try {
        await client.query('BEGIN');

        // A real, valid business write — stands in for the order UPDATE
        // that precedes the alert insert in P0-A/B/E.
        await client.query(
          `INSERT INTO alerts (type, entity_type, severity, title, description)
           VALUES ('red_proof_marker', 'system', 'low', $1, 'should be rolled back')`,
          [marker]
        );

        // The legacy insert fails and poisons the client.
        await client.query(
          `INSERT INTO alerts (level, source, message, payload) VALUES ($1, $2, $3, $4)`,
          ['critical', 'red_proof_tx2', 'red proof tx2 message', JSON.stringify({ a: 1 })]
        ).catch(() => {}); // caught, exactly like the current P0-A..F code

        // COMMIT does NOT throw ...
        const commitResult = await client.query('COMMIT');
        expect(commitResult.command).toBe('ROLLBACK'); // pg reports what it actually did

        // ... yet the earlier, perfectly valid write never made it to disk.
        const { rows } = await db.query(
          `SELECT 1 FROM alerts WHERE type = 'red_proof_marker' AND title = $1`,
          [marker]
        );
        expect(rows.length).toBe(0); // silently lost
      } finally {
        client.release();
        await db.query(`DELETE FROM alerts WHERE type IN ('red_proof_marker')`);
      }
    });

    it('RED-3 (control) — createAlert() against the real schema does NOT poison the client', async () => {
      const { createAlert } = require('../../utils/alerts');
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT 1');

        const row = await createAlert(client, {
          type: 'red_proof_control',
          entityType: 'system',
          severity: 'low',
          title: 'RED-3 control case',
          description: 'Proves createAlert() does not poison the transaction.',
        });
        expect(row.id).toBeTruthy();

        // Client is still healthy — next query and COMMIT succeed.
        await expect(client.query('SELECT 1')).resolves.toBeDefined();
        await client.query('COMMIT');
      } finally {
        client.release();
        await db.query(`DELETE FROM alerts WHERE type = 'red_proof_control'`);
      }
    });
  });
}
