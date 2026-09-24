/**
 * @komerce-arch
 * @role          catalog-stock-sync-decision
 * @domain        catalog
 * @layer         service
 * @criticality   critical
 * @inputs        immutable_stock_delta_observation_id
 * @outputs       explicit_auditable_stock_application_decision
 * @depends       db.js, services/sourcing-catalog-change-sku-identity-proof.js
 * @used-by       services/catalog-stock-sync-application.js, tests/unit/catalog-stock-sync-decision.test.js, tests/integration/catalog-stock-sync-decision-real-db.test.js
 * @db-read       catalog_stock_sync_state, purchase_orders, product_skus, sourcing_captures, sourcing_observations
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_CHANGE_INTAKE.md, docs/specs/DECISION_MODELE_STOCK_SKU.md, docs/doctrine/DOCTRINE_FULFILLMENT_MIXTE.md
 * @impact-areas  catalog, orders, purchasing, local-stock
 * @version       2026-09
 *
 * MISSION 1 — décideur métier de l'application d'une observation de stock
 * fournisseur. Chaîne : observation (sourcing-catalog-change-observation.js,
 * lecture seule) -> identité Canonical Unit (sourcing-catalog-change-unit-
 * resolution-proof.js, lecture seule) -> identité SKU (sourcing-catalog-
 * change-sku-identity-proof.js, lecture seule) -> CE DÉCIDEUR -> application
 * contrôlée (catalog-stock-sync-application.js).
 *
 * Ce fichier NE MODIFIE RIEN. Un verdict favorable ici n'autorise pas
 * l'écriture à lui seul : catalog-stock-sync-application.js réévalue cette
 * même décision SOUS VERROU au moment de l'écriture (cf. ce fichier,
 * doctrine §Concurrence) avant toute mutation.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Ce que ce décideur sait et ne sait PAS (audit préalable, voir PR) :
 *
 * - product_skus.stock est la SEULE vérité de quantité vendable pour un SKU
 *   en mode SKU (DECISION_MODELE_STOCK_SKU.md). Un seul writer existe :
 *   product-stock-service.js#adjustStock, à sémantique de MOUVEMENT RELATIF
 *   (+/-), jamais d'écriture absolue. Ce décideur ne transforme PAS
 *   l'observation en delta : il produit un verdict que
 *   catalog-stock-sync-application.js applique par une écriture absolue
 *   SÉPARÉE et EXPLICITE (SET stock = valeur), jamais via adjustStock().
 *
 * - local_stock (DOCTRINE_FULFILLMENT_MIXTE.md) est un système ENTIÈREMENT
 *   SÉPARÉ de stock physique réellement détenu par Komerce par marché, avec
 *   sa propre table et son propre cycle d'allocation. Une observation
 *   fournisseur ne concerne QUE le chemin IMPORT/dropship. Ce décideur ne
 *   touche jamais local_stock — la preuve d'identité SKU en amont a déjà
 *   vérifié product_skus.source='SUPPLIER' (implicite : sans ça, aucune
 *   sourcing_candidates/sourcing_captures liée n'existerait).
 *
 * - Entre la confirmation d'un paiement Komerce et la confirmation
 *   effective chez le fournisseur, il existe une VRAIE fenêtre asynchrone
 *   non transactionnelle (services/payment-paypal.js, services/payment-
 *   mobile-money.js appellent triggerPurchasing() en fire-and-forget après
 *   COMMIT, jamais dans la même transaction). Pendant cette fenêtre, une
 *   observation fournisseur peut ne PAS encore refléter un engagement
 *   Komerce déjà confirmé. purchase_orders.status distingue explicitement
 *   pending/notified (fournisseur pas encore confirmé — cf.
 *   purchasing-cancel-service.js#AUTO_CANCEL_STATUSES, même frontière)
 *   de confirmed/shipped/hub_received (fournisseur au courant). Ce
 *   décideur bloque explicitement en REVIEW_REQUIRED si un engagement
 *   Komerce non réconcilié existe pour ce SKU — il ne fabrique jamais un
 *   stock vendable à partir d'une hypothèse de réconciliation.
 * ──────────────────────────────────────────────────────────────────────
 */
