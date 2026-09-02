/**
 * @komerce-arch
 * @role          orders-order-cost-snapshot
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/pricing-engine.js, utils/logger.js
 * @used-by       routes/orders/create.js, services/cost-allocation/_helpers.js
 * @db-read       order_item_cost_imputations, order_items, products
 * @db-write      order_item_cost_imputations, orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */

/**
 * KOMERCE — Order Cost Snapshot Service
 * ════════════════════════════════════════════════════════════════════════
 *
 * DOCTRINE :
 *   Au moment de la creation d'une commande (ou de la transformation d'un
 *   panier collectif en order), on FIGE le coût estimé tel que calculé par
 *   pricing-engine.recommend(). Cette photographie est immuable.
 *
 *   Le snapshot est stocké dans order_item_cost_imputations avec contrainte
 *   UNIQUE sur order_item_id => idempotent par construction.
 *
 *   Si on rouvre la commande dans 6 mois, on retrouve EXACTEMENT le coût
 *   estimé au moment de la vente. Pas de derive due aux changements de
 *   taux/prix/charges.
 *
 * USAGE :
 *   - routes/orders/create.js : appelé après INSERT order_items, avant COMMIT
 *   - services/collective-payment-orchestrator.js : idem dans _createOrderFromSession
 *
 * FEATURE FLAG :
 *   ORDER_COST_SNAPSHOT_ACTIVE (default false en prod)
 *   - Si false : la fonction est appelee mais ne fait rien (no-op)
 *   - Si true  : snapshot effectif
 *
 *   Permet d'activer progressivement sans toucher aux flow critiques.
 */

'use strict';

const db = require('../db');
const pricingEngine = require('./pricing-engine');
const log = require('../utils/logger').child({ module: 'order-cost-snapshot' });

// ─── Feature flag ────────────────────────────────────────────────────────
function _isActive() {
  return String(process.env.ORDER_COST_SNAPSHOT_ACTIVE || '').toLowerCase() === 'true';
}

/**
 * Fige les coûts estimés pour tous les order_items d'une commande.
 *
 * @param {string} orderId - UUID de la commande
 * @param {object} dbClient - Client PG (transaction en cours, OBLIGATOIRE pour atomicite)
 * @param {object} options - { source: 'pricing-engine' | 'collective' }
 *
 * @returns {Promise<{
 *   order_id: string,
 *   imputations_count: number,
 *   skipped: boolean,
 *   reason?: string,
 *   total_estimated_landed_kmf: number,
 *   total_estimated_business_kmf: number,
 * }>}
 *
 * IDEMPOTENT : ON CONFLICT DO NOTHING sur order_item_id.
 * Re-appel sur la meme commande = no-op silencieux.
 */
