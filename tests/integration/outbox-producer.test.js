'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */
/**
 * @integration  outbox-producer.test.js
 * @brief HUB-000 / F0 — Contrat du producer outbox sur PostgreSQL réel.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const { reportPhysicalOutcome, VALID_OUTCOME_TYPES } = require('../../services/outbox-producer');
const { processAggregateOnce, recordFailure } = require('../../services/outbox-worker');

jest.setTimeout(20000);

async function inTransaction(fn, { commit = true } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // rollback implicite si la connexion est déjà perdue
    }
    throw err;
  } finally {
    client.release();
  }
}

async function sequencesFor(aggregateType, aggregateId) {
  const { rows } = await pool.query(
    `SELECT aggregate_sequence FROM outbox_events
     WHERE aggregate_type = $1 AND aggregate_id = $2
     ORDER BY aggregate_sequence ASC`,
    [aggregateType, aggregateId]
  );
  return rows.map((r) => Number(r.aggregate_sequence));
}

async function waitForBlockedAdvisoryLock(maxPolls = 500) {
  for (let i = 0; i < maxPolls; i += 1) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM pg_locks
        WHERE locktype = 'advisory'
          AND NOT granted`
    );
    if (rows[0].n > 0) return;
  }
  throw new Error('aucun verrou advisory en attente observé');
}

afterAll(async () => {
  await pool.end();
});

describe('outbox-producer — garde-fous', () => {
  test('refuse un executor invalide', async () => {
    await expect(
      reportPhysicalOutcome(null, { aggregateType: 't', aggregateId: 'x', outcomeType: 'LOST' })
    ).rejects.toThrow(TypeError);
  });

  test('whitelist outcomeType fermée', async () => {
    expect([...VALID_OUTCOME_TYPES].sort()).toEqual(
      ['DAMAGED_UNUSABLE', 'DESTROYED', 'LOST', 'STOLEN']
    );
    await expect(
      inTransaction((c) => reportPhysicalOutcome(c, {
        aggregateType: 'test-physical_unit',
        aggregateId: `GUARD-${Date.now()}`,
        outcomeType: 'EXPLODED',
      }))
    ).rejects.toThrow(/outcomeType invalide/);
  });
});

describe('outbox-producer — atomicité et séquence', () => {
  test('rollback appelant = événement disparu', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `ROLLBACK-${Date.now()}`;
    const id = await inTransaction(
      (c) => reportPhysicalOutcome(c, { aggregateType, aggregateId, outcomeType: 'LOST' }),
      { commit: false }
    );
    const { rows } = await pool.query('SELECT id FROM outbox_events WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  test('séquence démarre à 1 et croît strictement par agrégat', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `SEQ-${Date.now()}`;
    await inTransaction((c) => reportPhysicalOutcome(c, { aggregateType, aggregateId, outcomeType: 'LOST' }));
    await inTransaction((c) => reportPhysicalOutcome(c, { aggregateType, aggregateId, outcomeType: 'STOLEN' }));
    await inTransaction((c) => reportPhysicalOutcome(c, { aggregateType, aggregateId, outcomeType: 'DESTROYED' }));
    expect(await sequencesFor(aggregateType, aggregateId)).toEqual([1, 2, 3]);
  });

  test('deux agrégats ont des séquences indépendantes', async () => {
    const aggregateType = 'test-physical_unit';
    const aggA = `A-${Date.now()}`;
    const aggB = `B-${Date.now()}`;
    await inTransaction((c) => reportPhysicalOutcome(c, { aggregateType, aggregateId: aggA, outcomeType: 'LOST' }));
    await inTransaction((c) => reportPhysicalOutcome(c, { aggregateType, aggregateId: aggB, outcomeType: 'LOST' }));
    await inTransaction((c) => reportPhysicalOutcome(c, { aggregateType, aggregateId: aggA, outcomeType: 'STOLEN' }));
    expect(await sequencesFor(aggregateType, aggA)).toEqual([1, 2]);
    expect(await sequencesFor(aggregateType, aggB)).toEqual([1]);
  });

  test('UNIQUE rejette une séquence dupliquée', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `UNIQ-${Date.now()}`;
    await inTransaction((c) => reportPhysicalOutcome(c, { aggregateType, aggregateId, outcomeType: 'LOST' }));
    await expect(
      pool.query(
        `INSERT INTO outbox_events
           (aggregate_type, aggregate_id, aggregate_sequence, event_type, payload)
         VALUES ($1, $2, 1, 'physical_outcome_reported', '{"outcome_type":"LOST"}'::jsonb)`,
        [aggregateType, aggregateId]
      )
    ).rejects.toThrow(/uq_outbox_events_aggregate_sequence/);
  });
});

describe('outbox-producer — ordre causal concurrent', () => {
  test('T2 ne peut pas doubler T1 sur le même agrégat', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `CONCURRENT-${Date.now()}`;

    const t1 = await pool.connect();
    const t2 = await pool.connect();
    try {
      await t1.query('BEGIN');
      const id1 = await reportPhysicalOutcome(t1, { aggregateType, aggregateId, outcomeType: 'LOST' });

      let t2Settled = false;
      const t2Promise = (async () => {
        await t2.query('BEGIN');
        const id = await reportPhysicalOutcome(t2, { aggregateType, aggregateId, outcomeType: 'STOLEN' });
        await t2.query('COMMIT');
        return id;
      })().then((v) => { t2Settled = true; return v; });

      await waitForBlockedAdvisoryLock();
      expect(t2Settled).toBe(false);

      const early = await processAggregateOnce(pool, { aggregateType, aggregateId });
      expect(early.outcome).toBe('skipped_locked');

      await t1.query('COMMIT');
      const id2 = await t2Promise;

      const { rows } = await pool.query(
        `SELECT id, aggregate_sequence FROM outbox_events
         WHERE aggregate_type = $1 AND aggregate_id = $2
         ORDER BY aggregate_sequence ASC`,
        [aggregateType, aggregateId]
      );
      expect(rows.map((r) => r.id)).toEqual([id1, id2]);
      expect(rows.map((r) => Number(r.aggregate_sequence))).toEqual([1, 2]);

      const first = await processAggregateOnce(pool, { aggregateType, aggregateId });
      const second = await processAggregateOnce(pool, { aggregateType, aggregateId });
      expect([first.eventId, second.eventId]).toEqual([id1, id2]);
    } finally {
      try { await t1.query('ROLLBACK'); } catch (_) {}
      try { await t2.query('ROLLBACK'); } catch (_) {}
      t1.release();
      t2.release();
    }
  });

  test('agrégats différents restent indépendants', async () => {
    const aggregateType = 'test-physical_unit';
    const aggA = `IND-A-${Date.now()}`;
    const aggB = `IND-B-${Date.now()}`;

    const tA = await pool.connect();
    try {
      await tA.query('BEGIN');
      const idA = await reportPhysicalOutcome(tA, { aggregateType, aggregateId: aggA, outcomeType: 'LOST' });
      const idB = await inTransaction((c) => reportPhysicalOutcome(c, {
        aggregateType,
        aggregateId: aggB,
        outcomeType: 'DESTROYED',
      }));

      const resB = await processAggregateOnce(pool, { aggregateType, aggregateId: aggB });
      expect(resB.eventId).toBe(idB);

      await tA.query('COMMIT');
      const resA = await processAggregateOnce(pool, { aggregateType, aggregateId: aggA });
      expect(resA.eventId).toBe(idA);
    } finally {
      try { await tA.query('ROLLBACK'); } catch (_) {}
      tA.release();
    }
  });
});

describe('outbox-worker — retry bookkeeping race', () => {
  test('recordFailure sur événement traité est un no-op', async () => {
    const aggregateType = 'test-physical_unit';
    const aggregateId = `RACE-${Date.now()}`;
    const eventId = await inTransaction((c) => reportPhysicalOutcome(c, {
      aggregateType,
      aggregateId,
      outcomeType: 'LOST',
    }));
    const ok = await processAggregateOnce(pool, { aggregateType, aggregateId });
    expect(ok.outcome).toBe('processed');

    const { rows: beforeRows } = await pool.query('SELECT * FROM outbox_events WHERE id = $1', [eventId]);
    await recordFailure(pool, {
      aggregateType,
      aggregateId,
      eventId,
      message: 'late failure',
    });
    const { rows: afterRows } = await pool.query('SELECT * FROM outbox_events WHERE id = $1', [eventId]);
    expect(afterRows[0].last_error).toBeNull();
    expect(afterRows[0].attempts).toBe(beforeRows[0].attempts);
    expect(afterRows[0].processed_at).toEqual(beforeRows[0].processed_at);
  });
});
