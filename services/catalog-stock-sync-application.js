/**
 * @komerce-arch
 * @role          catalog-stock-sync-application
 * @domain        catalog
 * @layer         service
 * @criticality   critical
 * @inputs        immutable_stock_delta_observation_id
 * @outputs       applied_stock_value_or_explicit_blocker, read_after_write_proof
 * @depends       db.js, services/catalog-stock-sync-decision.js
 * @used-by       routes/admin-sourcing-workspace.js (à raccorder), tests/integration/catalog-stock-sync-application-real-db.test.js, tests/integration/catalog-stock-sync-concurrency-real-db.test.js
 * @db-read       product_skus, catalog_stock_sync_state
 * @db-write      product_skus, catalog_stock_sync_state
 * @db-txn        owned (BEGIN/COMMIT/ROLLBACK ; verrou FOR UPDATE sur la ligne product_skus ciblée)
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_CHANGE_INTAKE.md, docs/specs/DECISION_MODELE_STOCK_SKU.md
 * @impact-areas  catalog, orders, purchasing
 * @version       2026-09
 *
 * MISSION 1 — écriture contrôlée. NE REMPLACE PAS product-stock-service.js
 * #adjustStock : celui-ci garde sa sémantique de MOUVEMENT RELATIF (+/-),
 * consommée exclusivement par order-payment-confirmation.js, order-status-
 * machine.js et parcel-operations.js. Ce module écrit une valeur ABSOLUE
 * (l'observation fournisseur), sur le même owner (catalog), la même table
 * (product_skus.stock), jamais via adjustStock().
 *
 * Discipline de verrouillage partagée avec adjustSkuStock() (product-stock-
 * service.js) : un seul UPDATE product_skus par écriture, sous verrou de
 * ligne implicite du UPDATE lui-même pour adjustStock, et explicite ici
 * (SELECT ... FOR UPDATE) car la décision doit être RÉÉVALUÉE avant
 * d'écrire — pas seulement l'écriture protégée. Les deux chemins
 * verrouillent la MÊME ligne product_skus : une commande payée pendant une
 * synchronisation de stock attend le verrou, jamais une lecture sale.
 *
 * Rejeu et fraîcheur : la décision est réévaluée dans cette même
 * transaction, sous le verrou, via decideStockSyncApplication() — jamais
 * dupliquée. Un événement plus ancien ou déjà appliqué ne peut donc pas
 * écraser un mouvement local plus récent (payment, annulation) survenu
 * entre l'évaluation initiale (hors verrou, ex. dans une route de preview)
 * et cette application.
 */
'use strict';

const db = require('../db');
const { DECISION, decideStockSyncApplication } = require('./catalog-stock-sync-decision');

class StockSyncApplicationError extends Error {
  constructor(status, verdict) {
    super(`[catalog-stock-sync-application] ${verdict.decision}: ${verdict.reason}`);
    this.name = 'StockSyncApplicationError';
    this.status = status;
    this.verdict = verdict;
  }
}

/**
 * Applique — ou refuse explicitement d'appliquer — une observation de stock
 * fournisseur déjà persistée. Idempotent : un rejeu de la même observation
 * lève StockSyncApplicationError(status=200, decision=NO_CHANGE) plutôt que
 * de produire un second effet — jamais une erreur serveur.
 *
 * @param {string} observationId
 * @param {object} deps  { pool } — injectable pour test (Pool ou objet avec getClient()).
 * @returns {{ verdict: object, product_sku_id: string, stock_before: number|null, stock_after: number, read_after_write_verified: boolean }}
 *   uniquement quand la décision réévaluée sous verrou est APPLY.
 * @throws {StockSyncApplicationError} pour tout verdict autre qu'APPLY —
 *   err.status porte le code HTTP suggéré, err.verdict le verdict complet.
 *   Même convention que CatalogChangeObservationError (sourcing-catalog-
 *   change-observation.js) : l'appelant HTTP la relaie via son catch générique.
 */
