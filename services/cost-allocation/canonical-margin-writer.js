/**
 * @komerce-arch
 * @role          economic-engine-canonical-margin-writer
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/rules.js, utils/logger.js, services/cost-allocation/real-margin-shadow.js
 * @used-by       none
 * @db-read       orders
 * @db-write      orders
 * @db-txn        caller_provided_or_single_statement
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-10
 */

'use strict';

/**
 * KOMERCE — A8 : écrivain canonique unique de la marge réelle (DÉSACTIVÉ PAR DÉFAUT).
 * ════════════════════════════════════════════════════════════════════════
 * Aucune 3e formule : la marge vient de `computeOrderRealMarginShadow`
 * (achat + transport + douane + frais, règles de complétude du shadow).
 *
 * Désactivé (règle CANONICAL_MARGIN_WRITER_ENABLED absente ou 0) : AUCUNE écriture,
 * aucun calcul — `applyCanonicalMargin` retourne { enabled:false, wrote:false }.
 * `previewCanonicalMargin` ne fait jamais d'écriture (comparaison avec le legacy).
 *
 * À l'activation seulement, pour une commande :
 *   - final        → margin_real_pct = marge shadow ;
 *   - provisional  → idem uniquement si CANONICAL_MARGIN_WRITE_PROVISIONAL = 1, sinon NULL ;
 *   - incomplete / not_applicable → margin_real_pct = NULL (jamais 0, jamais une marge fictive).
 *   - margin_alert = (marge < 10) ; false si marge inconnue (colonne NOT NULL ; seuil de compute_real_margin).
 *   - sourcing_blocked : le writer ne le POSE JAMAIS (aucun nouveau blocage). Il peut
 *     seulement le LEVER quand la marge canonique est inconnue ou ≥ 0.
 * Ne touche ni cost_real_kmf (le trigger compute_real_margin ne se déclenche pas),
 * ni cost_closed_at, ni aucune autre colonne (le trigger générique updated_at de orders
 * s'applique comme pour tout UPDATE). Idempotent : aucun UPDATE si rien ne change.
 */

const db = require('../../db');
const { getRuleNumber } = require('../../utils/rules');
const { computeOrderRealMarginShadow } = require('./real-margin-shadow');
const log = require('../../utils/logger').child({ module: 'canonical-margin-writer' });

const ALERT_THRESHOLD_PCT = 10;
const RULE_ENABLED = 'CANONICAL_MARGIN_WRITER_ENABLED';
const RULE_PROVISIONAL = 'CANONICAL_MARGIN_WRITE_PROVISIONAL';

/**
 * Pure. Décide des valeurs cibles à partir du résultat shadow et de l'état courant.
 * @param {object} shadow  résultat de computeOrderRealMarginShadow
 * @param {{sourcing_blocked?: boolean}} current
 * @param {{writeProvisional?: boolean}} [opts]
 */
function planCanonicalMargin(shadow, current = {}, opts = {}) {
  const completeness = shadow.completeness;
  const pct = shadow.margin ? shadow.margin.shadow_pct : null;
  const usable = pct != null && (completeness === 'final' || (completeness === 'provisional' && opts.writeProvisional === true));
  const margin_real_pct = usable ? pct : null;
  // margin_alert est NOT NULL : marge inconnue → pas d'alerte (false), jamais une alerte fictive.
  const margin_alert = margin_real_pct != null && margin_real_pct < ALERT_THRESHOLD_PCT;
  // Jamais posé ; levé si la marge canonique est inconnue ou ≥ 0.
  const keepBlocked = current.sourcing_blocked === true && margin_real_pct != null && margin_real_pct < 0;
  const sourcing_blocked = current.sourcing_blocked === true ? keepBlocked : (current.sourcing_blocked ?? false);
  return { completeness, margin_real_pct, margin_alert, sourcing_blocked };
}

async function isEnabled() {
  return (await getRuleNumber(RULE_ENABLED, 0)) === 1;
}

async function previewCanonicalMargin(orderId, opts = {}) {
  const shadow = await computeOrderRealMarginShadow(orderId, opts);
  if (!shadow) return null;
  const writeProvisional = (await getRuleNumber(RULE_PROVISIONAL, 0)) === 1;
  const plan = planCanonicalMargin(shadow, { sourcing_blocked: shadow.legacy.sourcing_blocked }, { writeProvisional });
  return { order_id: orderId, plan, legacy_margin_real_pct: shadow.legacy.margin_real_pct, delta_pct_points: shadow.delta_pct_points };
}

/**
 * @param {string} orderId
 * @param {{client?: {query: Function}, marketId?: string}} [opts] client = transaction de l'appelant
 */
async function applyCanonicalMargin(orderId, opts = {}) {
  if (!(await isEnabled())) return { enabled: false, wrote: false, order_id: orderId };
  const preview = await previewCanonicalMargin(orderId, { marketId: opts.marketId, client: opts.client });
  if (!preview) return { enabled: true, wrote: false, order_id: orderId, reason: 'order_not_found' };
  const { plan } = preview;
  const q = opts.client || db;
  const { rowCount } = await q.query(
    `UPDATE orders
        SET margin_real_pct = $2, margin_alert = $3, sourcing_blocked = $4
      WHERE id = $1
        AND (margin_real_pct IS DISTINCT FROM $2::numeric
          OR margin_alert IS DISTINCT FROM $3::boolean
          OR sourcing_blocked IS DISTINCT FROM $4::boolean)`,
    [orderId, plan.margin_real_pct, plan.margin_alert, plan.sourcing_blocked]
  );
  return { enabled: true, wrote: rowCount > 0, order_id: orderId, plan };
}

/**
 * Point d'entrée des événements métier (douane, frais, règlements, annulation/remboursement).
 * No-op complet si désactivé. Dans la transaction de l'appelant, chaque commande est protégée
 * par un SAVEPOINT : un échec du writer ne casse ni ne bloque jamais l'opération métier.
 * @param {string[]} orderIds
 * @param {{client?: {query: Function}}} [opts]
 */
async function refreshCanonicalMarginForOrders(orderIds, opts = {}) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length || !(await isEnabled())) return { enabled: false, refreshed: 0, written: 0, failed: 0 };
  const client = opts.client || null;
  let written = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      if (client) await client.query('SAVEPOINT cmw_refresh');
      const r = await applyCanonicalMargin(id, { client });
      if (r.wrote) written += 1;
      if (client) await client.query('RELEASE SAVEPOINT cmw_refresh');
    } catch (err) {
      failed += 1;
      if (client) await client.query('ROLLBACK TO SAVEPOINT cmw_refresh').catch(() => {});
      log.error({ err: err.message, order_id: id }, '[A8] refresh marge canonique échoué (opération métier non bloquée)');
    }
  }
  return { enabled: true, refreshed: ids.length - failed, written, failed };
}

module.exports = {
  planCanonicalMargin, previewCanonicalMargin, applyCanonicalMargin, refreshCanonicalMarginForOrders,
  isEnabled, RULE_ENABLED, RULE_PROVISIONAL,
};
