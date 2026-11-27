/**
 * @komerce-arch
 * @role          economic-sku-rail-selection
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        market, product, SKU, commercial rail, authorized action
 * @outputs       scoped withdrawal state and append-only proof
 * @depends       db.js, services/cost-allocation/product-margin-steering.js, services/pricing-market-decision-policy.js
 * @used-by       routes/admin-costing.js, services/order-checkout-service.js, bootstrap/crons.js
 * @db-read       economic_sku_rail_selection_events, markets, product_skus, orders, order_items, products, pricing_market_decision_policy_events
 * @db-write      economic_sku_rail_selection_events
 * @db-txn        service_owned_selection_event_transaction
 * @doctrine      exact_market_sku_rail, canonical_after_sale_evidence, pricing_unchanged
 * @impact-areas  economic-engine, catalog, orders
 * @version       2026-11
 */

'use strict';

const db = require('../db');
const { listProductMarginSteering } = require('./cost-allocation/product-margin-steering');
const { getCurrentMarketDecisionPolicy } = require('./pricing-market-decision-policy');

const MODE_BY_RAIL = Object.freeze({ SEA_STANDARD: 'sea', AIR_EXPRESS: 'air' });

function refusal(code, message, status = 409) {
  return Object.assign(new Error(message), { status, code });
}

async function findWithdrawnSkuRail(client, marketId, demands) {
  if (!marketId || !demands.length) return null;
  const { rows } = await client.query(
    `SELECT decision.sku_id, decision.rail
       FROM unnest($2::uuid[], $3::text[]) AS demand(sku_id, rail)
       JOIN LATERAL (
         SELECT sku_id, rail, action FROM economic_sku_rail_selection_events
          WHERE market_id=$1 AND sku_id=demand.sku_id AND rail=demand.rail
          ORDER BY id DESC LIMIT 1
       ) decision ON decision.action='WITHDRAW'
      LIMIT 1`,
    [marketId, demands.map(({ skuId }) => skuId), demands.map(({ rail }) => rail)]
  );
  return rows[0] ?? null;
}

async function recordSkuRailSelection({ marketId, productId, skuId, rail, action, actorId, reason }) {
  if (!marketId || !productId || !skuId || !actorId || !Object.hasOwn(MODE_BY_RAIL, rail) ||
      !['WITHDRAW', 'RESTORE'].includes(action) || typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000) {
    throw refusal('ECONOMIC_SELECTION_INVALID', 'Marché, variante, rail, décision et motif requis.', 400);
  }

  const snapshot = await listProductMarginSteering({ marketId, productId, sinceDays: 730, limit: 2000 });
  const selection = snapshot.products.find(({ product_id }) => product_id === productId)?.after_sale_selection;
  const cohort = selection?.comparable_cohorts?.find(({ sku_id, rail: mode }) => sku_id === skuId && mode === MODE_BY_RAIL[rail]);
  const threshold = selection?.required_loss_observations;
  const proven = selection?.policy_version && Number.isSafeInteger(threshold) && threshold > 0 && cohort?.reconciled_shipment_count > 0;
  const withdrawalRequired = cohort && (cohort.certain_loss_shipment_ids?.length > 0 || cohort.loss_shipment_ids.length >= threshold);
  if (!proven || (action === 'WITHDRAW' ? !withdrawalRequired : withdrawalRequired)) {
    throw refusal('ECONOMIC_SELECTION_EVIDENCE_INSUFFICIENT', 'La décision ne correspond pas aux expéditions rapprochées de ce périmètre.');
  }

  return persistDecision({ marketId, productId, skuId, rail, action, actorId, reason, selection, cohort, evaluatedAt: snapshot.evaluated_at });
}