async function applyStockSyncDecision(observationId, { pool = db } = {}) {
  const client = await pool.getClient();
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    const q = client.query.bind(client);

    // Première évaluation hors verrou, seulement pour connaître le SKU visé
    // (nécessaire pour poser le verrou). Ne fonde AUCUNE décision : la seule
    // décision qui compte est la réévaluation ci-dessous, sous verrou.
    const preview = await decideStockSyncApplication(observationId, { query: q });
    if (!preview.product_sku_id) {
      // Identité jamais prouvée : rien à verrouiller, rien à réévaluer.
      throw new StockSyncApplicationError(422, preview);
    }

    const { rows: [locked] } = await q(
      'SELECT id, stock FROM product_skus WHERE id = $1 FOR UPDATE',
      [preview.product_sku_id]
    );
    if (!locked) {
      throw new StockSyncApplicationError(409, {
        ...preview, decision: DECISION.BLOCKED, reason: 'SKU_DELETED_SINCE_DECISION',
      });
    }

    // Réévaluation SOUS VERROU — la seule qui autorise l'écriture. Toute
    // commande payée, annulation ou synchronisation concurrente sur ce SKU
    // entre la preview ci-dessus et cet instant est maintenant visible.
    const verdict = await decideStockSyncApplication(observationId, { query: q });

    // Bug trouvé en testant (pas en relisant le code) : NO_CHANGE par
    // TARGET_EQUALS_CURRENT_STOCK ne devait PAS rester sans trace. Sans
    // enregistrer catalog_stock_sync_state ici, cette observation reste
    // "jamais considérée" ; si product_skus.stock change ensuite par un
    // autre chemin (ex. annulation, adjustStock increment), un REJEU
    // TARDIF de cette même vieille observation ne trouve plus la valeur
    // actuelle égale à la cible et redevient APPLY — écrasant un mouvement
    // local plus récent. Un NO_CHANGE par TARGET_EQUALS_CURRENT_STOCK doit
    // donc marquer l'observation comme considérée au même titre qu'un
    // APPLY, sans toucher product_skus.stock (déjà correct).
    if (verdict.decision === DECISION.NO_CHANGE
        && verdict.reason === 'TARGET_EQUALS_CURRENT_STOCK') {
      await q(
        `INSERT INTO catalog_stock_sync_state
           (product_sku_id, source_id, last_observation_id, last_event_id,
            last_observed_at, applied_stock_value, applied_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
         ON CONFLICT (product_sku_id) DO UPDATE SET
           source_id = EXCLUDED.source_id,
           last_observation_id = EXCLUDED.last_observation_id,
           last_event_id = EXCLUDED.last_event_id,
           last_observed_at = EXCLUDED.last_observed_at,
           applied_stock_value = EXCLUDED.applied_stock_value,
           applied_at = NOW(),
           updated_at = NOW()`,
        [verdict.product_sku_id, verdict.source_id, verdict.observation_id,
          verdict.event_id, verdict.observed_at, verdict.current_stock]
      );
      await client.query('COMMIT');
      begun = false;
      throw new StockSyncApplicationError(200, verdict);
    }

    if (verdict.decision !== DECISION.APPLY) {
      throw new StockSyncApplicationError(
        verdict.decision === DECISION.BLOCKED ? 422
          : verdict.decision === DECISION.REVIEW_REQUIRED ? 409
            : 200, // NO_CHANGE (rejeu) / STALE : pas une erreur serveur, rien à écrire
        verdict
      );
    }

    const { rows: [written] } = await q(
      'UPDATE product_skus SET stock = $1 WHERE id = $2 AND product_id IS NOT NULL RETURNING stock',
      [verdict.target_stock_value, verdict.product_sku_id]
    );
    if (!written) {
      throw new StockSyncApplicationError(500, {
        ...verdict, decision: DECISION.BLOCKED, reason: 'WRITE_ROW_VANISHED',
      });
    }

    await q(
      `INSERT INTO catalog_stock_sync_state
         (product_sku_id, source_id, last_observation_id, last_event_id,
          last_observed_at, applied_stock_value, applied_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
       ON CONFLICT (product_sku_id) DO UPDATE SET
         source_id = EXCLUDED.source_id,
         last_observation_id = EXCLUDED.last_observation_id,
         last_event_id = EXCLUDED.last_event_id,
         last_observed_at = EXCLUDED.last_observed_at,
         applied_stock_value = EXCLUDED.applied_stock_value,
         applied_at = NOW(),
         updated_at = NOW()`,
      [verdict.product_sku_id, verdict.source_id, verdict.observation_id,
        verdict.event_id, verdict.observed_at, verdict.target_stock_value]
    );

    // Preuve de lecture après écriture — dans la même transaction, avant
    // COMMIT, pour que l'appelant reçoive l'état réellement enregistré et
    // non une hypothèse recalculée après coup.
    const { rows: [proof] } = await q(
      'SELECT stock FROM product_skus WHERE id = $1', [verdict.product_sku_id]
    );

    await client.query('COMMIT');
    begun = false;
    return {
      verdict, product_sku_id: verdict.product_sku_id,
      stock_before: verdict.current_stock, stock_after: proof.stock,
      read_after_write_verified: proof.stock === verdict.target_stock_value,
    };
  } catch (err) {
    if (begun) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { StockSyncApplicationError, applyStockSyncDecision };
