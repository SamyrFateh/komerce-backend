'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * @integration  outbox-worker.test.js
 * @brief HUB-000 / F0 — Preuve du contrat du worker outbox sur Postgres réel
 *        (pas de mock des garanties transactionnelles : locks avisory, FOR
 *        UPDATE SKIP LOCKED, atomicité receipt+ACK sont vérifiés en conditions
 *        réelles, y compris via un crash simulé).
 *
 * Scénarios obligatoires couverts :
 *   1. Ordre causal par agrégat : A#1 claimed → A#2 ne s'exécute jamais avant
 *      que A#1 soit terminé (même quand FOR UPDATE SKIP LOCKED seul aurait
 *      laissé passer A#2).
 *   2. Parallélisme entre agrégats : B#1 s'exécute alors que A est encore
 *      in-flight.
 *   3. Crash avant processed_at : reçu + ACK sont dans la même transaction —
 *      un crash simulé (rollback forcé après écriture du reçu) ne laisse ni
 *      reçu orphelin ni ACK sans reçu ; le retry traite l'événement une seule
 *      fois au final (pas de doublon).
 *   4. Double delivery : deux tentatives concurrentes sur le même agrégat/
 *      événement ne produisent jamais deux reçus.
 *   5. Retry durable : un échec métier (pas un crash) persiste attempts/
 *      last_error malgré le ROLLBACK de la transaction principale.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const {
  processAggregateOnce,
  pollOnce,
  listPendingAggregates,
  DEFAULT_CONSUMER_KEY,
} = require('../../services/outbox-worker');

jest.setTimeout(20000);

function outcomePayload(extra = {}) {
  return Object.assign({ outcome_type: 'LOST' }, extra);
}

async function insertEvent({ aggregateType, aggregateId, payload = outcomePayload() }) {
  const { rows } = await pool.query(
    `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, $2, 'physical_outcome_reported', $3::jsonb)
     RETURNING id, created_at`,
    [aggregateType, aggregateId, JSON.stringify(payload)]
  );
  return rows[0];
}

async function getEvent(id) {
  const { rows } = await pool.query('SELECT * FROM outbox_events WHERE id = $1', [id]);
  return rows[0];
}

async function countReceipts(eventId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM physical_outcome_receipts WHERE event_id = $1',
    [eventId]
  );
  return rows[0].n;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  // Fixture isolée par run pour ne pas interférer avec d'autres suites qui
  // partageraient la même base — chaque test utilise ses propres UUID/ids.
  await pool.query('SELECT 1');
});

afterAll(async () => {
  await pool.end();
});

// outbox_events est append-only (trigger DB) et physical_outcome_receipts a
// une FK ON DELETE RESTRICT dessus — aucun nettoyage possible ni nécessaire :
// chaque test génère un aggregateId unique (Date.now()), donc aucune
// interférence entre tests.

