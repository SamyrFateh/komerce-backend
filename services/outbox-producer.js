/**
 * @komerce-arch
 * @role          outbox-producer
 * @domain        infrastructure
 * @layer         service
 * @criticality   critical
 * @inputs        caller_owned_executor (DOIT être dans une transaction déjà ouverte), event fields
 * @outputs       outbox_events row id
 * @depends       none
 * @used-by       futur HUB-001 (Physical Identity, Allocation & Custody)
 * @db-read       none
 * @db-write      outbox_events
 * @db-txn        caller-owned — ce module n'ouvre JAMAIS sa propre transaction
 * @doctrine      HUB-000 F0 (transactional outbox lite)
 * @impact-areas  infrastructure, logistics
 * @version       2026-09
 *
 * HUB-000 / F0 — Outbox Producer.
 *
 * Règle dure : reportPhysicalOutcome() ne fait JAMAIS BEGIN/COMMIT lui-même.
 * L'appelant (le futur code Hub qui écrit le fait physique) doit passer un
 * `executor` déjà à l'intérieur d'une transaction ouverte sur la même
 * connexion que l'écriture du fait métier — c'est la SEULE façon de garantir
 * l'atomicité fait+événement. Un appel hors transaction n'est pas détecté ici
 * (ce module ne peut pas vérifier l'état transactionnel du client), mais viole
 * la doctrine — la responsabilité d'atomicité appartient à l'appelant.
 *
 * Aucun emit()/setImmediate()/callback post-COMMIT/appel direct vers
 * Purchasing ou Orders : ce module écrit une ligne, un point.
 */

'use strict';

const VALID_OUTCOME_TYPES = new Set(['LOST', 'STOLEN', 'DESTROYED', 'DAMAGED_UNUSABLE']);

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('outbox-producer: executor.query requis (client déjà en transaction, pas un pool)');
  }
  return executor;
}

/**
 * Écrit un événement physical_outcome_reported dans outbox_events, dans la
 * transaction de l'appelant. Ne committe rien. Retourne l'id de l'événement.
 *
 * @param {object} executor - client pg déjà en BEGIN (jamais un Pool)
 * @param {object} params
 * @param {string} params.aggregateType - ex. 'physical_unit' (libre, non contraint en DB pour rester générique — voir doctrine)
 * @param {string} params.aggregateId   - identifiant de l'agrégat physique concerné
 * @param {string} params.outcomeType   - LOST | STOLEN | DESTROYED | DAMAGED_UNUSABLE
 * @param {object} [params.details]     - détails additionnels, fusionnés dans payload
 */
async function reportPhysicalOutcome(executor, { aggregateType, aggregateId, outcomeType, details = {} }) {
  const q = requireExecutor(executor);

  if (!aggregateType || typeof aggregateType !== 'string') {
    throw new TypeError('outbox-producer: aggregateType requis');
  }
  if (!aggregateId || typeof aggregateId !== 'string') {
    throw new TypeError('outbox-producer: aggregateId requis');
  }
  if (!VALID_OUTCOME_TYPES.has(outcomeType)) {
    throw new TypeError(`outbox-producer: outcomeType invalide "${outcomeType}" (attendu: ${[...VALID_OUTCOME_TYPES].join(', ')})`);
  }
  if (details !== null && typeof details !== 'object') {
    throw new TypeError('outbox-producer: details doit être un objet');
  }

  const payload = Object.assign({}, details, { outcome_type: outcomeType });

  const { rows } = await q.query(
    `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, $2, 'physical_outcome_reported', $3::jsonb)
     RETURNING id`,
    [aggregateType, aggregateId, JSON.stringify(payload)]
  );

  return rows[0].id;
}

module.exports = {
  VALID_OUTCOME_TYPES,
  reportPhysicalOutcome,
};