'use strict';

const db = require('../db');
const skuProof = require('./sourcing-catalog-change-sku-identity-proof');

const DECISION = Object.freeze({
  APPLY: 'APPLY',
  NO_CHANGE: 'NO_CHANGE',
  STALE: 'STALE',
  BLOCKED: 'BLOCKED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
});

// Sous-statuts : jamais exposés seuls, toujours accompagnés du DECISION
// canonique ci-dessus pour que l'appelant n'ait qu'un seul switch à gérer.
const REASON = Object.freeze({
  IDENTITY_NOT_PROVEN: 'IDENTITY_NOT_PROVEN',
  REPLAY_SAME_OBSERVATION: 'REPLAY_SAME_OBSERVATION',
  OLDER_OR_EQUAL_TO_APPLIED: 'OLDER_OR_EQUAL_TO_APPLIED',
  SKU_TOUCHED_AFTER_OBSERVATION: 'SKU_TOUCHED_AFTER_OBSERVATION',
  FUTURE_OBSERVATION: 'FUTURE_OBSERVATION',
  UNRECONCILED_KOMERCE_COMMITMENT: 'UNRECONCILED_KOMERCE_COMMITMENT',
  TARGET_EQUALS_CURRENT_STOCK: 'TARGET_EQUALS_CURRENT_STOCK',
  IDENTITY_PROVEN_AND_FRESH: 'IDENTITY_PROVEN_AND_FRESH',
});

function verdict(decision, reason, extra = {}) {
  return Object.freeze({
    decision, reason,
    application_status: 'NOT_EVALUATED',
    ...extra,
  });
}

/**
 * Décide si une observation de stock déjà persistée et prouvée en identité
 * peut être appliquée à product_skus.stock. Ne modifie rien.
 *
 * @param {string} observationId
 * @param {object} deps  { query, canonicalIdentityFn } — injectables pour test.
 */
