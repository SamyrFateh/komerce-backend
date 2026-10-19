/**
 * @komerce-arch
 * @role          manual-cost-entry
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        order id, cost type, amount (KMF), provenance, reason, idempotency key, actor
 * @outputs       real cost allocations (manual_entry) distributed over order lines, append-only journal
 * @depends       services/cost-allocation/_helpers.js, services/cost-allocation/cost-expectation.js, services/simulation-scope-service.js
 * @used-by       routes/admin-costing.js
 * @db-read       orders, order_items, order_item_real_cost_allocations, order_cost_entry_events
 * @db-write      order_item_real_cost_allocations, order_cost_entry_events
 * @db-txn        caller_transaction_preserved
 * @doctrine      traceable_manual_entry, no_double_count, never_unknown_as_zero, simulated_facts_never_real_activity
 * @impact-areas  finance, margin, recette
 * @version       2026-10
 */
'use strict';

const { shareByWeight } = require('./_helpers');
const { isSimulatedProvenance } = require('../simulation-scope-service');
const { applicabilitySql, notApplicableMotif } = require('./cost-expectation');

/**
 * L1 — Saisie manuelle TRAÇABLE d'un coût réel au niveau commande, pour les seuls types sans
 * collecteur automatique. Réutilise le mécanisme d'allocation existant (lignes
 * order_item_real_cost_allocations, ventilation conservative shareByWeight au plus grand reste)
 * et le modèle de correction existant (remplacement idempotent des lignes d'une même source),
 * complété d'un journal append-only (ancienne et nouvelle valeur, auteur, motif).
 *
 * Garde-fous :
 *  - jamais pour un coût non applicable à la commande (même règle que la complétude) ;
 *  - jamais pour un type alimenté automatiquement (fret, douane, port, achat, relais) → pas de double compte ;
 *  - refus si une allocation réelle NON manuelle existe déjà pour ce type sur la commande ;
 *  - une saisie existante ne se ressaisit pas : correction explicite, tracée ;
 *  - provenance et motif obligatoires ; une provenance « FICTIF » n'est admise que sur une commande
 *    d'un périmètre de recette, et une commande de recette n'admet que des faits simulés (FICTIF).
 */
const MANUAL_COST_TYPES = Object.freeze(['payment', 'sourcing', 'packaging', 'hub', 'local_distribution']);
const SOURCE = 'manual_entry';

