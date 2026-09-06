/**
 * @komerce-arch
 * @role          economic-engine-pricing-maturity
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        order_id, market_id, canonical_cohort_bounds
 * @outputs       order_maturity, maturity_watermark
 * @depends       db
 * @used-by       future pricing coverage gate
 * @db-read       customs_shipment_parcels, customs_shipments, order_item_cost_imputations, order_item_real_cost_allocations, order_items, orders, parcel_items, parcels
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      pricing_market_viability_maturity_watermark
 * @impact-areas  economic-engine, pricing, governance
 * @version       2026-09
 */

/**
 * KOMERCE — Maturité économique / watermark
 * ════════════════════════════════════════════════════════════════════════
 *
 * Ce service NE calcule PAS encore le ratio de couverture et NE choisit PAS
 * la largeur de la fenêtre canonique. Il matérialise le prérequis mécanique :
 *
 *   1. une commande est-elle suffisamment réconciliée pour entrer dans une
 *      cohorte décisionnelle ?
 *   2. jusqu'où une cohorte FIXÉE par la future politique canonique peut-elle
 *      avancer sans sélectionner les commandes favorables et ignorer les
 *      commandes immatures ?
 *
 * Doctrine fail-closed : absence de preuve = critère non satisfait. Une
 * configuration ou une estimation n'est jamais promue en preuve de règlement.
 *
 * Important : les bornes from/to sont obligatoires pour le calcul marché.
 * Elles doivent venir de la future politique canonique (largeur fixe), jamais
 * d'un sélecteur utilisateur. Ce service n'expose volontairement aucune route.
 */

'use strict';

const db = require('../db');

const NON_SETTLEMENT_RELAY_SOURCES = new Set([
  'cost_components.commission_relais_kmf',
  'finance_config.commission_relais_standard_kmf',
  'literal_current_fallback',
]);

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function criterion(code, satisfied, evidence = {}, applicable = true) {
  return {
    code,
    applicable,
    satisfied: applicable ? !!satisfied : true,
    evidence,
  };
}

function expectedCount(row, key) {
  return n(row[`expected_${key}_items`]);
}

function verifiedCount(row, key) {
  return n(row[`verified_${key}_items`]);
}

/**
 * Transforme une ligne d'évidence SQL en verdict mécanique.
 * Exportée sous préfixe _ uniquement pour verrouiller le contrat par tests.
 */