describe('outbox-worker — ordre causal par agrégat', () => {
  test('A#2 ne peut jamais être exécuté avant que A#1 ait terminé', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `A-${Date.now()}`;

    const e1 = await insertEvent({ aggregateType, aggregateId });
    await sleep(5); // garantit created_at strictement croissant
    const e2 = await insertEvent({ aggregateType, aggregateId });

    // Simule "A#1 claimed" : un client tient le lock advisory + la ligne
    // FOR UPDATE, transaction ouverte, PAS committée.
    const holder = await pool.connect();
    await holder.query('BEGIN');
    const { rows: lockRows } = await holder.query(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
      [`${aggregateType}:${aggregateId}`]
    );
    expect(lockRows[0].locked).toBe(true);
    const { rows: claimed } = await holder.query(
      `SELECT id FROM outbox_events
       WHERE aggregate_type = $1 AND aggregate_id = $2 AND processed_at IS NULL
       ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [aggregateType, aggregateId]
    );
    expect(claimed[0].id).toBe(e1.id);

    // Pendant que A#1 est in-flight, le worker réel ne doit RIEN exécuter
    // pour cet agrégat — ni A#1 (déjà locked) ni, surtout, A#2 (qui serait
    // pourtant "visible" à FOR UPDATE SKIP LOCKED seul, puisque ce n'est pas
    // la même ligne que celle tenue par holder).
    const attempt = await processAggregateOnce(pool, { aggregateType, aggregateId });
    expect(attempt.outcome).toBe('skipped_locked');
    expect((await getEvent(e1.id)).processed_at).toBeNull();
    expect((await getEvent(e2.id)).processed_at).toBeNull();

    // A#1 "termine" : reçu écrit + ACK dans la transaction du holder, commit.
    await holder.query(
      `INSERT INTO physical_outcome_receipts
         (event_id, consumer_key, aggregate_type, aggregate_id, outcome_type, payload)
       VALUES ($1, $2, $3, $4, 'LOST', $5::jsonb)`,
      [e1.id, DEFAULT_CONSUMER_KEY, aggregateType, aggregateId, JSON.stringify(outcomePayload())]
    );
    await holder.query(`UPDATE outbox_events SET processed_at = NOW(), attempts = attempts + 1 WHERE id = $1`, [e1.id]);
    await holder.query('COMMIT');
    holder.release();

    // Seulement maintenant A#2 devient exécutable — et le worker réel le
    // traite bien, dans l'ordre.
    const next = await processAggregateOnce(pool, { aggregateType, aggregateId });
    expect(next.outcome).toBe('processed');
    expect(next.eventId).toBe(e2.id);
    expect((await getEvent(e2.id)).processed_at).not.toBeNull();
    expect(await countReceipts(e1.id)).toBe(1);
    expect(await countReceipts(e2.id)).toBe(1);
  });
});

describe('outbox-worker — parallélisme entre agrégats', () => {
  test('B#1 peut s\'exécuter pendant que A est encore in-flight', async () => {
    const aggregateType = 'test-physical_unit';
    const aggA = `A-${Date.now()}`;
    const aggB = `B-${Date.now()}`;

    const eA = await insertEvent({ aggregateType, aggregateId: aggA });
    const eB = await insertEvent({ aggregateType, aggregateId: aggB });

    const holder = await pool.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT pg_try_advisory_xact_lock(hashtext($1))', [`${aggregateType}:${aggA}`]);
    await holder.query(
      `SELECT id FROM outbox_events WHERE id = $1 FOR UPDATE SKIP LOCKED`,
      [eA.id]
    );
    // A reste in-flight (transaction ouverte, non committée) pendant qu'on
    // traite B avec le vrai worker.
    const resultB = await processAggregateOnce(pool, { aggregateType, aggregateId: aggB });
    expect(resultB.outcome).toBe('processed');
    expect(resultB.eventId).toBe(eB.id);
    expect((await getEvent(eB.id)).processed_at).not.toBeNull();

    // A, lui, est toujours intact (jamais touché par le worker pendant ce temps).
    expect((await getEvent(eA.id)).processed_at).toBeNull();

    await holder.query('ROLLBACK');
    holder.release();

    // Nettoyage : A reste traitable normalement après relâchement du lock.
    const resultA = await processAggregateOnce(pool, { aggregateType, aggregateId: aggA });
    expect(resultA.outcome).toBe('processed');
  });
});

describe('outbox-worker — crash avant processed_at (atomicité reçu+ACK)', () => {
  test('un crash simulé après écriture du reçu ne laisse ni doublon ni orphelin, et le retry termine le job', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `C-${Date.now()}`;
    const event = await insertEvent({ aggregateType, aggregateId });

    // Simule le worker jusqu'à l'écriture du reçu, PUIS un crash (perte de
    // connexion) avant l'UPDATE processed_at et avant tout COMMIT. Postgres
    // rollback automatiquement la transaction à la fermeture de connexion.
    const crashing = await pool.connect();
    await crashing.query('BEGIN');
    await crashing.query('SELECT pg_try_advisory_xact_lock(hashtext($1))', [`${aggregateType}:${aggregateId}`]);
    await crashing.query(
      `SELECT id FROM outbox_events WHERE id = $1 FOR UPDATE SKIP LOCKED`,
      [event.id]
    );
    await crashing.query(
      `INSERT INTO physical_outcome_receipts
         (event_id, consumer_key, aggregate_type, aggregate_id, outcome_type, payload)
       VALUES ($1, $2, $3, $4, 'LOST', $5::jsonb)`,
      [event.id, DEFAULT_CONSUMER_KEY, aggregateType, aggregateId, JSON.stringify(outcomePayload())]
    );
    // "Crash" : on coupe la connexion sans COMMIT ni ROLLBACK explicite.
    crashing.release(new Error('simulated crash'));

    // Laisse le pool réellement fermer/rollback la connexion avant de vérifier.
    await sleep(200);

    expect((await getEvent(event.id)).processed_at).toBeNull();
    expect(await countReceipts(event.id)).toBe(0); // le reçu est parti avec le rollback implicite

    // Retry réel : doit traiter l'événement une seule fois, proprement.
    const retry = await processAggregateOnce(pool, { aggregateType, aggregateId });
    expect(retry.outcome).toBe('processed');
    expect(retry.eventId).toBe(event.id);
    expect((await getEvent(event.id)).processed_at).not.toBeNull();
    expect(await countReceipts(event.id)).toBe(1);

    // Un traitement supplémentaire ne trouve plus rien à faire (pas de
    // duplication même si on rappelle le worker sur le même agrégat).
    const again = await processAggregateOnce(pool, { aggregateType, aggregateId });
    expect(again.outcome).toBe('no_pending_event');
    expect(await countReceipts(event.id)).toBe(1);
  });
});

describe('outbox-worker — double delivery / idempotence', () => {
  test('deux tentatives concurrentes sur le même agrégat ne produisent jamais deux reçus', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `D-${Date.now()}`;
    const event = await insertEvent({ aggregateType, aggregateId });

    const [r1, r2] = await Promise.all([
      processAggregateOnce(pool, { aggregateType, aggregateId }),
      processAggregateOnce(pool, { aggregateType, aggregateId }),
    ]);

    const outcomes = [r1.outcome, r2.outcome].sort();
    // L'un traite, l'autre trouve l'agrégat verrouillé ou plus rien à faire —
    // jamais les deux ne traitent le même événement.
    expect(outcomes).toContain('processed');
    expect(outcomes.filter((o) => o === 'processed')).toHaveLength(1);

    expect((await getEvent(event.id)).processed_at).not.toBeNull();
    expect(await countReceipts(event.id)).toBe(1);
  });

  test('un INSERT de reçu en double (même event_id/consumer_key) est absorbé sans erreur (contrainte DB)', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `E-${Date.now()}`;
    const event = await insertEvent({ aggregateType, aggregateId });

    const insertReceipt = () =>
      pool.query(
        `INSERT INTO physical_outcome_receipts
           (event_id, consumer_key, aggregate_type, aggregate_id, outcome_type, payload)
         VALUES ($1, $2, $3, $4, 'LOST', $5::jsonb)
         ON CONFLICT (event_id, consumer_key) DO NOTHING`,
        [event.id, DEFAULT_CONSUMER_KEY, aggregateType, aggregateId, JSON.stringify(outcomePayload())]
      );

    await insertReceipt();
    await insertReceipt();

    expect(await countReceipts(event.id)).toBe(1);
  });
});

describe('outbox-worker — retry durable (attempts / last_error)', () => {
  test('un échec métier (pas un crash) persiste attempts/last_error malgré le rollback', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `F-${Date.now()}`;
    const event = await insertEvent({ aggregateType, aggregateId });

    // Force un échec métier réel et reproductible (pas un mock) : la table
    // de reçu est momentanément renommée, l'INSERT du worker échoue donc
    // avec une vraie erreur SQL ("relation does not exist").
    await pool.query('ALTER TABLE physical_outcome_receipts RENAME TO physical_outcome_receipts_tmp_down');
    let result;
    try {
      result = await processAggregateOnce(pool, { aggregateType, aggregateId });
    } finally {
      await pool.query('ALTER TABLE physical_outcome_receipts_tmp_down RENAME TO physical_outcome_receipts');
    }

    expect(result.outcome).toBe('error');
    expect(result.eventId).toBe(event.id);

    const row = await getEvent(event.id);
    expect(row.processed_at).toBeNull(); // pas d'ACK sans succès
    expect(row.attempts).toBe(1); // mais la tentative est bien comptée
    expect(row.last_error).toMatch(/physical_outcome_receipts/i);

    // Une fois la table restaurée, le retry réussit et n'écrit qu'un reçu.
    const retry = await processAggregateOnce(pool, { aggregateType, aggregateId });
    expect(retry.outcome).toBe('processed');
    expect(await countReceipts(event.id)).toBe(1);
    expect((await getEvent(event.id)).attempts).toBe(2);
    expect((await getEvent(event.id)).last_error).toBeNull();
  });
});

describe('outbox-worker — pollOnce / listPendingAggregates', () => {
  test('traite plusieurs agrégats indépendants en une passe', async () => {
    const aggregateType = 'test-physical_unit';
    const ids = [`G1-${Date.now()}`, `G2-${Date.now()}`, `G3-${Date.now()}`];
    const events = [];
    for (const aggregateId of ids) {
      events.push(await insertEvent({ aggregateType, aggregateId }));
    }

    const pending = await listPendingAggregates(pool, 10);
    const pendingIds = pending
      .filter((a) => a.aggregateType === aggregateType && ids.includes(a.aggregateId))
      .map((a) => a.aggregateId);
    expect(pendingIds.sort()).toEqual([...ids].sort());

    const results = await pollOnce(pool, { concurrency: 10 });
    const relevant = results.filter((r) => ids.includes(r.aggregateId));
    expect(relevant).toHaveLength(3);
    expect(relevant.every((r) => r.outcome === 'processed')).toBe(true);

    for (const e of events) {
      expect((await getEvent(e.id)).processed_at).not.toBeNull();
      expect(await countReceipts(e.id)).toBe(1);
    }
  });

  test('n\'est jamais appelé pour Purchasing/Orders — hors scope F0', () => {
    // Garde structurelle : le header @db-write déclare exhaustivement les
    // tables écrites par ce module ; aucune requête SQL du fichier ne doit
    // cibler purchase_orders/orders/refunds en écriture. On ignore les
    // commentaires (qui nomment légitimement ces domaines pour dire qu'ils
    // sont hors scope) et on ne regarde que les lignes de requête SQL.
    const src = require('fs').readFileSync(require.resolve('../../services/outbox-worker'), 'utf8');

    const dbWriteLine = src.match(/@db-write\s+(.+)/)[1];
    expect(dbWriteLine).toMatch(/outbox_events/);
    expect(dbWriteLine).toMatch(/physical_outcome_receipts/);
    expect(dbWriteLine).not.toMatch(/purchase_orders|refund/i);

    const sqlLines = src
      .split('\n')
      .filter((line) => /INSERT INTO|UPDATE\s+\w|DELETE FROM/i.test(line));
    for (const line of sqlLines) {
      expect(line).not.toMatch(/purchase_orders|refunds?\b|\borders\b/i);
    }
  });
});
