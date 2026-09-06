/**
 * @komerce-arch
 * @role          economic-engine-pricing-maturity
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        order_id, market_id, canonical_cohort_bounds, disposition_policy
 * @outputs       order_maturity, maturity_watermark, disposition_event
 * @depends       db, services/cost-allocation/cost-types.js
 * @used-by       future pricing coverage gate
 * @db-read       customs_shipment_parcels, customs_shipments, order_item_cost_imputations, order_item_real_cost_allocations, order_items, orders, parcel_items, parcels, pricing_maturity_disposition_events
 * @db-write      pricing_maturity_disposition_events
 * @db-txn        caller_managed_for_disposition_write
 * @doctrine      pricing_market_viability_maturity_watermark
 * @impact-areas  economic-engine, pricing, governance
 * @version       2026-09
 */

/**
 * KOMERCE — Maturité économique / watermark
 * ════════════════════════════════════════════════════════════════════════
 *
 * Ce service ne calcule PAS encore la couverture économique. Il matérialise :
 *
 *   1. la maturité économique d'une commande à partir de preuves réelles ;
 *   2. un watermark anti cherry-picking sur une cohorte temporelle fixée ;
 *   3. une disposition gouvernée pour les commandes définitivement
 *      irréconciliables, sans jamais transformer la disposition en maturité ;
 *   4. un gate de volume de dispositions fourni par politique externe.
 *
 * Invariants :
 * - absence de preuve != zéro != maturité ;
 * - une disposition ne satisfait aucun critère économique manquant ;
 * - une disposition peut seulement rendre une ligne franchissable par le
 *   watermark ; elle reste publiée séparément de `mature` ;
 * - si une cohorte utilise des dispositions sans politique de plafond, elle
 *   est NOT_DECISIONAL ;
 * - aucun seuil numérique de disposition n'est hardcodé ici ;
 * - les bornes from/to restent obligatoires et externes.
 */

'use strict';

const db = require('../db');
const { SNAPSHOT_LANDED_TO_REAL_COST_TYPE } = require('./cost-allocation/cost-types');

const DISPOSITION_STATES = Object.freeze({
  RECONCILIABLE: 'RECONCILIABLE',
  IRRECONCILABLE_DISPOSED: 'IRRECONCILABLE_DISPOSED',
});

const REASON_CODE_RE = /^[A-Z][A-Z0-9_]{2,79}$/;

const PORT_SNAPSHOT_KEY = Object.keys(SNAPSHOT_LANDED_TO_REAL_COST_TYPE)
  .find((key) => SNAPSHOT_LANDED_TO_REAL_COST_TYPE[key] === 'port_transitaire');
const PORT_REAL_COST_TYPE = SNAPSHOT_LANDED_TO_REAL_COST_TYPE[PORT_SNAPSHOT_KEY];

if (!PORT_SNAPSHOT_KEY || !PORT_REAL_COST_TYPE) {
  throw new Error('canonical port cost mapping is missing');
}

const PER_ITEM_SNAPSHOT_COST_KEYS = Object.freeze(
  Object.keys(SNAPSHOT_LANDED_TO_REAL_COST_TYPE)
    .filter((key) => !['freight', 'customs', 'relay'].includes(key))
);

const NON_SETTLEMENT_RELAY_SOURCES = new Set([
  'cost_components.commission_relais_kmf',
  'finance_config.commission_relais_standard_kmf',
  'literal_current_fallback',
]);

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function normalizeDispositionRow(row) {
  if (!row || !row.disposition_state) return null;
  return {
    event_id: row.disposition_event_id || row.id || null,
    state: row.disposition_state || row.state,
    reason_code: row.disposition_reason_code || row.reason_code,
    rationale: row.disposition_rationale || row.rationale,
    evidence_ref: row.disposition_evidence_ref || row.evidence_ref,
    decided_by: row.disposition_decided_by || row.decided_by,
    decided_at: row.disposition_decided_at || row.decided_at,
  };
}