function _evaluateEvidence(row) {
  if (!row) return null;

  const itemCount = n(row.item_count);
  const importItemCount = n(row.import_item_count);
  const unknownFulfillmentCount = n(row.unknown_fulfillment_count);
  const missingBreakdownCount = n(row.missing_breakdown_count);
  const parcelCount = n(row.parcel_count);
  const collectedParcelCount = n(row.collected_parcel_count);
  const shipmentCount = n(row.shipment_count);

  const eligible = row.payment_status === 'paid' && !['cancelled', 'refunded'].includes(row.status);
  const criteria = [
    criterion('order_eligible', eligible, {
      payment_status: row.payment_status,
      order_status: row.status,
    }),
    criterion('order_has_items', itemCount > 0, { item_count: itemCount }),
    criterion('fulfillment_source_known', unknownFulfillmentCount === 0, {
      unknown_fulfillment_count: unknownFulfillmentCount,
      import_item_count: importItemCount,
      local_item_count: n(row.local_item_count),
    }),
    criterion('snapshot_breakdown_available', itemCount > 0 && missingBreakdownCount === 0, {
      missing_breakdown_count: missingBreakdownCount,
      item_count: itemCount,
    }),
  ];

  const perItemTypes = [
    'product_purchase',
    'sourcing',
    'hub',
    'packaging',
    'port_transitary',
    'local_distribution',
  ];

  for (const type of perItemTypes) {
    const expected = expectedCount(row, type);
    if (expected <= 0) {
      criteria.push(criterion(`${type}_reconciled`, true, { expected_items: 0 }, false));
      continue;
    }
    const verified = verifiedCount(row, type);
    criteria.push(criterion(`${type}_reconciled`, verified >= expected, {
      expected_items: expected,
      verified_items: verified,
    }));
  }

  // Le coût relais configuré n'est pas une preuve de règlement. Le SQL remonte
  // séparément les allocations provenant d'une source de règlement/constat et
  // les allocations issues de la configuration courante.
  const expectedRelay = expectedCount(row, 'relay');
  if (expectedRelay > 0) {
    criteria.push(criterion('relay_settlement_reconciled', n(row.verified_relay_items) >= expectedRelay, {
      expected_items: expectedRelay,
      verified_settlement_items: n(row.verified_relay_items),
      configured_only_items: n(row.configured_relay_items),
    }));
  } else {
    criteria.push(criterion('relay_settlement_reconciled', true, { expected_items: 0 }, false));
  }

  // Le paiement est un coût de commande. Une preuve réelle explicite suffit à
  // établir que le poste a été constaté, y compris si son montant réel vaut 0.
  const expectedPayment = expectedCount(row, 'payment');
  if (expectedPayment > 0) {
    criteria.push(criterion('payment_cost_reconciled', n(row.actual_payment_records) > 0, {
      expected_items: expectedPayment,
      actual_payment_records: n(row.actual_payment_records),
    }));
  } else {
    criteria.push(criterion('payment_cost_reconciled', true, { expected_items: 0 }, false));
  }

  const needsParcelClosure = expectedRelay > 0 || expectedCount(row, 'local_distribution') > 0;
  criteria.push(criterion('parcel_flow_closed', parcelCount > 0 && collectedParcelCount === parcelCount, {
    parcel_count: parcelCount,
    collected_parcel_count: collectedParcelCount,
  }, needsParcelClosure));

  const importApplicable = importItemCount > 0;
  criteria.push(criterion('import_items_linked_to_shipment',
    n(row.import_items_linked_to_shipment_count) >= importItemCount && shipmentCount > 0,
    {
      import_item_count: importItemCount,
      linked_import_items: n(row.import_items_linked_to_shipment_count),
      shipment_count: shipmentCount,
    },
    importApplicable
  ));

  criteria.push(criterion('shipment_closed',
    shipmentCount > 0 && n(row.confirmed_shipment_count) === shipmentCount,
    {
      shipment_count: shipmentCount,
      confirmed_shipment_count: n(row.confirmed_shipment_count),
    },
    importApplicable
  ));

  criteria.push(criterion('customs_liquidated',
    shipmentCount > 0 && n(row.customs_liquidated_shipment_count) === shipmentCount,
    {
      shipment_count: shipmentCount,
      liquidated_shipment_count: n(row.customs_liquidated_shipment_count),
    },
    importApplicable
  ));

  criteria.push(criterion('freight_reconciled',
    shipmentCount > 0
      && n(row.freight_known_shipment_count) === shipmentCount
      && n(row.freight_allocated_shipment_count) >= n(row.positive_freight_shipment_count),
    {
      shipment_count: shipmentCount,
      freight_known_shipment_count: n(row.freight_known_shipment_count),
      positive_freight_shipment_count: n(row.positive_freight_shipment_count),
      freight_allocated_shipment_count: n(row.freight_allocated_shipment_count),
    },
    importApplicable
  ));

  criteria.push(criterion('customs_cost_reconciled',
    shipmentCount > 0
      && n(row.customs_liquidated_shipment_count) === shipmentCount
      && n(row.customs_allocated_shipment_count) >= n(row.positive_customs_shipment_count),
    {
      shipment_count: shipmentCount,
      positive_customs_shipment_count: n(row.positive_customs_shipment_count),
      customs_allocated_shipment_count: n(row.customs_allocated_shipment_count),
    },
    importApplicable
  ));

  const blocking = criteria.filter((c) => c.applicable && !c.satisfied);

  return {
    order_id: row.order_id,
    market_id: row.market_id || null,
    created_at: row.created_at,
    eligible,
    mature: blocking.length === 0,
    maturity_status: blocking.length === 0 ? 'MATURE' : 'IMMATURE',
    criteria,
    blocking_reasons: blocking.map((c) => c.code),
    evidence_generated_at: new Date().toISOString(),
  };
}

