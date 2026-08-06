'use strict';


/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * tests/integration/alerts-contract-real-db.test.js
 *
 * Mission ALERTS_CONTRACT_RECOVERY §14 — preuve REAL_DB_INTEGRATION du
 * helper `createAlert()` (utils/alerts.js) contre le schéma physique réel
 * de `alerts` (voir schema_railway.sql) :
 *
 *   id uuid, type text, entity_type text, entity_id uuid, severity text
 *   (check low|medium|high), title text, description text, created_at,
 *   resolved_at, resolved_by.
 *
 * Couvre les points 1 à 6 de §14 :
 *   1. createAlert() persiste dans le vrai schéma.
 *   2. severity mapping (§8).
 *   3. entity_type / entity_id.
 *   4. erreur de persistance propagée par défaut (pas de catch caché).
 *   5. un caller best-effort peut explicitement absorber l'erreur.
 *   6. le client transactionnel reste sain après un createAlert() valide.
 *
 * Le point 7 (les 6 preuves rouges P0-A..F elles-mêmes, bout en bout avec
 * les vraies tables orders/purchase_orders/etc.) N'EST PAS dans ce fichier :
 * il nécessite les fixtures complètes du schéma métier (orders, purchase_
 * orders, parcels...) et doit être exécuté avec une Postgres de test
 * complètement migrée. Il n'a pas pu être produit/exécuté dans cet
 * environnement (pas de serveur PostgreSQL disponible ici — voir
 * docs/ALERTS_CONTRACT_RECOVERY_AUDIT.md, section "Limites d'exécution").
 * Ce fichier suit volontairement le même garde `DATABASE_URL` que
 * alerts-contract-red-proof.test.js pour tourner tel quel en CI.
 */

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('ALERTS CONTRACT — createAlert() REAL_DB proofs — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const db = require('../../db');
  const { createAlert, mapSeverity } = require('../../utils/alerts');

  jest.setTimeout(20000);

  const insertedIds = [];

  afterAll(async () => {
    if (insertedIds.length) {
      await db.query('DELETE FROM alerts WHERE id = ANY($1::uuid[])', [insertedIds]).catch(() => {});
    }
  });

  describe('createAlert() — REAL_DB_INTEGRATION (mission §14.1-6)', () => {
    it('1 — persiste dans le vrai schéma alerts (type/entity_type/entity_id/severity/title/description)', async () => {
      const row = await createAlert(db, {
        type: 'real_db_proof_basic',
        entityType: 'order',
        entityId: null,
        severity: 'low',
        title: 'REAL_DB proof — basic insert',
        description: 'description de test',
      });
      insertedIds.push(row.id);

      const { rows } = await db.query('SELECT * FROM alerts WHERE id = $1', [row.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('real_db_proof_basic');
      expect(rows[0].entity_type).toBe('order');
      expect(rows[0].severity).toBe('low');
      expect(rows[0].title).toBe('REAL_DB proof — basic insert');
    });

    it('2 — severity mapping §8 (elevated -> high, warning -> medium, info -> low)', async () => {
      const cases = [
        ['elevated', 'high'],
        ['warning', 'medium'],
        ['info', 'low'],
        ['critical', 'high'],
      ];
      for (const [input, expected] of cases) {
        expect(mapSeverity(input)).toBe(expected);
        const row = await createAlert(db, {
          type: 'real_db_proof_severity',
          entityType: 'order',
          entityId: null,
          severity: input,
          title: `severity mapping ${input}`,
        });
        insertedIds.push(row.id);
        const { rows } = await db.query('SELECT severity FROM alerts WHERE id = $1', [row.id]);
        expect(rows[0].severity).toBe(expected);
      }
    });

    it('3 — entity_type / entity_id sont bien ceux fournis par le caller', async () => {
      const fakeOrderId = '00000000-0000-0000-0000-0000000000aa';
      const row = await createAlert(db, {
        type: 'real_db_proof_entity',
        entityType: 'order',
        entityId: fakeOrderId,
        severity: 'medium',
        title: 'entity linkage proof',
      });
      insertedIds.push(row.id);
      const { rows } = await db.query('SELECT entity_type, entity_id FROM alerts WHERE id = $1', [row.id]);
      expect(rows[0].entity_type).toBe('order');
      expect(rows[0].entity_id).toBe(fakeOrderId);
    });

    it('4 — une erreur de persistance est propagée par défaut (pas de catch caché dans createAlert)', async () => {
      await expect(
        createAlert(db, {
          type: 'real_db_proof_error',
          entityType: 'order',
          entityId: 'not-a-uuid', // invalid uuid -> DB error expected
          severity: 'medium',
          title: 'should fail',
        })
      ).rejects.toThrow();
    });

    it('5 — un caller best-effort peut explicitement absorber l\'erreur (le helper ne le fait pas à sa place)', async () => {
      let absorbed = false;
      try {
        await createAlert(db, {
          type: 'real_db_proof_bestEffort',
          entityType: 'order',
          entityId: 'still-not-a-uuid',
          severity: 'medium',
          title: 'best effort',
        });
      } catch (_e) {
        absorbed = true;
      }
      expect(absorbed).toBe(true);
    });

    it('6 — le client transactionnel reste sain après un createAlert() valide (pas de savepoint requis pour le cas nominal)', async () => {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        const row = await createAlert(client, {
          type: 'real_db_proof_txn_health',
          entityType: 'order',
          entityId: null,
          severity: 'low',
          title: 'txn health proof',
        });
        insertedIds.push(row.id);
        // La query suivante sur le MÊME client doit réussir : le client
        // n'est pas dans un état "aborted" après un createAlert() valide.
        await expect(client.query('SELECT 1')).resolves.toBeTruthy();
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });
  });
}