async function decideStockSyncApplication(observationId, {
  query = db.query.bind(db),
  identityFn = skuProof.proveExactCatalogSkuForStockDelta,
} = {}) {
  const identity = await identityFn(observationId, query);
  if (identity.status !== skuProof.STATUS.EXACT_CATALOG_SKU_IDENTITY) {
    return verdict(DECISION.BLOCKED, REASON.IDENTITY_NOT_PROVEN, {
      observation_id: observationId,
      underlying_identity_status: identity.status,
    });
  }

  const { product_sku_id: productSkuId, stock_available_observed: observedStock,
    source_id: sourceId } = identity;

  // observed_at et event_id exacts de CETTE observation (nécessaires à la
  // comparaison de fraîcheur ; la preuve d'identité ne les reporte pas car
  // elle n'a pas besoin de fraîcheur pour prouver une identité).
  const { rows: [envelopeRow] } = await query(`
    SELECT o.observed_at, c.stats->>'event_id' AS event_id
      FROM sourcing_observations o
      JOIN sourcing_captures c ON c.capture_id = o.capture_id
     WHERE o.observation_id = $1::uuid
  `, [observationId]);
  if (!envelopeRow) {
    // Ne devrait jamais arriver après un identityFn favorable — défensif.
    return verdict(DECISION.BLOCKED, REASON.IDENTITY_NOT_PROVEN, {
      observation_id: observationId, underlying_identity_status: 'NO_OBSERVATION',
    });
  }
  const observedAt = envelopeRow.observed_at;
  // A supplier timestamp is not an authorization to supersede local stock.
  // In particular, a timestamp in the future can make an earlier local
  // payment/adjustment appear older than an event which has not happened.
  const observedMillis = new Date(observedAt).getTime();
  if (!Number.isFinite(observedMillis) || observedMillis > Date.now()) {
    return verdict(DECISION.BLOCKED, REASON.FUTURE_OBSERVATION, {
      observation_id: observationId, product_sku_id: productSkuId,
      source_id: sourceId, observed_at: observedAt,
    });
  }

  const { rows: [priorSync] } = await query(
    'SELECT last_observation_id, last_observed_at, applied_stock_value ' +
    'FROM catalog_stock_sync_state WHERE product_sku_id = $1',
    [productSkuId]
  );

  const common = {
    observation_id: observationId, product_sku_id: productSkuId,
    source_id: sourceId, observed_at: observedAt, event_id: envelopeRow.event_id,
  };

  if (priorSync && priorSync.last_observation_id === observationId) {
    return verdict(DECISION.NO_CHANGE, REASON.REPLAY_SAME_OBSERVATION, common);
  }
  if (priorSync && new Date(priorSync.last_observed_at).getTime() >= new Date(observedAt).getTime()) {
    return verdict(DECISION.STALE, REASON.OLDER_OR_EQUAL_TO_APPLIED, {
      ...common, applied_observed_at: priorSync.last_observed_at,
    });
  }

  // Réconciliation : un engagement Komerce non confirmé côté fournisseur
  // rend l'observation ambiguë — on ne sait pas si elle en tient déjà
  // compte. pending/notified = même frontière que purchasing-cancel-
  // service.js#AUTO_CANCEL_STATUSES (fournisseur pas encore au courant).
  const { rows: unreconciled } = await query(
    "SELECT id, status FROM purchase_orders " +
    "WHERE product_sku_id = $1 AND status IN ('pending','notified') LIMIT 5",
    [productSkuId]
  );
  if (unreconciled.length) {
    return verdict(DECISION.REVIEW_REQUIRED, REASON.UNRECONCILED_KOMERCE_COMMITMENT, {
      ...common, unreconciled_purchase_order_count_at_least: unreconciled.length,
    });
  }

  const { rows: [sku] } = await query(
    'SELECT stock, updated_at FROM product_skus WHERE id = $1', [productSkuId]
  );

  // Trouvé en concevant le test de concurrence (pas en relisant le code) :
  // triggerPurchasing() (services/payment-paypal.js, services/payment-
  // mobile-money.js) crée la ligne purchase_orders de façon ASYNCHRONE,
  // APRÈS le COMMIT du paiement — jamais dans la même transaction que le
  // décrément de stock (adjustStock). Il existe donc une fenêtre réelle où
  // product_skus.stock vient d'être décrémenté par une commande, mais
  // AUCUNE ligne purchase_orders n'existe encore pour le signaler : le
  // contrôle de réconciliation ci-dessus ne peut PAS voir cette vente.
  // product_skus a un trigger BEFORE UPDATE (trg_product_skus_updated) qui
  // maintient updated_at sur CHAQUE écriture, y compris adjustStock —
  // signal indépendant de purchase_orders, qui couvre aussi les
  // corrections manuelles et les annulations. Si la ligne a été touchée
  // APRÈS l'observation fournisseur, on ne sait pas ce qui a changé :
  // REVIEW_REQUIRED plutôt qu'un APPLY qui écraserait ce mouvement local.
  if (sku && new Date(sku.updated_at).getTime() > new Date(observedAt).getTime()) {
    return verdict(DECISION.REVIEW_REQUIRED, REASON.SKU_TOUCHED_AFTER_OBSERVATION, {
      ...common, sku_updated_at: sku.updated_at,
    });
  }

  if (sku && sku.stock === observedStock) {
    return verdict(DECISION.NO_CHANGE, REASON.TARGET_EQUALS_CURRENT_STOCK, {
      ...common, current_stock: sku.stock,
    });
  }

  return verdict(DECISION.APPLY, REASON.IDENTITY_PROVEN_AND_FRESH, {
    ...common, target_stock_value: observedStock, current_stock: sku ? sku.stock : null,
  });
}

module.exports = { DECISION, REASON, decideStockSyncApplication };
