/**
 * @komerce-arch
 * @role          outbox-worker
 * @domain        infrastructure
 * @layer         service
 * @criticality   critical
 * @inputs        pg_pool
 * @outputs       physical_outcome_receipts rows, outbox_events.processed_at
 * @depends       none
 * @used-by       futur HUB-001 (Physical Identity, Allocation & Custody), scripts de démarrage worker
 * @db-read       outbox_events
 * @db-write      outbox_events, physical_outcome_receipts
 * @db-txn        opens_and_commits_own — seul module F0 autorisé à gérer sa propre transaction (le producer ne le fait jamais)
 * @doctrine      HUB-000 F0 (transactional outbox lite)
 * @impact-areas  infrastructure, logistics
 * @version       2026-09
 *
 * HUB-000 / F0 — Outbox Worker (durable consumer).
 *
 * Garanties :
 *   - claim sûr                    -> FOR UPDATE SKIP LOCKED sur la ligne
 *   - un seul event / agrégat      -> pg_try_advisory_xact_lock(hashtext(type:id))
 *   - parallélisme inter-agrégats  -> clés de verrou distinctes + clients pg distincts
 *   - ordre causal intra-agrégat   -> plus petit aggregate_sequence pending, jamais created_at
 *   - idempotence                  -> UNIQUE(event_id, consumer_key) + ON CONFLICT DO NOTHING
 *   - ACK atomique                 -> reçu + processed_at dans la même transaction
 *   - retry durable                -> attempts/last_error persistés après rollback, sous le même verrou d'agrégat
 *
 * created_at reste une heuristique d'équité ENTRE agrégats ; il ne porte
 * jamais l'ordre causal. Le producer attribue aggregate_sequence sous le même
 * verrou d'agrégat que celui utilisé ici.
 *
 * Hors scope F0 : aucune mutation Purchasing/Orders/refund/reorder.
 */

'use strict';

const DEFAULT_CONSUMER_KEY = 'physical_outcome_receipts_v1';

/**
 * Liste les agrégats ayant au moins un événement pending. created_at sert
 * uniquement à l'équité entre agrégats ; le claim intra-agrégat est ordonné
 * exclusivement par aggregate_sequence.
 */
async function listPendingAggregates(pool, limit) {
  const { rows } = await pool.query(
    `SELECT DISTINCT aggregate_type, aggregate_id,
            MIN(created_at) OVER (PARTITION BY aggregate_type, aggregate_id) AS oldest
     FROM outbox_events
     WHERE processed_at IS NULL
     ORDER BY oldest ASC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({ aggregateType: r.aggregate_type, aggregateId: r.aggregate_id }));
}

async function writeReceipt(executor, { eventId, consumerKey, aggregateType, aggregateId, payload }) {
  await executor.query(
    `INSERT INTO physical_outcome_receipts
       (event_id, consumer_key, aggregate_type, aggregate_id, outcome_type, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (event_id, consumer_key) DO NOTHING`,
    [eventId, consumerKey, aggregateType, aggregateId, payload.outcome_type, JSON.stringify(payload)]
  );
}

/**
 * Persiste attempts/last_error après rollback de la transaction principale.
 * Le même verrou d'agrégat est repris, et processed_at IS NULL empêche un
 * échec retardataire de salir un événement déjà traité avec succès.
 */
async function recordFailure(pool, { aggregateType, aggregateId, eventId, message }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${aggregateType}:${aggregateId}`]);
    await client.query(
      `UPDATE outbox_events
       SET attempts = attempts + 1, last_error = $2
       WHERE id = $1
         AND processed_at IS NULL`,
      [eventId, message]
    );
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Connexion perdue : Postgres rollback implicitement.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Traite au plus un événement pour un agrégat donné.
 */
async function processAggregateOnce(pool, { aggregateType, aggregateId }, { consumerKey = DEFAULT_CONSUMER_KEY } = {}) {
  const client = await pool.connect();
  const lockArg = `${aggregateType}:${aggregateId}`;
  let claimedEvent = null;

  try {
    await client.query('BEGIN');

    const { rows: lockRows } = await client.query(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
      [lockArg]
    );
    if (!lockRows[0].locked) {
      await client.query('ROLLBACK');
      return { aggregateType, aggregateId, outcome: 'skipped_locked' };
    }

    const { rows: claimRows } = await client.query(
      `SELECT id, aggregate_type, aggregate_id, aggregate_sequence, payload
       FROM outbox_events
       WHERE aggregate_type = $1
         AND aggregate_id = $2
         AND processed_at IS NULL
       ORDER BY aggregate_sequence ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [aggregateType, aggregateId]
    );

    if (claimRows.length === 0) {
      await client.query('ROLLBACK');
      return { aggregateType, aggregateId, outcome: 'no_pending_event' };
    }

    claimedEvent = claimRows[0];

    await writeReceipt(client, {
      eventId: claimedEvent.id,
      consumerKey,
      aggregateType: claimedEvent.aggregate_type,
      aggregateId: claimedEvent.aggregate_id,
      payload: claimedEvent.payload,
    });

    await client.query(
      `UPDATE outbox_events
       SET processed_at = NOW(), attempts = attempts + 1, last_error = NULL
       WHERE id = $1`,
      [claimedEvent.id]
    );

    await client.query('COMMIT');
    return {
      aggregateType,
      aggregateId,
      outcome: 'processed',
      eventId: claimedEvent.id,
      aggregateSequence: Number(claimedEvent.aggregate_sequence),
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Connexion déjà perdue : rollback implicite côté Postgres.
    }

    if (claimedEvent) {
      try {
        await recordFailure(pool, {
          aggregateType,
          aggregateId,
          eventId: claimedEvent.id,
          message: String(err && err.message ? err.message : err),
        });
      } catch (bookkeepingErr) {
        // Best effort : l'événement reste pending et sera retenté. Une panne de
        // bookkeeping ne doit jamais transformer un échec en perte d'événement.
      }
    }

    return {
      aggregateType,
      aggregateId,
      outcome: 'error',
      error: String(err && err.message ? err.message : err),
      eventId: claimedEvent ? claimedEvent.id : null,
    };
  } finally {
    client.release();
  }
}

/**
 * Un cycle de poll : jusqu'à `concurrency` agrégats indépendants en parallèle,
 * un événement au plus par agrégat.
 */
async function pollOnce(pool, { concurrency = 10, consumerKey = DEFAULT_CONSUMER_KEY } = {}) {
  const aggregates = await listPendingAggregates(pool, concurrency);
  if (aggregates.length === 0) return [];
  return Promise.all(
    aggregates.map((agg) => processAggregateOnce(pool, agg, { consumerKey }))
  );
}

/**
 * Boucle continue optionnelle. HUB-001 décidera du point d'entrée process.
 */
function startPolling(pool, { intervalMs = 1000, concurrency = 10, consumerKey = DEFAULT_CONSUMER_KEY, onCycle } = {}) {
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    try {
      const results = await pollOnce(pool, { concurrency, consumerKey });
      if (onCycle) onCycle(results);
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  }

  timer = setTimeout(tick, 0);

  return function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

module.exports = {
  DEFAULT_CONSUMER_KEY,
  listPendingAggregates,
  recordFailure,
  processAggregateOnce,
  pollOnce,
  startPolling,
};
