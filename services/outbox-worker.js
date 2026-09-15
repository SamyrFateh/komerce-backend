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
 * Garanties et comment elles sont obtenues :
 *
 *   - claim sûr (pas de double-claim)   -> FOR UPDATE SKIP LOCKED sur la ligne
 *   - un seul event in-flight / agrégat -> pg_try_advisory_xact_lock(hashtext(type:id)),
 *                                          transaction-scoped : tenu pendant TOUT le
 *                                          traitement (pas juste le claim), relâché au
 *                                          COMMIT/ROLLBACK. Un concurrent qui essaie le
 *                                          même agrégat pendant ce temps échoue le TRY
 *                                          (non-bloquant) et repasse au cycle suivant —
 *                                          il ne peut donc JAMAIS s'exécuter avant que le
 *                                          premier ait terminé (complété ou annulé).
 *   - parallélisme entre agrégats       -> agrégats différents = clés de hash différentes,
 *                                          traités en Promise.all sur des clients pg
 *                                          distincts, aucune contention entre eux.
 *   - ordre causal PAR agrégat          -> on ne claim jamais que l'événement le PLUS
 *                                          ANCIEN non traité de l'agrégat (MIN(created_at)
 *                                          scindé par agrégat) ; combiné à la règle
 *                                          ci-dessus, l'événement suivant du même agrégat
 *                                          ne peut être vu qu'au cycle d'après, une fois le
 *                                          précédent COMMIT (donc processed_at posé) ou
 *                                          ROLLBACK (donc toujours le plus ancien pendant).
 *   - idempotence                       -> INSERT ... ON CONFLICT (event_id, consumer_key)
 *                                          DO NOTHING dans physical_outcome_receipts (déjà
 *                                          contraint en DB, pas une convention applicative).
 *   - ACK                               -> processed_at posé UNIQUEMENT dans la même
 *                                          transaction que l'écriture du reçu : soit les
 *                                          deux sont commit ensemble, soit ni l'un ni
 *                                          l'autre (crash = ROLLBACK implicite côté
 *                                          Postgres à la perte de connexion). Donc jamais
 *                                          de reçu écrit sans ACK, jamais d'ACK sans reçu.
 *   - retry durable                     -> attempts/last_error survivent même à un échec
 *                                          métier (pas un crash) via une écriture COURTE
 *                                          et SÉPARÉE après ROLLBACK de la transaction
 *                                          principale (sinon le ROLLBACK effacerait aussi
 *                                          le compteur de tentative qu'on veut garder).
 *
 * Hors scope F0 (doctrine) : aucune mutation Purchasing/Orders/refund/reorder. Le
 * consumer réel de ce lot est physical_outcome_receipts uniquement — HUB-001 branchera
 * les vrais consumers métier plus tard, chacun avec son propre consumer_key.
 */

'use strict';

const DEFAULT_CONSUMER_KEY = 'physical_outcome_receipts_v1';

/**
 * Trouve les agrégats ayant au moins un événement non traité, les plus anciens en tête.
 * Lecture seule, hors transaction — sert seulement à distribuer le travail entre workers
 * concurrents ; le claim réel (et donc la vérité) se fait dans processAggregateOnce().
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

/**
 * Écrit le reçu d'audit durable (consumer minimal réel F0). Aucun effet métier.
 * Idempotence garantie par la contrainte UNIQUE(event_id, consumer_key) en DB.
 */
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
 * Traite AU PLUS UN événement pour un agrégat donné, avec toutes les garanties
 * documentées en tête de fichier. Retourne un résumé — ne lève jamais (les erreurs
 * métier sont capturées et reflétées dans le résumé + persistées en DB).
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
      // Un autre worker traite déjà cet agrégat — on ne bloque jamais, on repasse
      // simplement au cycle suivant. C'est ce non-blocage qui garantit qu'on ne
      // s'exécute jamais AVANT la fin du traitement en cours du même agrégat.
      await client.query('ROLLBACK');
      return { aggregateType, aggregateId, outcome: 'skipped_locked' };
    }

    const { rows: claimRows } = await client.query(
      `SELECT id, aggregate_type, aggregate_id, payload
       FROM outbox_events
       WHERE aggregate_type = $1 AND aggregate_id = $2 AND processed_at IS NULL
       ORDER BY created_at ASC
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
    return { aggregateType, aggregateId, outcome: 'processed', eventId: claimedEvent.id };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // connexion déjà perdue (ex. crash simulé) — rien à faire, le ROLLBACK
      // implicite de Postgres à la fermeture de connexion s'en charge.
    }

    // La transaction principale est annulée (donc le reçu éventuellement déjà
    // inséré dans CETTE transaction repart aussi — pas de reçu orphelin sans ACK).
    // On persiste attempts/last_error séparément : sinon le ROLLBACK effacerait
    // la preuve de la tentative, et le retry durable ne serait plus prouvable.
    if (claimedEvent) {
      try {
        await pool.query(
          `UPDATE outbox_events
           SET attempts = attempts + 1, last_error = $2
           WHERE id = $1`,
          [claimedEvent.id, String(err && err.message ? err.message : err)]
        );
      } catch (bookkeepingErr) {
        // best-effort : si même cette écriture échoue, l'événement reste pending
        // et sera retenté au cycle suivant — pas de perte, juste un attempts
        // sous-compté pour ce tour.
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
 * Un cycle de poll : distribue jusqu'à `concurrency` agrégats en parallèle,
 * un événement (le plus ancien pending) par agrégat. Sûr à appeler en boucle
 * (setInterval) ou depuis plusieurs instances de process — toute la sûreté
 * vient du verrou advisory par agrégat + FOR UPDATE SKIP LOCKED, pas d'un
 * quelconque état en mémoire de ce module.
 */
async function pollOnce(pool, { concurrency = 10, consumerKey = DEFAULT_CONSUMER_KEY } = {}) {
  const aggregates = await listPendingAggregates(pool, concurrency);
  if (aggregates.length === 0) {
    return [];
  }
  return Promise.all(
    aggregates.map((agg) => processAggregateOnce(pool, agg, { consumerKey }))
  );
}

/**
 * Démarre une boucle de poll continue. Retourne une fonction stop().
 * Hors scope des tests unitaires/intégration (qui appellent pollOnce()/
 * processAggregateOnce() directement pour un contrôle déterministe) — utilisée
 * seulement par le futur point d'entrée process worker (HUB-001).
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
      if (!stopped) {
        timer = setTimeout(tick, intervalMs);
      }
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
  processAggregateOnce,
  pollOnce,
  startPolling,
};