function fail(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function validate({ costType, amountKmf, provenance, reason, idempotencyKey }) {
  if (!MANUAL_COST_TYPES.includes(costType)) {
    throw fail('MANUAL_COST_TYPE_NOT_ALLOWED', `Type ${costType} : saisie manuelle non autorisée (collecteur automatique ou type inconnu)`, 400);
  }
  const amount = Number(amountKmf);
  if (!Number.isInteger(amount) || amount < 0) throw fail('MANUAL_COST_AMOUNT_INVALID', 'Montant entier ≥ 0 en KMF requis', 400);
  if (!provenance || !String(provenance).trim()) throw fail('MANUAL_COST_PROVENANCE_REQUIRED', 'Provenance requise', 400);
  if (!reason || !String(reason).trim()) throw fail('MANUAL_COST_REASON_REQUIRED', 'Motif ou référence de pièce requis', 400);
  if (!idempotencyKey || !String(idempotencyKey).trim()) throw fail('MANUAL_COST_IDEMPOTENCY_REQUIRED', 'Clé d\'idempotence requise', 400);
  return amount;
}

async function loadOrder(executor, orderId, actorMarketId) {
  const { rows: [order] } = await executor.query(
    'SELECT id, market_id, simulation_scope FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!order) throw fail('ORDER_NOT_FOUND', 'Commande introuvable', 404);
  if (actorMarketId && order.market_id && actorMarketId !== order.market_id) {
    throw fail('MANUAL_COST_MARKET_FORBIDDEN', 'Commande hors du marché de l\'auteur', 403);
  }
  return order;
}

function assertProvenanceMatchesScope(order, provenance) {
  const simulated = isSimulatedProvenance(provenance);
  if (simulated && !order.simulation_scope) {
    throw fail('SIMULATED_FACT_ON_REAL_ORDER', 'Un fait simulé (FICTIF) ne peut pas être saisi sur une commande d\'activité réelle');
  }
  if (!simulated && order.simulation_scope) {
    throw fail('REAL_FACT_ON_SIMULATED_ORDER', `Commande du périmètre de recette ${order.simulation_scope} : provenance FICTIF obligatoire`);
  }
}

/** Même règle d'applicabilité que la complétude (D1/L2) : un coût non applicable ne se saisit pas. */
async function assertApplicable(executor, orderId, costType) {
  const { rows: [r] } = await executor.query(
    `SELECT (${applicabilitySql(costType, 'o')}) AS applicable
       FROM orders o
      WHERE o.id = $1`, [orderId]);
  if (r && r.applicable === false) {
    throw fail('COST_NOT_APPLICABLE', `Coût ${costType} non applicable à cette commande : ${notApplicableMotif(costType)}`);
  }
}

/** Ventilation sur les lignes, au prorata de la valeur de ligne (prix × quantité), total conservé. */
async function distribute(executor, orderId, amount) {
  const { rows: lines } = await executor.query(
    'SELECT id, price_kmf, quantity FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  if (!lines.length) throw fail('ORDER_HAS_NO_LINES', 'Commande sans ligne : ventilation impossible');
  return shareByWeight(amount, lines.map((l) => ({ id: l.id, weight: Number(l.price_kmf) * Number(l.quantity) })));
}

async function insertShares(executor, { orderId, costType, shares, provenance, reason, actorId }) {
  for (const s of shares) {
    await executor.query(
      `INSERT INTO order_item_real_cost_allocations
         (order_id, order_item_id, cost_type, amount_kmf, allocation_method, source, is_actual, confidence, notes, created_by, provenance)
       VALUES ($1, $2, $3, $4, 'manual', $5, TRUE, 'medium', $6, $7, $8)`,
      [orderId, s.id, costType, s.share, SOURCE, String(reason).trim(), actorId || null, String(provenance).trim()]);
  }
}

async function findEvent(executor, idempotencyKey) {
  const { rows: [ev] } = await executor.query(
    'SELECT id, order_id, cost_type, event_type, new_value FROM order_cost_entry_events WHERE idempotency_key = $1',
    [idempotencyKey]);
  return ev || null;
}

async function existingRows(executor, orderId, costType) {
  const { rows } = await executor.query(
    `SELECT order_item_id, amount_kmf, source, provenance, is_actual
       FROM order_item_real_cost_allocations
      WHERE order_id = $1 AND cost_type = $2`, [orderId, costType]);
  return {
    manual: rows.filter((r) => r.source === SOURCE),
    automatic: rows.filter((r) => r.source !== SOURCE && r.is_actual === true),
  };
}

async function recordManualCost(executor, input = {}) {
  const amount = validate(input);
  const { orderId, costType, provenance, reason, idempotencyKey, actorId = null, actorMarketId = null, eventDate = null } = input;
  const prior = await findEvent(executor, idempotencyKey);
  if (prior) {
    if (prior.order_id !== orderId || prior.cost_type !== costType) throw fail('IDEMPOTENCY_KEY_REUSED', 'Clé d\'idempotence déjà utilisée pour une autre saisie');
    return { order_id: orderId, cost_type: costType, already: true };
  }
  const order = await loadOrder(executor, orderId, actorMarketId);
  assertProvenanceMatchesScope(order, provenance);
  await assertApplicable(executor, orderId, costType);
  const { manual, automatic } = await existingRows(executor, orderId, costType);
  if (automatic.length) throw fail('AUTO_COLLECTED', `Un coût réel ${costType} existe déjà par un collecteur : saisie refusée (double compte)`);
  if (manual.length) throw fail('MANUAL_COST_EXISTS', 'Saisie déjà présente : utiliser la correction tracée');

  const shares = await distribute(executor, orderId, amount);
  await insertShares(executor, { orderId, costType, shares, provenance, reason, actorId });
  await executor.query(
    `INSERT INTO order_cost_entry_events
       (order_id, event_type, cost_type, idempotency_key, new_value, provenance, reason, actor_id)
     VALUES ($1, 'manual_cost_entered', $2, $3, $4::jsonb, $5, $6, $7)`,
    [orderId, costType, idempotencyKey, JSON.stringify({ amount_kmf: amount, event_date: eventDate, lines: shares }),
      String(provenance).trim(), String(reason).trim(), actorId]);
  return { order_id: orderId, cost_type: costType, amount_kmf: amount, lines: shares, already: false };
}

async function correctManualCost(executor, input = {}) {
  const amount = validate(input);
  const { orderId, costType, provenance, reason, idempotencyKey, actorId = null, actorMarketId = null } = input;
  const prior = await findEvent(executor, idempotencyKey);
  if (prior) {
    if (prior.order_id !== orderId || prior.cost_type !== costType) throw fail('IDEMPOTENCY_KEY_REUSED', 'Clé d\'idempotence déjà utilisée pour une autre saisie');
    return { order_id: orderId, cost_type: costType, already: true };
  }
  const order = await loadOrder(executor, orderId, actorMarketId);
  assertProvenanceMatchesScope(order, provenance);
  const { manual } = await existingRows(executor, orderId, costType);
  if (!manual.length) throw fail('MANUAL_COST_NOT_FOUND', 'Aucune saisie manuelle à corriger', 404);

  await executor.query(
    'DELETE FROM order_item_real_cost_allocations WHERE order_id = $1 AND cost_type = $2 AND source = $3',
    [orderId, costType, SOURCE]);
  const shares = await distribute(executor, orderId, amount);
  await insertShares(executor, { orderId, costType, shares, provenance, reason, actorId });
  await executor.query(
    `INSERT INTO order_cost_entry_events
       (order_id, event_type, cost_type, idempotency_key, old_value, new_value, provenance, reason, actor_id)
     VALUES ($1, 'manual_cost_corrected', $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)`,
    [orderId, costType, idempotencyKey, JSON.stringify({ lines: manual }), JSON.stringify({ amount_kmf: amount, lines: shares }),
      String(provenance).trim(), String(reason).trim(), actorId]);
  return { order_id: orderId, cost_type: costType, amount_kmf: amount, lines: shares, corrected: true };
}

module.exports = { MANUAL_COST_TYPES, SOURCE, recordManualCost, correctManualCost };