async function persistDecision({ marketId, productId, skuId, rail, action, actorId, reason, selection, cohort, evaluatedAt }) {
  const automatic = actorId === null;
  return db.withTransaction(async (client) => {
    // Policy creation serializes on the same market row.
    await client.query('SELECT id FROM markets WHERE id=$1 FOR UPDATE', [marketId]);
    const policy = await getCurrentMarketDecisionPolicy(marketId, { executor: client });
    if (policy?.version !== selection.policy_version) {
      throw refusal('ECONOMIC_SELECTION_POLICY_CHANGED', 'La politique du marché a changé. Actualisez la décision.');
    }
    // Serialize decisions on the SKU so a retry cannot duplicate an event.
    const { rows: [sku] } = await client.query(
      'SELECT id FROM product_skus WHERE id=$1 AND product_id=$2 FOR UPDATE', [skuId, productId]
    );
    if (!sku) throw refusal('ECONOMIC_SELECTION_UNKNOWN_SKU', 'Variante introuvable dans ce produit.', 404);

    const { rows: [current] } = await client.query(
      `SELECT * FROM economic_sku_rail_selection_events
        WHERE market_id=$1 AND sku_id=$2 AND rail=$3 ORDER BY id DESC LIMIT 1`,
      [marketId, skuId, rail]
    );
    if (current?.action === action) return { outcome: 'replayed', event: current };
    if (automatic && current && !(Date.parse(evaluatedAt) > Date.parse(current.recorded_at))) {
      return { outcome: 'stale', event: current };
    }
    if (!current && action === 'RESTORE') throw refusal('ECONOMIC_SELECTION_ALREADY_AVAILABLE', 'Cette variante est disponible sur ce rail.');

    const { rows: [event] } = await client.query(
      `INSERT INTO economic_sku_rail_selection_events
        (market_id, sku_id, rail, action, policy_version, evidence, reason, actor_id, decision_source)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING *`,
      [marketId, skuId, rail, action, selection.policy_version,
        JSON.stringify({ ...cohort, required_loss_observations: selection.required_loss_observations, evaluated_at: evaluatedAt }),
        reason.trim(), actorId, automatic ? 'POLICY_AUTOMATION' : 'MANUAL']
    );
    return { outcome: 'recorded', event };
  });
}

// The composition root keeps the cursor between passes. An error leaves it
// unchanged so the same page can be retried through the idempotent writer.
async function sweepSkuRailWithdrawals({ cursor = null, limit = 10 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new TypeError('Invalid economic selection batch size');
  const { rows } = await db.query(
    `WITH effective_policy AS (
       SELECT DISTINCT ON (market_id) market_id, selection_by_family, window_days
         FROM pricing_market_decision_policy_events
        WHERE effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
        ORDER BY market_id, effective_from DESC, recorded_at DESC, id DESC
     ), candidates AS (
       SELECT DISTINCT o.market_id, item.product_id
         FROM effective_policy policy
         JOIN markets market ON market.id=policy.market_id AND market.is_active IS TRUE
         JOIN orders o ON o.market_id=policy.market_id AND o.status='collected' AND o.simulation_scope IS NULL
         JOIN order_items item ON item.order_id=o.id AND item.sku_id IS NOT NULL
         JOIN products product ON product.id=item.product_id
        WHERE policy.selection_by_family ? product.category
          AND o.created_at >= now() - make_interval(days => LEAST(policy.window_days, 730))
     )
     SELECT market_id, product_id FROM candidates
      WHERE $1::uuid IS NULL OR (market_id, product_id) > ($1::uuid, $2::uuid)
      ORDER BY market_id, product_id LIMIT $3`,
    [cursor?.marketId ?? null, cursor?.productId ?? null, limit]
  );
  let recorded = 0;
  for (const { market_id: marketId, product_id: productId } of rows) {
    const snapshot = await listProductMarginSteering({ marketId, productId, sinceDays: 730, limit: 2000 });
    const selection = snapshot.products.find(({ product_id }) => product_id === productId)?.after_sale_selection;
    if (!['WITHDRAWAL_THRESHOLD_REACHED', 'CERTAIN_LOSS_PROVEN'].includes(selection?.status)) continue;
    for (const cohort of selection.comparable_cohorts) {
      const certain = cohort.certain_loss_shipment_ids?.length > 0;
      if (!certain && cohort.loss_shipment_ids.length < selection.required_loss_observations) continue;
      const rail = Object.keys(MODE_BY_RAIL).find((key) => MODE_BY_RAIL[key] === cohort.rail);
      if (!rail) continue;
      try {
        const result = await persistDecision({
          marketId, productId, skuId: cohort.sku_id, rail, action: 'WITHDRAW', actorId: null,
          reason: certain ? 'Achat réel supérieur au revenu net rapproché' : 'Seuil de pertes rapprochées atteint', selection, cohort, evaluatedAt: snapshot.evaluated_at,
        });
        if (result.outcome === 'recorded') recorded++;
      } catch (error) {
        if (!['ECONOMIC_SELECTION_POLICY_CHANGED', 'ECONOMIC_SELECTION_UNKNOWN_SKU'].includes(error.code)) throw error;
      }
    }
  }
  const last = rows.at(-1);
  return {
    recorded,
    cursor: rows.length === limit ? { marketId: last.market_id, productId: last.product_id } : null,
  };
}

module.exports = { findWithdrawnSkuRail, recordSkuRailSelection, sweepSkuRailWithdrawals };
