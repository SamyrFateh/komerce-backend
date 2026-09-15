'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * @integration outbox-worker.test.js
 * @brief HUB-000 / F0 — worker durable sur PostgreSQL réel.
 */

const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const {
  processAggregateOnce,
  pollOnce,
  listPendingAggregates,
  DEFAULT_CONSUMER_KEY,
} = require('../../services/outbox-worker');
const { reportPhysicalOutcome } = require('../../services/outbox-producer');

jest.setTimeout(20000);

function outcomePayload(extra = {}) {
  return Object.assign({ outcome_type: 'LOST' }, extra);
}

async function insertEvent({ aggregateType, aggregateId, payload = outcomePayload() }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { outcome_type: outcomeType, ...details } = payload;
    const id = await reportPhysicalOutcome(client, {
      aggregateType,
      aggregateId,
      outcomeType,
      details,
    });
    await client.query('COMMIT');
    const { rows } = await pool.query(
      'SELECT id, aggregate_sequence, created_at FROM outbox_events WHERE id = $1',
      [id]
    );
    return rows[0];
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
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
  await pool.query('SELECT 1');
});

afterAll(async () => {
  await pool.end();
});

describe('outbox-worker — ordre causal par agrégat', () => {
  test('le second événement ne passe pas devant le premier', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `ORDER-${Date.now()}`;
    const e1 = await insertEvent({ aggregateType, aggregateId });
    const e2 = await insertEvent({ aggregateType, aggregateId, payload: outcomePayload({ note: 'second' }) });

    expect(Number(e2.aggregate_sequence)).toBe(Number(e1.aggregate_sequence) + 1);

    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      const { rows: lockRows } = await holder.query(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
        [`${aggregateType}:${aggregateId}`]
      );
      expect(lockRows[0].locked).toBe(true);
      const { rows: claimed } = await holder.query(
        `SELECT id FROM outbox_events
         WHERE aggregate_type = $1 AND aggregate_id = $2 AND processed_at IS NULL
         ORDER BY aggregate_sequence ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [aggregateType, aggregateId]
      );
      expect(claimed[0].id).toBe(e1.id);

      const attempt = await processAggregateOnce(pool, { aggregateType, aggregateId });
      expect(attempt.outcome).toBe('skipped_locked');
      expect((await getEvent(e1.id)).processed_at).toBeNull();
      expect((await getEvent(e2.id)).processed_at).toBeNull();

      await holder.query(
        `INSERT INTO physical_outcome_receipts
           (event_id, consumer_key, aggregate_type, aggregate_id, outcome_type, payload)
         VALUES ($1, $2, $3, $4, 'LOST', $5::jsonb)`,
        [e1.id, DEFAULT_CONSUMER_KEY, aggregateType, aggregateId, JSON.stringify(outcomePayload())]
      );
      await holder.query(
        'UPDATE outbox_events SET processed_at = NOW(), attempts = attempts + 1 WHERE id = $1',
        [e1.id]
      );
      await holder.query('COMMIT');
    } finally {
      try { await holder.query('ROLLBACK'); } catch (_) {}
      holder.release();
    }

    const next = await processAggregateOnce(pool, { aggregateType, aggregateId });
    expect(next.outcome).toBe('processed');
    expect(next.eventId).toBe(e2.id);
    expect(await countReceipts(e1.id)).toBe(1);
    expect(await countReceipts(e2.id)).toBe(1);
  });
});

describe('outbox-worker — parallélisme entre agrégats', () => {
  test('B peut être traité pendant que A est in-flight', async () => {
    const aggregateType = 'test-physical_unit';
    const aggA = `PAR-A-${Date.now()}`;
    const aggB = `PAR-B-${Date.now()}`;
    const eA = await insertEvent({ aggregateType, aggregateId: aggA });
    const eB = await insertEvent({ aggregateType, aggregateId: aggB });

    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_try_advisory_xact_lock(hashtext($1))', [`${aggregateType}:${aggA}`]);
      await holder.query('SELECT id FROM outbox_events WHERE id = $1 FOR UPDATE SKIP LOCKED', [eA.id]);

      const resultB = await processAggregateOnce(pool, { aggregateType, aggregateId: aggB });
      expect(resultB.outcome).toBe('processed');
      expect(resultB.eventId).toBe(eB.id);
      expect((await getEvent(eA.id)).processed_at).toBeNull();

      await holder.query('ROLLBACK');
    } finally {
      holder.release();
    }

    const resultA = await processAggregateOnce(pool, { aggregateType, aggregateId: aggA });
    expect(resultA.outcome).toBe('processed');
  });
});

describe('outbox-worker — crash, retry et idempotence', () => {
  test('crash après reçu mais avant ACK rollback tout, puis retry réussit une fois', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `CRASH-${Date.now()}`;
    const event = await insertEvent({ aggregateType, aggregateId });

    const crashing = await pool.connect();
    await crashing.query('BEGIN');
    await crashing.query('SELECT pg_try_advisory_xact_lock(hashtext($1))', [`${aggregateType}:${aggregateId}`]);
    await crashing.query('SELECT id FROM outbox_events WHERE id = $1 FOR UPDATE SKIP LOCKED', [event.id]);
    await crashing.query(
      `INSERT INTO physical_outcome_receipts
         (event_id, consumer_key, aggregate_type, aggregate_id, outcome_type, payload)
       VALUES ($1, $2, $3, $4, 'LOST', $5::jsonb)`,
      [event.id, DEFAULT_CONSUMER_KEY, aggregateType, aggregateId, JSON.stringify(outcomePayload())]
    );
    crashing.release(new Error('simulated crash'));
    await sleep(200);

    expect((await getEvent(event.id)).processed_at).toBeNull();
    expect(await countReceipts(event.id)).toBe(0);

    const retry = await processAggregateOnce(pool, { aggregateType, aggregateId });
    expect(retry.outcome).toBe('processed');
    expect(await countReceipts(event.id)).toBe(1);

    const again = await processAggregateOnce(pool, { aggregateType, aggregateId });
    expect(again.outcome).toBe('no_pending_event');
    expect(await countReceipts(event.id)).toBe(1);
  });

  test('deux workers concurrents ne créent qu’un reçu', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `DOUBLE-${Date.now()}`;
    const event = await insertEvent({ aggregateType, aggregateId });

    const [r1, r2] = await Promise.all([
      processAggregateOnce(pool, { aggregateType, aggregateId }),
      processAggregateOnce(pool, { aggregateType, aggregateId }),
    ]);
    expect([r1.outcome, r2.outcome].filter((o) => o === 'processed')).toHaveLength(1);
    expect(await countReceipts(event.id)).toBe(1);
  });

  test('un échec métier persiste attempts/last_error et reste pending', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `FAIL-${Date.now()}`;
    const event = await insertEvent({ aggregateType, aggregateId });

    await pool.query('ALTER TABLE physical_outcome_receipts RENAME TO physical_outcome_receipts_tmp_down');
    let result;
    try {
      result = await processAggregateOnce(pool, { aggregateType, aggregateId });
    } finally {
      await pool.query('ALTER TABLE physical_outcome_receipts_tmp_down RENAME TO physical_outcome_receipts');
    }

    expect(result.outcome).toBe('error');
    const failed = await getEvent(event.id);
    expect(failed.processed_at).toBeNull();
    expect(failed.attempts).toBe(1);
    expect(failed.last_error).toMatch(/physical_outcome_receipts/i);

    const retry = await processAggregateOnce(pool, { aggregateType, aggregateId });
    expect(retry.outcome).toBe('processed');
    expect((await getEvent(event.id)).attempts).toBe(2);
    expect((await getEvent(event.id)).last_error).toBeNull();
  });
});

describe('outbox-worker — pollOnce', () => {
  test('traite plusieurs agrégats indépendants en une passe', async () => {
    const aggregateType = 'test-physical_unit';
    const ids = [`P1-${Date.now()}`, `P2-${Date.now()}`, `P3-${Date.now()}`];
    const events = [];
    for (const aggregateId of ids) {
      events.push(await insertEvent({ aggregateType, aggregateId }));
    }

    const pending = await listPendingAggregates(pool, 20);
    const pendingIds = pending
      .filter((a) => a.aggregateType === aggregateType && ids.includes(a.aggregateId))
      .map((a) => a.aggregateId);
    expect(pendingIds.sort()).toEqual([...ids].sort());

    const results = await pollOnce(pool, { concurrency: 20 });
    const relevant = results.filter((r) => ids.includes(r.aggregateId));
    expect(relevant).toHaveLength(3);
    expect(relevant.every((r) => r.outcome === 'processed')).toBe(true);

    for (const event of events) {
      expect(await countReceipts(event.id)).toBe(1);
    }
  });

  test('aucune écriture Purchasing/Orders/refund', () => {
    const src = fs.readFileSync(require.resolve('../../services/outbox-worker'), 'utf8');
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