function isEffectiveDisposition(row) {
  return !!row
    && !row.mature
    && row.disposition?.state === DISPOSITION_STATES.IRRECONCILABLE_DISPOSED;
}

function isWatermarkPassable(row) {
  return !!row && (!!row.mature || isEffectiveDisposition(row));
}

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

  for (const type of PER_ITEM_SNAPSHOT_COST_KEYS) {
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
  const mature = blocking.length === 0;
  const disposition = normalizeDispositionRow(row);
  const disposed = !mature && disposition?.state === DISPOSITION_STATES.IRRECONCILABLE_DISPOSED;

  return {
    order_id: row.order_id,
    market_id: row.market_id || null,
    created_at: row.created_at,
    eligible,
    mature,
    maturity_status: mature
      ? 'MATURE'
      : (disposed ? 'IRRECONCILABLE_DISPOSED' : 'IMMATURE'),
    watermark_passable: mature || disposed,
    criteria,
    blocking_reasons: blocking.map((c) => c.code),
    disposition,
    disposition_effective: disposed,
    evidence_generated_at: new Date().toISOString(),
  };
}

async function getOrderMaturity(orderId, client = db) {
  const { rows } = await client.query(`
    SELECT
      o.id AS order_id,
      o.market_id,
      o.created_at,
      o.status,
      o.payment_status,

      disp.id AS disposition_event_id,
      disp.state AS disposition_state,
      disp.reason_code AS disposition_reason_code,
      disp.rationale AS disposition_rationale,
      disp.evidence_ref AS disposition_evidence_ref,
      disp.decided_by AS disposition_decided_by,
      disp.decided_at AS disposition_decided_at,

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
          AND COALESCE((imp.cost_breakdown->'landed_relay'->>'${PORT_SNAPSHOT_KEY}')::numeric, 0) > 0) AS expected_port_transitary_items,
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
        WHERE alc.order_id = o.id AND alc.cost_type = '${PORT_REAL_COST_TYPE}'
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
    LEFT JOIN LATERAL (
      SELECT d.id, d.state, d.reason_code, d.rationale, d.evidence_ref,
             d.decided_by, d.decided_at
        FROM pricing_maturity_disposition_events d
       WHERE d.order_id = o.id
       ORDER BY d.decided_at DESC, d.id DESC
       LIMIT 1
    ) disp ON TRUE
    WHERE o.id = $1
  `, [orderId]);

  if (!rows.length) return null;
  return _evaluateEvidence(rows[0]);
}

async function getCurrentMaturityDisposition(orderId, client = db) {
  const { rows } = await client.query(`
    SELECT id, order_id, market_id, state, reason_code, rationale,
           evidence_ref, decided_by, decided_at
      FROM pricing_maturity_disposition_events
     WHERE order_id = $1
     ORDER BY decided_at DESC, id DESC
     LIMIT 1
  `, [orderId]);
  return rows[0] || null;
}

function validateDispositionTransitionInput(input, actorUserId) {
  const state = String(input?.state || '').trim().toUpperCase();
  const reasonCode = String(input?.reason_code || '').trim().toUpperCase();
  const rationale = String(input?.rationale || '').trim();
  const evidenceRef = String(input?.evidence_ref || '').trim();

  if (!Object.values(DISPOSITION_STATES).includes(state)) {
    throw new Error('invalid maturity disposition state');
  }
  if (!REASON_CODE_RE.test(reasonCode)) {
    throw new Error('invalid maturity disposition reason_code');
  }
  if (rationale.length < 10 || rationale.length > 2000) {
    throw new Error('maturity disposition rationale must contain 10..2000 characters');
  }
  if (evidenceRef.length < 3 || evidenceRef.length > 1000) {
    throw new Error('maturity disposition evidence_ref must contain 3..1000 characters');
  }
  if (!actorUserId) {
    throw new Error('maturity disposition actor is required');
  }

  return { state, reasonCode, rationale, evidenceRef };
}