/**
 * Une requête, une ligne d'évidence. Les sous-requêtes sont volontairement
 * explicites : ce service est un lecteur de vérité, pas un moteur de mutation.
 */
async function getOrderMaturity(orderId) {
  const { rows } = await db.query(`
    SELECT
      o.id AS order_id,
      o.market_id,
      o.created_at,
      o.status,
      o.payment_status,

      (SELECT COUNT(*)::int
         FROM order_items oi
        WHERE oi.order_id = o.id) AS item_count,
      (SELECT COUNT(*)::int
         FROM order_items oi
        WHERE oi.order_id = o.id AND oi.fulfillment_source IS NULL) AS unknown_fulfillment_count,
      (SELECT COUNT(*)::int
         FROM order_items oi
        WHERE oi.order_id = o.id AND oi.fulfillment_source = 'IMPORT') AS import_item_count,
      (SELECT COUNT(*)::int
         FROM order_items oi
        WHERE oi.order_id = o.id AND oi.fulfillment_source = 'LOCAL_STOCK') AS local_item_count,

      (SELECT COUNT(*)::int
         FROM order_items oi
         LEFT JOIN order_item_cost_imputations imp ON imp.order_item_id = oi.id
        WHERE oi.order_id = o.id
          AND (imp.id IS NULL OR imp.cost_breakdown IS NULL)) AS missing_breakdown_count,

      (SELECT COUNT(*)::int FROM order_item_cost_imputations imp
        WHERE imp.order_id = o.id
          AND COALESCE((imp.cost_breakdown->'landed_relay'->>'product_purchase')::numeric, 0) > 0) AS expected_product_purchase_items,
      (SELECT COUNT(*)::int FROM order_item_cost_imputations imp
        WHERE imp.order_id = o.id
          AND COALESCE((imp.cost_breakdown->'landed_relay'->>'sourcing')::numeric, 0) > 0) AS expected_sourcing_items,
      (SELECT COUNT(*)::int FROM order_item_cost_imputations imp
        WHERE imp.order_id = o.id
          AND COALESCE((imp.cost_breakdown->'landed_relay'->>'hub')::numeric, 0) > 0) AS expected_hub_items,
      (SELECT COUNT(*)::int FROM order_item_cost_imputations imp
        WHERE imp.order_id = o.id
          AND COALESCE((imp.cost_breakdown->'landed_relay'->>'packaging')::numeric, 0) > 0) AS expected_packaging_items,
      (SELECT COUNT(*)::int FROM order_item_cost_imputations imp
        WHERE imp.order_id = o.id
          AND COALESCE((imp.cost_breakdown->'landed_relay'->>'freight')::numeric, 0) > 0) AS expected_freight_items,
      (SELECT COUNT(*)::int FROM order_item_cost_imputations imp
        WHERE imp.order_id = o.id
          AND COALESCE((imp.cost_breakdown->'landed_relay'->>'customs')::numeric, 0) > 0) AS expected_customs_items,
      (SELECT COUNT(*)::int FROM order_item_cost_imputations imp
        WHERE imp.order_id = o.id
          AND COALESCE((imp.cost_breakdown->'landed_relay'->>'port_transitary')::numeric, 0) > 0) AS expected_port_transitary_items,
      (SELECT COUNT(*)::int FROM order_item_cost_imputations imp
        WHERE imp.order_id = o.id
          AND COALESCE((imp.cost_breakdown->'landed_relay'->>'local_distribution')::numeric, 0) > 0) AS expected_local_distribution_items,
      (SELECT COUNT(*)::int FROM order_item_cost_imputations imp
        WHERE imp.order_id = o.id
          AND COALESCE((imp.cost_breakdown->'landed_relay'->>'relay')::numeric, 0) > 0) AS expected_relay_items,
      (SELECT COUNT(*)::int FROM order_item_cost_imputations imp
        WHERE imp.order_id = o.id
          AND COALESCE((imp.cost_breakdown->'business'->>'payment')::numeric, 0) > 0) AS expected_payment_items,

      (SELECT COUNT(DISTINCT alc.order_item_id)::int
         FROM order_item_real_cost_allocations alc
        WHERE alc.order_id = o.id
          AND alc.cost_type = 'product_purchase'
          AND alc.is_actual = TRUE
          AND alc.allocation_method <> 'estimated_fallback'
          AND alc.source IS NOT NULL
          AND alc.source <> 'products.cost_kmf') AS verified_product_purchase_items,
      (SELECT COUNT(DISTINCT alc.order_item_id)::int
         FROM order_item_real_cost_allocations alc
        WHERE alc.order_id = o.id AND alc.cost_type = 'sourcing'
          AND alc.is_actual = TRUE AND alc.allocation_method <> 'estimated_fallback') AS verified_sourcing_items,
      (SELECT COUNT(DISTINCT alc.order_item_id)::int
         FROM order_item_real_cost_allocations alc
        WHERE alc.order_id = o.id AND alc.cost_type = 'hub'
          AND alc.is_actual = TRUE AND alc.allocation_method <> 'estimated_fallback'
          AND COALESCE(alc.source, '') <> 'monthly_recalc') AS verified_hub_items,
      (SELECT COUNT(DISTINCT alc.order_item_id)::int
         FROM order_item_real_cost_allocations alc
        WHERE alc.order_id = o.id AND alc.cost_type = 'packaging'
          AND alc.is_actual = TRUE AND alc.allocation_method <> 'estimated_fallback') AS verified_packaging_items,
      (SELECT COUNT(DISTINCT alc.order_item_id)::int
         FROM order_item_real_cost_allocations alc
        WHERE alc.order_id = o.id AND alc.cost_type = 'port_transitaire'
          AND alc.is_actual = TRUE AND alc.allocation_method <> 'estimated_fallback') AS verified_port_transitary_items,
      (SELECT COUNT(DISTINCT alc.order_item_id)::int
         FROM order_item_real_cost_allocations alc
        WHERE alc.order_id = o.id AND alc.cost_type = 'local_distribution'
          AND alc.is_actual = TRUE AND alc.allocation_method <> 'estimated_fallback') AS verified_local_distribution_items,

      (SELECT COUNT(DISTINCT alc.order_item_id)::int
         FROM order_item_real_cost_allocations alc
        WHERE alc.order_id = o.id AND alc.cost_type = 'relay'
          AND alc.is_actual = TRUE
          AND alc.allocation_method <> 'estimated_fallback'
          AND alc.source IS NOT NULL
          AND alc.source NOT IN (
            'cost_components.commission_relais_kmf',
            'finance_config.commission_relais_standard_kmf',
            'literal_current_fallback'
          )) AS verified_relay_items,
      (SELECT COUNT(DISTINCT alc.order_item_id)::int
         FROM order_item_real_cost_allocations alc
        WHERE alc.order_id = o.id AND alc.cost_type = 'relay'
          AND alc.source IN (
            'cost_components.commission_relais_kmf',
            'finance_config.commission_relais_standard_kmf',
            'literal_current_fallback'
          )) AS configured_relay_items,
      (SELECT COUNT(*)::int
         FROM order_item_real_cost_allocations alc
        WHERE alc.order_id = o.id AND alc.cost_type = 'payment'
          AND alc.is_actual = TRUE
          AND alc.allocation_method <> 'estimated_fallback') AS actual_payment_records,

      (SELECT COUNT(*)::int FROM parcels p WHERE p.order_id = o.id) AS parcel_count,
      (SELECT COUNT(*)::int FROM parcels p WHERE p.order_id = o.id AND p.status = 'collected') AS collected_parcel_count,

      (SELECT COUNT(DISTINCT cs.id)::int
         FROM parcels p
         JOIN customs_shipment_parcels csp ON csp.parcel_id = p.id
         JOIN customs_shipments cs ON cs.id = csp.shipment_id
        WHERE p.order_id = o.id) AS shipment_count,
      (SELECT COUNT(DISTINCT cs.id)::int
         FROM parcels p
         JOIN customs_shipment_parcels csp ON csp.parcel_id = p.id
         JOIN customs_shipments cs ON cs.id = csp.shipment_id
        WHERE p.order_id = o.id AND cs.status = 'confirmed') AS confirmed_shipment_count,
      (SELECT COUNT(DISTINCT cs.id)::int
         FROM parcels p
         JOIN customs_shipment_parcels csp ON csp.parcel_id = p.id
         JOIN customs_shipments cs ON cs.id = csp.shipment_id
        WHERE p.order_id = o.id AND cs.customs_paid_kmf IS NOT NULL) AS customs_liquidated_shipment_count,
      (SELECT COUNT(DISTINCT cs.id)::int
         FROM parcels p
         JOIN customs_shipment_parcels csp ON csp.parcel_id = p.id
         JOIN customs_shipments cs ON cs.id = csp.shipment_id
        WHERE p.order_id = o.id AND cs.freight_kmf IS NOT NULL) AS freight_known_shipment_count,
      (SELECT COUNT(DISTINCT cs.id)::int
         FROM parcels p
         JOIN customs_shipment_parcels csp ON csp.parcel_id = p.id
         JOIN customs_shipments cs ON cs.id = csp.shipment_id
        WHERE p.order_id = o.id AND COALESCE(cs.freight_kmf, 0) > 0) AS positive_freight_shipment_count,
      (SELECT COUNT(DISTINCT cs.id)::int
         FROM parcels p
         JOIN customs_shipment_parcels csp ON csp.parcel_id = p.id
         JOIN customs_shipments cs ON cs.id = csp.shipment_id
        WHERE p.order_id = o.id AND COALESCE(cs.customs_paid_kmf, 0) > 0) AS positive_customs_shipment_count,
      (SELECT COUNT(DISTINCT alc.shipment_id)::int
         FROM order_item_real_cost_allocations alc
        WHERE alc.order_id = o.id AND alc.cost_type = 'freight'
          AND alc.is_actual = TRUE AND alc.shipment_id IS NOT NULL
          AND alc.allocation_method <> 'estimated_fallback') AS freight_allocated_shipment_count,
      (SELECT COUNT(DISTINCT alc.shipment_id)::int
         FROM order_item_real_cost_allocations alc
        WHERE alc.order_id = o.id AND alc.cost_type = 'customs'
          AND alc.is_actual = TRUE AND alc.shipment_id IS NOT NULL
          AND alc.allocation_method <> 'estimated_fallback') AS customs_allocated_shipment_count,
      (SELECT COUNT(DISTINCT oi.id)::int
         FROM order_items oi
         JOIN parcel_items pi ON pi.order_item_id = oi.id
         JOIN customs_shipment_parcels csp ON csp.parcel_id = pi.parcel_id
        WHERE oi.order_id = o.id AND oi.fulfillment_source = 'IMPORT') AS import_items_linked_to_shipment_count

    FROM orders o
    WHERE o.id = $1
  `, [orderId]);

  if (!rows.length) return null;
  return _evaluateEvidence(rows[0]);
}