async function lockEstimatedCostsForOrder(orderId, dbClient, options = {}) {
  if (!_isActive()) {
    return {
      order_id: orderId,
      imputations_count: 0,
      skipped: true,
      reason: 'ORDER_COST_SNAPSHOT_ACTIVE=false',
      total_estimated_landed_kmf: 0,
      total_estimated_business_kmf: 0,
    };
  }

  if (!dbClient) {
    throw new Error('lockEstimatedCostsForOrder: dbClient is required (must run in a transaction)');
  }

  const source = options.source || 'pricing-engine';

  // 1. Lire les order_items + produits joints
  const itemsRes = await dbClient.query(
    `SELECT oi.id AS order_item_id, oi.product_id, oi.quantity, oi.price_kmf,
            p.category, p.weight_kg, p.cost_kmf AS product_cost_kmf,
            p.volume_m3, o.market_id
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1
     ORDER BY oi.created_at`,
    [orderId]
  );

  if (!itemsRes.rows.length) {
    return {
      order_id: orderId,
      imputations_count: 0,
      skipped: true,
      reason: 'no_order_items',
      total_estimated_landed_kmf: 0,
      total_estimated_business_kmf: 0,
    };
  }

  // 2. Charger UNE fois la config (couteux)
  const orderMarketId = itemsRes.rows[0]?.market_id || null;
  const config = orderMarketId
    ? await pricingEngine.loadGlobalConfig({ marketId: orderMarketId })
    : await pricingEngine.loadGlobalConfig();

  // 3. Pour chaque item, appeler recommend() et inserer
  let inserted = 0;
  let totalLanded = 0;
  let totalBusiness = 0;

  for (const item of itemsRes.rows) {
    let reco;
    try {
      reco = await pricingEngine.recommend({
        product_id: item.product_id || undefined,
        category: item.category,
        cost_kmf: item.product_cost_kmf,
        weight_kg: item.weight_kg,
        volume_m3: item.volume_m3,
        current_price_kmf: item.price_kmf,
      }, { config });
    } catch (err) {
      // Si pricing-engine plante (ne devrait plus arriver apres Phase A),
      // on enregistre quand meme une imputation 'fallback' avec coûts à null.
      // Cela permet de tracer qu'on a bien essaye, et missing_cost_fields sera explicite.
      log.error('[order-cost-snapshot] pricing-engine failed for item', item.order_item_id, err.message);
      reco = null;
    }

    const saleTotal = Number(item.price_kmf) * item.quantity;
    const estLandedUnit   = reco?.landed_relay_cost_kmf      != null ? Number(reco.landed_relay_cost_kmf)      : null;
    const estBusinessUnit = reco?.business_complete_cost_kmf != null ? Number(reco.business_complete_cost_kmf) : null;

    const estLandedTotal   = estLandedUnit   != null ? estLandedUnit   * item.quantity : null;
    const estBusinessTotal = estBusinessUnit != null ? estBusinessUnit * item.quantity : null;

    let estMarginKmf = null, estMarginPct = null;
    if (estBusinessTotal != null && saleTotal > 0) {
      estMarginKmf = saleTotal - estBusinessTotal;
      estMarginPct = Number(((estMarginKmf / saleTotal) * 100).toFixed(2));
    }

    const upsert = await dbClient.query(
      `INSERT INTO order_item_cost_imputations (
         order_id, order_item_id, product_id,
         quantity, sale_unit_price_kmf, sale_total_kmf,
         estimated_landed_relay_cost_kmf,
         estimated_business_complete_cost_kmf,
         estimated_margin_kmf,
         estimated_margin_pct,
         cost_breakdown,
         allocations,
         allocation_averages,
         allocation_confidence,
         data_quality,
         pricing_source
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6,
         $7, $8,
         $9, $10,
         $11, $12, $13, $14, $15,
         $16
       )
       ON CONFLICT (order_item_id) DO NOTHING
       RETURNING id`,
      [
        orderId, item.order_item_id, item.product_id,
        item.quantity, item.price_kmf, saleTotal,
        estLandedTotal, estBusinessTotal,
        estMarginKmf, estMarginPct,
        reco?.cost_breakdown        ? JSON.stringify(reco.cost_breakdown)        : null,
        reco?.cost_breakdown?.allocations ? JSON.stringify(reco.cost_breakdown.allocations) : null,
        reco?.cost_breakdown?.allocation_averages ? JSON.stringify(reco.cost_breakdown.allocation_averages) : null,
        reco?.cost_breakdown?.allocation_averages?.confidence || null,
        reco?.data_quality         ? JSON.stringify(reco.data_quality)         : null,
        reco ? source : 'fallback',
      ]
    );

    if (upsert.rows.length) {
      inserted++;
      if (estLandedTotal   != null) totalLanded   += estLandedTotal;
      if (estBusinessTotal != null) totalBusiness += estBusinessTotal;
    }
  }

  // 4. Mettre a jour le cache orders.cost_estimated_kmf depuis le SUM des imputations
  //    (DECISION : on garde le legacy cost_estimated_kmf pour ne pas casser dashboard.js)
  if (inserted > 0) {
    await dbClient.query(
      `UPDATE orders
         SET cost_estimated_kmf = (
           SELECT COALESCE(SUM(estimated_business_complete_cost_kmf), 0)::int
           FROM order_item_cost_imputations
           WHERE order_id = $1
         )
       WHERE id = $1`,
      [orderId]
    );
  }

  return {
    order_id: orderId,
    imputations_count: inserted,
    skipped: false,
    total_estimated_landed_kmf: Math.round(totalLanded),
    total_estimated_business_kmf: Math.round(totalBusiness),
  };
}

module.exports = {
  lockEstimatedCostsForOrder,
  _isActive,  // exporté pour tests
};