async function recordMaturityDisposition(orderId, input, actorUserId, client = db) {
  if (!orderId) throw new Error('orderId is required');
  const normalized = validateDispositionTransitionInput(input, actorUserId);

  const orderRes = await client.query(
    'SELECT id, market_id FROM orders WHERE id = $1',
    [orderId]
  );
  if (!orderRes.rows.length) throw new Error('order not found');
  const order = orderRes.rows[0];
  if (!order.market_id) throw new Error('order market_id is required for maturity disposition');

  const current = await getCurrentMaturityDisposition(orderId, client);
  const currentState = current?.state || DISPOSITION_STATES.RECONCILIABLE;
  if (currentState === normalized.state) {
    throw new Error('maturity disposition state unchanged');
  }

  if (normalized.state === DISPOSITION_STATES.IRRECONCILABLE_DISPOSED) {
    const maturity = await getOrderMaturity(orderId, client);
    if (!maturity) throw new Error('order not found');
    if (maturity.mature) {
      throw new Error('cannot dispose an economically mature order');
    }
  }

  const { rows } = await client.query(`
    INSERT INTO pricing_maturity_disposition_events (
      order_id, market_id, state, reason_code, rationale,
      evidence_ref, decided_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, order_id, market_id, state, reason_code, rationale,
              evidence_ref, decided_by, decided_at
  `, [
    orderId,
    order.market_id,
    normalized.state,
    normalized.reasonCode,
    normalized.rationale,
    normalized.evidenceRef,
    actorUserId,
  ]);

  return rows[0];
}

function normalizeDispositionPolicy(policy, disposedTotal) {
  if (disposedTotal === 0) {
    return {
      configured: !!policy,
      max_ratio: policy?.max_ratio ?? null,
      source: policy?.source || null,
      version: policy?.version || null,
      status: 'NOT_REQUIRED',
      decisional: true,
    };
  }

  if (!policy) {
    return {
      configured: false,
      max_ratio: null,
      source: null,
      version: null,
      status: 'POLICY_REQUIRED',
      decisional: false,
    };
  }

  const maxRatio = Number(policy.max_ratio);
  const source = String(policy.source || '').trim();
  const version = policy.version == null ? null : String(policy.version).trim();

  if (!Number.isFinite(maxRatio) || maxRatio < 0 || maxRatio > 1) {
    throw new Error('disposition policy max_ratio must be between 0 and 1');
  }
  if (source.length < 3) {
    throw new Error('disposition policy source is required');
  }

  return {
    configured: true,
    max_ratio: maxRatio,
    source,
    version: version || null,
    status: 'PENDING_RATIO_EVALUATION',
    decisional: null,
  };
}