/**
 * Dérive un watermark sans cherry-picking.
 *
 * Les commandes partageant exactement le même created_at forment un groupe :
 * si l'une est immature, aucune commande de ce timestamp ne peut faire avancer
 * le watermark. Les commandes matures plus récentes restent visibles dans le
 * ratio de maturité mais ne repoussent jamais la frontière sûre.
 */
function deriveMaturityWatermark(orderMaturities = []) {
  const rows = [...orderMaturities]
    .filter(Boolean)
    .sort((a, b) => {
      const dt = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (dt !== 0) return dt;
      return String(a.order_id).localeCompare(String(b.order_id));
    });

  const total = rows.length;
  const matureTotal = rows.filter((r) => r.mature).length;
  const maturityRatio = total > 0 ? Number((matureTotal / total).toFixed(4)) : null;

  if (total === 0) {
    return {
      status: 'EMPTY',
      total_orders: 0,
      mature_orders: 0,
      immature_orders: 0,
      maturity_ratio: null,
      safe_prefix_order_count: 0,
      watermark_at: null,
      watermark_order_ids: [],
      first_blocking_at: null,
      first_blocking_order_ids: [],
      first_blocking_reasons: [],
    };
  }

  const groups = [];
  for (const row of rows) {
    const key = new Date(row.created_at).toISOString();
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }

  const firstBlockingIndex = groups.findIndex((g) => g.rows.some((r) => !r.mature));
  const safeGroups = firstBlockingIndex === -1 ? groups : groups.slice(0, firstBlockingIndex);
  const safeRows = safeGroups.flatMap((g) => g.rows);
  const lastSafeGroup = safeGroups[safeGroups.length - 1] || null;
  const blockingGroup = firstBlockingIndex === -1 ? null : groups[firstBlockingIndex];

  let status = 'FULLY_MATURE';
  if (blockingGroup && safeRows.length === 0) status = 'BLOCKED_AT_START';
  else if (blockingGroup) status = 'PARTIAL';

  return {
    status,
    total_orders: total,
    mature_orders: matureTotal,
    immature_orders: total - matureTotal,
    maturity_ratio: maturityRatio,
    safe_prefix_order_count: safeRows.length,
    watermark_at: lastSafeGroup ? lastSafeGroup.key : null,
    watermark_order_ids: lastSafeGroup ? lastSafeGroup.rows.map((r) => r.order_id) : [],
    first_blocking_at: blockingGroup ? blockingGroup.key : null,
    first_blocking_order_ids: blockingGroup ? blockingGroup.rows.filter((r) => !r.mature).map((r) => r.order_id) : [],
    first_blocking_reasons: blockingGroup
      ? [...new Set(blockingGroup.rows.filter((r) => !r.mature).flatMap((r) => r.blocking_reasons || []))]
      : [],
  };
}

/**
 * Calcule le watermark d'un marché sur une cohorte DÉJÀ bornée.
 * Aucun défaut implicite : from/to sont obligatoires pour empêcher qu'une
 * largeur de fenêtre arbitraire devienne une vérité cachée du moteur.
 */
async function computeMarketMaturityWatermark(marketId, options = {}) {
  if (!marketId) throw new Error('marketId is required');
  if (!options.from || !options.to) {
    throw new Error('canonical cohort bounds from/to are required');
  }

  const from = new Date(options.from);
  const to = new Date(options.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error('invalid canonical cohort bounds');
  }

  const { rows } = await db.query(
    `SELECT id, created_at
       FROM orders
      WHERE market_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND payment_status = 'paid'
        AND status NOT IN ('cancelled', 'refunded')
      ORDER BY created_at ASC, id ASC`,
    [marketId, options.from, options.to]
  );

  const evaluations = [];
  // Séquentiel volontairement : aucune explosion N+1 parallèle sur la DB.
  // Ce service n'est pas encore branché à une route hot-path. Le lot couverture
  // pourra remplacer cette lecture par une agrégation batch sans changer le
  // contrat de sortie.
  for (const row of rows) {
    const maturity = await getOrderMaturity(row.id);
    if (maturity) evaluations.push(maturity);
  }

  return {
    market_id: marketId,
    cohort: {
      from: options.from,
      to: options.to,
      policy: 'externally_fixed_canonical_bounds',
    },
    ...deriveMaturityWatermark(evaluations),
    threshold_applied: false,
    coverage_status: null,
  };
}

module.exports = {
  getOrderMaturity,
  deriveMaturityWatermark,
  computeMarketMaturityWatermark,
  _evaluateEvidence,
  _NON_SETTLEMENT_RELAY_SOURCES: NON_SETTLEMENT_RELAY_SOURCES,
};