function deriveMaturityWatermark(orderMaturities = [], options = {}) {
  const rows = [...orderMaturities]
    .filter(Boolean)
    .sort((a, b) => {
      const dt = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (dt !== 0) return dt;
      return String(a.order_id).localeCompare(String(b.order_id));
    });

  const total = rows.length;
  const matureTotal = rows.filter((r) => r.mature).length;
  const disposedRows = rows.filter((r) => isEffectiveDisposition(r));
  const disposedTotal = disposedRows.length;
  const unresolvedImmatureTotal = rows.filter((r) => !isWatermarkPassable(r)).length;
  const maturityRatio = total > 0 ? Number((matureTotal / total).toFixed(4)) : null;
  const dispositionRatio = total > 0 ? Number((disposedTotal / total).toFixed(4)) : null;
  const effectivePassRatio = total > 0
    ? Number(((matureTotal + disposedTotal) / total).toFixed(4))
    : null;

  const dispositionGate = normalizeDispositionPolicy(options.dispositionPolicy, disposedTotal);
  if (disposedTotal > 0 && dispositionGate.configured) {
    const exceeded = dispositionRatio > dispositionGate.max_ratio;
    dispositionGate.status = exceeded ? 'LIMIT_EXCEEDED' : 'WITHIN_LIMIT';
    dispositionGate.decisional = !exceeded;
  }

  if (total === 0) {
    return {
      status: 'EMPTY',
      decision_status: 'NOT_DECISIONAL',
      total_orders: 0,
      mature_orders: 0,
      disposed_orders: 0,
      unresolved_immature_orders: 0,
      immature_orders: 0,
      maturity_ratio: null,
      disposition_ratio: null,
      effective_pass_ratio: null,
      disposition_gate: dispositionGate,
      disposed_order_ids: [],
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

  const firstBlockingIndex = groups.findIndex((g) => g.rows.some((r) => !isWatermarkPassable(r)));
  const safeGroups = firstBlockingIndex === -1 ? groups : groups.slice(0, firstBlockingIndex);
  const safeRows = safeGroups.flatMap((g) => g.rows);
  const lastSafeGroup = safeGroups[safeGroups.length - 1] || null;
  const blockingGroup = firstBlockingIndex === -1 ? null : groups[firstBlockingIndex];

  let status = disposedTotal > 0 ? 'PASSABLE_WITH_DISPOSITIONS' : 'FULLY_MATURE';
  if (blockingGroup && safeRows.length === 0) status = 'BLOCKED_AT_START';
  else if (blockingGroup) status = 'PARTIAL';

  const decisionStatus = blockingGroup || dispositionGate.decisional === false
    ? 'NOT_DECISIONAL'
    : 'READY_FOR_NEXT_GATE';

  return {
    status,
    decision_status: decisionStatus,
    total_orders: total,
    mature_orders: matureTotal,
    disposed_orders: disposedTotal,
    unresolved_immature_orders: unresolvedImmatureTotal,
    immature_orders: total - matureTotal,
    maturity_ratio: maturityRatio,
    disposition_ratio: dispositionRatio,
    effective_pass_ratio: effectivePassRatio,
    disposition_gate: dispositionGate,
    disposed_order_ids: disposedRows.map((r) => r.order_id),
    safe_prefix_order_count: safeRows.length,
    watermark_at: lastSafeGroup ? lastSafeGroup.key : null,
    watermark_order_ids: lastSafeGroup ? lastSafeGroup.rows.map((r) => r.order_id) : [],
    first_blocking_at: blockingGroup ? blockingGroup.key : null,
    first_blocking_order_ids: blockingGroup
      ? blockingGroup.rows.filter((r) => !isWatermarkPassable(r)).map((r) => r.order_id)
      : [],
    first_blocking_reasons: blockingGroup
      ? [...new Set(blockingGroup.rows
        .filter((r) => !isWatermarkPassable(r))
        .flatMap((r) => r.blocking_reasons || []))]
      : [],
  };
}

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
  for (const row of rows) {
    const maturity = await getOrderMaturity(row.id);
    if (maturity) evaluations.push(maturity);
  }

  const watermark = deriveMaturityWatermark(evaluations, {
    dispositionPolicy: options.dispositionPolicy || null,
  });

  return {
    market_id: marketId,
    cohort: {
      from: options.from,
      to: options.to,
      policy: 'externally_fixed_canonical_bounds',
    },
    ...watermark,
    disposition_threshold_applied: watermark.disposed_orders > 0
      && watermark.disposition_gate.configured,
    threshold_applied: false,
    coverage_status: null,
  };
}

module.exports = {
  DISPOSITION_STATES,
  getOrderMaturity,
  getCurrentMaturityDisposition,
  recordMaturityDisposition,
  deriveMaturityWatermark,
  computeMarketMaturityWatermark,
  _evaluateEvidence,
  _isEffectiveDisposition: isEffectiveDisposition,
  _NON_SETTLEMENT_RELAY_SOURCES: NON_SETTLEMENT_RELAY_SOURCES,
  _PORT_COST_MAPPING: Object.freeze({ snapshot_key: PORT_SNAPSHOT_KEY, real_cost_type: PORT_REAL_COST_TYPE }),
};
