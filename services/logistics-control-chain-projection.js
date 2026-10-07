/**
 * @komerce-arch
 * @role          logistics-control-chain-projection
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, optional_server_resolved_order
 * @outputs       canonical_logistics_control_chain_projection, single_order_control_snapshot
 * @depends       db, dashboard-metrics/_helpers
 * @used-by       services/dashboard-operations.js, services/order-360.js
 * @db-read       orders, order_items, purchase_lines, purchase_orders, supplier_execution_payments, hub_purchase_allocations, hub_physical_unit_placements, hub_physical_units, parcels, customs_shipment_parcels, customs_shipments, incidents, alerts, signals
 * @db-write      none
 * @db-txn        none
 * @doctrine      DOCTRINE_LOGISTICS_CONTROL_CHAIN, dashboard_no_business_recompute, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, logistics, purchasing, orders, market-authorization
 * @version       2026-10
 */

'use strict';

const db = require('../db');
const { ACTIVE_ORDER_STATUSES } = require('./dashboard-metrics/_helpers');

const STAGES = Object.freeze([
  Object.freeze({ key: 'ORDER', label: 'Commande' }),
  Object.freeze({ key: 'PURCHASING', label: 'Achats' }),
  Object.freeze({ key: 'SUPPLIER', label: 'Fournisseur' }),
  Object.freeze({ key: 'HUB_RECEIVING', label: 'Réception HUB' }),
  Object.freeze({ key: 'HUB_CONTROL', label: 'Contrôle HUB' }),
  Object.freeze({ key: 'FORWARDER', label: 'Transitaire' }),
  Object.freeze({ key: 'TRANSPORT', label: 'Transport' }),
  Object.freeze({ key: 'CUSTOMS', label: 'Douane' }),
  Object.freeze({ key: 'RELAY', label: 'Relais' }),
]);

const HEALTH = Object.freeze({
  GREEN: 'GREEN',
  ORANGE: 'ORANGE',
  RED: 'RED',
  UNKNOWN: 'UNKNOWN',
});

const CONTROL_CHAIN_STALE_AFTER_MINUTES = 30;

const STRUCTURAL_ALERT_MIN_ORDERS = 3;

function healthRank(health) {
  if (health === HEALTH.RED) return 3;
  if (health === HEALTH.ORANGE) return 2;
  if (health === HEALTH.UNKNOWN) return 1;
  return 0;
}

function buildStructuralAlerts(orders, minOrders = STRUCTURAL_ALERT_MIN_ORDERS) {
  const groups = new Map();

  for (const order of orders || []) {
    if (!order || order.health === HEALTH.GREEN) continue;
    const causes = Array.isArray(order.exceptions) && order.exceptions.length
      ? order.exceptions
      : (order.exception ? [order.exception] : []);
    for (const cause of causes) {
      if (!cause || !cause.code) continue;
      const key = [order.stage, cause.code, cause.owner_role || ''].join('|');
      const current = groups.get(key) || {
        stage: order.stage,
        health: order.health,
        reason_code: cause.code,
        summary: cause.summary || null,
        owner_role: cause.owner_role || null,
        order_references: [],
      };
      if (healthRank(order.health) > healthRank(current.health)) current.health = order.health;
      if (!current.summary && cause.summary) current.summary = cause.summary;
      current.order_references.push(order.order_reference);
      groups.set(key, current);
    }
  }

  return Object.freeze(
    [...groups.values()]
      .filter(group => group.order_references.length >= minOrders)
      .map(group => Object.freeze({
        ...group,
        order_count: group.order_references.length,
        order_references: Object.freeze([...group.order_references]),
      }))
      .sort((a, b) =>
        healthRank(b.health) - healthRank(a.health)
        || b.order_count - a.order_count
        || String(a.stage).localeCompare(String(b.stage))
        || String(a.reason_code).localeCompare(String(b.reason_code))
      )
  );
}

function marketId(market) {
  return market && market.id ? market.id : null;
}

function toTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(Boolean).map(String);
}

function envelopeFor(row) {
  if (['RELAY', 'CUSTOMS', 'TRANSPORT', 'FORWARDER'].includes(row.current_stage)) {
    return Object.freeze({ type: 'PARCEL', refs: Object.freeze(toTextArray(row.parcel_refs)) });
  }
  if (['HUB_RECEIVING', 'HUB_CONTROL'].includes(row.current_stage)) {
    return Object.freeze({ type: 'HUB_UNIT', refs: Object.freeze(toTextArray(row.hub_unit_refs)) });
  }
  if (['PURCHASING', 'SUPPLIER'].includes(row.current_stage) && toTextArray(row.purchase_order_refs).length) {
    return Object.freeze({ type: 'PURCHASE_ORDER', refs: Object.freeze(toTextArray(row.purchase_order_refs)) });
  }
  return Object.freeze({ type: 'ORDER', refs: Object.freeze([String(row.order_reference)]) });
}

function normalizeExceptions(row) {
  const causes = Array.isArray(row.exception_causes) ? row.exception_causes : [];
  const normalized = causes.map(cause => ({
    code: cause.signal_type || cause.code,
    summary: cause.summary || null,
    owner_role: cause.owner_role || null,
    severity: cause.severity || null,
  })).filter(cause => cause.code);

  if (row.exception_code) {
    const primary = {
      code: row.exception_code,
      summary: row.exception_summary || null,
      owner_role: row.exception_owner_role || null,
      severity: row.exception_severity || null,
    };
    const rest = normalized.filter(cause =>
      cause.code !== primary.code
      || cause.owner_role !== primary.owner_role
    );
    normalized.splice(0, normalized.length, primary, ...rest);
  }

  return Object.freeze(normalized.slice(0, 3).map(cause => Object.freeze(cause)));
}

function projectRow(row) {
  const health = Object.values(HEALTH).includes(row.health) ? row.health : HEALTH.UNKNOWN;
  const exceptions = normalizeExceptions(row);
  return Object.freeze({
    order_reference: row.order_reference,
    stage: row.current_stage,
    health,
    exception: exceptions[0] || null,
    exceptions,
    envelope: envelopeFor(row),
    split: Number(row.parcels_count || 0) > 1,
    lineage: Object.freeze({
      purchase_orders: Object.freeze(toTextArray(row.purchase_order_refs)),
      hub_units: Object.freeze(toTextArray(row.hub_unit_refs)),
      parcels: Object.freeze(toTextArray(row.parcel_refs)),
    }),
  });
}

async function getControlChain(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 250, 500));
  const orderId = options.orderId || null;
  const params = [marketId(options.market), ACTIVE_ORDER_STATUSES, limit, orderId, CONTROL_CHAIN_STALE_AFTER_MINUTES];

  const { rows } = await db.query(`
    WITH scoped_orders AS (
      SELECT o.id,
             o.reference AS order_reference,
             o.market_id,
             o.status::text AS order_status,
             o.payment_status::text AS payment_status,
             o.created_at,
             o.updated_at
        FROM orders o
       WHERE ($1::uuid IS NULL OR o.market_id = $1)
         AND o.status::text = ANY($2::text[])
         AND ($4::uuid IS NULL OR o.id = $4::uuid)
    ),
    purchase_facts AS (
      SELECT oi.order_id,
             COUNT(DISTINCT pl.purchase_order_id) FILTER (WHERE pl.purchase_order_id IS NOT NULL)::int AS po_count,
             BOOL_AND(COALESCE(po.status::text IN ('confirmed','shipped','hub_received'), FALSE)) AS supplier_acknowledged,
             ARRAY_REMOVE(ARRAY_AGG(DISTINCT po.id::text), NULL) AS purchase_order_refs,
             MAX(COALESCE(po.updated_at, pl.updated_at, pl.created_at)) AS last_purchase_at
        FROM purchase_lines pl
        JOIN order_items oi ON oi.id = pl.order_item_id
        JOIN scoped_orders so ON so.id = oi.order_id
        LEFT JOIN purchase_orders po ON po.id = pl.purchase_order_id
       WHERE pl.cancelled_at IS NULL
       GROUP BY oi.order_id
    ),
    hub_facts AS (
      SELECT hpa.order_id,
             BOOL_OR(hpu.state = 'RECEIVED') AS has_receiving_pending,
             BOOL_OR(hpu.state IN ('IDENTIFIED','QUALITY_CHECKED','LOCATED','ALLOCATED','PICKED','PACKED')) AS has_control,
             BOOL_OR(hpu.state = 'DISPATCHED') AS has_dispatched,
             BOOL_OR(hpu.state = 'QUARANTINED') AS has_quarantine,
             ARRAY_REMOVE(ARRAY_AGG(DISTINCT hpu.reference), NULL) AS hub_unit_refs,
             MAX(COALESCE(hpu.updated_at, hp.placed_at, hpa.created_at)) AS last_hub_at
        FROM hub_purchase_allocations hpa
        JOIN scoped_orders so ON so.id = hpa.order_id
        LEFT JOIN hub_physical_unit_placements hp
          ON hp.allocation_id = hpa.id
         AND hp.removed_at IS NULL
        LEFT JOIN hub_physical_units hpu ON hpu.id = hp.physical_unit_id
       GROUP BY hpa.order_id
    ),
    parcel_facts AS (
      SELECT p.order_id,
             COUNT(*)::int AS parcels_count,
             BOOL_OR(p.status::text = 'preparation') AS has_preparation,
             BOOL_OR(p.status::text = 'shipped') AS has_shipped,
             BOOL_OR(p.status::text = 'in_transit') AS has_in_transit,
             BOOL_OR(p.status::text = 'arrived') AS has_arrived,
             BOOL_OR(p.status::text IN ('available','collected')) AS has_relay,
             ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.reference), NULL) AS parcel_refs,
             MAX(COALESCE(
               p.collected_at, p.available_at, p.arrived_at, p.in_transit_at,
               p.shipped_at, p.prepared_at, p.updated_at, p.created_at
             )) AS last_parcel_at
        FROM parcels p
        JOIN scoped_orders so ON so.id = p.order_id
       WHERE p.status::text <> 'cancelled'
       GROUP BY p.order_id
    ),
    customs_facts AS (
      SELECT p.order_id,
             BOOL_OR(cs.status::text IN ('declared','confirmed')) AS has_customs,
             MAX(COALESCE(cs.declared_at, cs.updated_at, cs.created_at)) AS last_customs_at
        FROM customs_shipment_parcels csp
        JOIN parcels p ON p.id = csp.parcel_id
        JOIN scoped_orders so ON so.id = p.order_id
        JOIN customs_shipments cs ON cs.id = csp.shipment_id
       WHERE cs.is_active = TRUE
       GROUP BY p.order_id
    ),
    linked_signals AS (
      SELECT so.id AS order_id,
             s.signal_type,
             s.severity,
             s.summary,
             s.owner_role,
             s.created_at
        FROM scoped_orders so
        JOIN signals s
          ON s.entity_type = 'order'
         AND s.entity_id::text = so.id::text
       WHERE s.status IN ('open','acknowledged','snoozed')
      UNION ALL
      SELECT p.order_id,
             s.signal_type,
             s.severity,
             s.summary,
             s.owner_role,
             s.created_at
        FROM parcels p
        JOIN scoped_orders so ON so.id = p.order_id
        JOIN signals s
          ON s.entity_type = 'parcel'
         AND s.entity_id::text = p.id::text
       WHERE s.status IN ('open','acknowledged','snoozed')
      UNION ALL
      SELECT so.id AS order_id,
             i.incident_type AS signal_type,
             CASE i.severity
               WHEN 'critical' THEN 'critical'
               WHEN 'high' THEN 'high'
               ELSE 'warning'
             END AS severity,
             COALESCE(i.title, i.description, i.incident_type) AS summary,
             i.resolver_domain AS owner_role,
             i.created_at
        FROM incidents i
        LEFT JOIN parcels ip ON ip.id = i.parcel_id
        JOIN scoped_orders so ON so.id = COALESCE(i.order_id, ip.order_id)
       WHERE i.status IN ('open','investigating')
      UNION ALL
      -- Les erreurs de création de PO sont déjà des faits Purchasing persistés
      -- dans alerts et rattachés à la commande. La Control Tower les projette,
      -- sans créer de nouveau statut métier ni recopier leur lifecycle.
      SELECT so.id AS order_id,
             a.type AS signal_type,
             CASE a.severity
               WHEN 'high' THEN 'high'
               ELSE 'warning'
             END AS severity,
             COALESCE(a.title, a.description, a.type) AS summary,
             'purchasing' AS owner_role,
             a.created_at
        FROM alerts a
        JOIN scoped_orders so
          ON a.entity_type = 'order'
         AND a.entity_id = so.id
       WHERE a.type = 'purchasing_po_creation_failed'
         AND a.resolved_at IS NULL
      UNION ALL
      -- Un signal de paiement fournisseur reste un fait GLOBAL. La Control Tower
      -- ne lui invente jamais un market_id : elle projette seulement son impact
      -- sur les commandes reliées exactement par payment -> PO -> line -> item.
      SELECT DISTINCT so.id AS order_id,
             s.signal_type,
             s.severity,
             s.summary,
             s.owner_role,
             s.created_at
        FROM signals s
        JOIN supplier_execution_payments sep
          ON s.entity_type = 'supplier_payment'
         AND s.entity_id::text = sep.id::text
        JOIN purchase_lines spl
          ON spl.purchase_order_id = sep.purchase_order_id
         AND spl.cancelled_at IS NULL
        JOIN order_items soi ON soi.id = spl.order_item_id
        JOIN scoped_orders so ON so.id = soi.order_id
       WHERE s.status IN ('open','acknowledged','snoozed')
    ),
    ranked_signals AS (
      SELECT ls.*,
             ROW_NUMBER() OVER (
               PARTITION BY ls.order_id
               ORDER BY
                 CASE ls.severity
                   WHEN 'urgent' THEN 1
                   WHEN 'critical' THEN 2
                   WHEN 'high' THEN 3
                   WHEN 'warning' THEN 4
                   ELSE 5
                 END,
                 ls.created_at DESC
             ) AS rn
        FROM linked_signals ls
    ),
    signal_summary AS (
      SELECT order_id,
             MAX(severity) FILTER (WHERE rn = 1) AS primary_severity,
             MAX(signal_type) FILTER (WHERE rn = 1) AS primary_signal_type,
             MAX(summary) FILTER (WHERE rn = 1) AS primary_summary,
             MAX(owner_role) FILTER (WHERE rn = 1) AS primary_owner_role,
             JSONB_AGG(
               JSONB_BUILD_OBJECT(
                 'signal_type', signal_type,
                 'severity', severity,
                 'summary', summary,
                 'owner_role', owner_role
               )
               ORDER BY rn
             ) FILTER (WHERE rn <= 3) AS exception_causes
        FROM ranked_signals
       WHERE rn <= 3
       GROUP BY order_id
    ),
    projected AS (
      SELECT so.*,
             COALESCE(pf.po_count, 0) AS po_count,
             COALESCE(pf.purchase_order_refs, ARRAY[]::text[]) AS purchase_order_refs,
             COALESCE(hf.hub_unit_refs, ARRAY[]::text[]) AS hub_unit_refs,
             COALESCE(paf.parcel_refs, ARRAY[]::text[]) AS parcel_refs,
             COALESCE(paf.parcels_count, 0) AS parcels_count,
             CASE
               -- orders.status est l'agrégat canonique "pire état visible" des colis.
               -- Il garde une commande splittée à l'étape de son engagement restant
               -- au lieu de la pousser vers le morceau le plus avancé.
               WHEN so.order_status = 'available' THEN 'RELAY'
               WHEN so.order_status = 'in_transit' AND COALESCE(paf.has_in_transit, FALSE) THEN 'TRANSPORT'
               WHEN so.order_status = 'in_transit'
                    AND (COALESCE(paf.has_arrived, FALSE) OR COALESCE(cf.has_customs, FALSE)) THEN 'CUSTOMS'
               WHEN so.order_status = 'in_transit' THEN 'TRANSPORT'
               WHEN so.order_status = 'shipped' THEN 'FORWARDER'
               WHEN so.order_status = 'preparation' AND COALESCE(hf.has_receiving_pending, FALSE) THEN 'HUB_RECEIVING'
               WHEN so.order_status = 'preparation'
                    AND (COALESCE(hf.has_control, FALSE) OR COALESCE(hf.has_quarantine, FALSE) OR COALESCE(paf.has_preparation, FALSE)) THEN 'HUB_CONTROL'
               WHEN so.order_status = 'preparation' AND COALESCE(hf.has_dispatched, FALSE) THEN 'FORWARDER'
               WHEN so.order_status = 'preparation' THEN 'HUB_CONTROL'
               -- purchasing-completion fait ORDERED -> PREPARATION seulement
               -- quand toutes les lignes import nécessaires sont reçues au Hub.
               -- Une branche Hub avancée ne masque donc jamais une branche
               -- encore Purchasing/Supplier tant que l'ordre reste ORDERED.
               WHEN so.order_status = 'ordered' AND COALESCE(pf.supplier_acknowledged, FALSE) THEN 'SUPPLIER'
               WHEN so.order_status = 'ordered' THEN 'PURCHASING'
               WHEN COALESCE(pf.supplier_acknowledged, FALSE) THEN 'SUPPLIER'
               WHEN COALESCE(pf.po_count, 0) > 0 THEN 'PURCHASING'
               ELSE 'ORDER'
             END AS current_stage,
             CASE
               WHEN COALESCE(hf.has_quarantine, FALSE) THEN 'RED'
               WHEN ss.primary_severity IN ('urgent','critical','high') THEN 'RED'
               WHEN ss.primary_severity = 'warning' THEN 'ORANGE'
               WHEN GREATEST(
                 so.updated_at,
                 COALESCE(pf.last_purchase_at, so.created_at),
                 COALESCE(hf.last_hub_at, so.created_at),
                 COALESCE(paf.last_parcel_at, so.created_at),
                 COALESCE(cf.last_customs_at, so.created_at)
               ) < NOW() - ($5::int * INTERVAL '1 minute') THEN 'ORANGE'
               WHEN GREATEST(
                 so.updated_at,
                 COALESCE(pf.last_purchase_at, so.created_at),
                 COALESCE(hf.last_hub_at, so.created_at),
                 COALESCE(paf.last_parcel_at, so.created_at),
                 COALESCE(cf.last_customs_at, so.created_at)
               ) IS NOT NULL THEN 'GREEN'
               ELSE 'UNKNOWN'
             END AS health,
             CASE
               WHEN COALESCE(hf.has_quarantine, FALSE) THEN 'hub_quarantine'
               WHEN ss.primary_signal_type IS NULL
                    AND GREATEST(
                      so.updated_at,
                      COALESCE(pf.last_purchase_at, so.created_at),
                      COALESCE(hf.last_hub_at, so.created_at),
                      COALESCE(paf.last_parcel_at, so.created_at),
                      COALESCE(cf.last_customs_at, so.created_at)
                    ) < NOW() - ($5::int * INTERVAL '1 minute')
                 THEN 'observation_stale'
               ELSE ss.primary_signal_type
             END AS exception_code,
             CASE
               WHEN COALESCE(hf.has_quarantine, FALSE) THEN 'Unité HUB en quarantaine'
               WHEN ss.primary_signal_type IS NULL
                    AND GREATEST(
                      so.updated_at,
                      COALESCE(pf.last_purchase_at, so.created_at),
                      COALESCE(hf.last_hub_at, so.created_at),
                      COALESCE(paf.last_parcel_at, so.created_at),
                      COALESCE(cf.last_customs_at, so.created_at)
                    ) < NOW() - ($5::int * INTERVAL '1 minute')
                 THEN 'Observation métier trop ancienne'
               ELSE ss.primary_summary
             END AS exception_summary,
             CASE
               WHEN ss.primary_owner_role IS NOT NULL THEN ss.primary_owner_role
               WHEN GREATEST(
                      so.updated_at,
                      COALESCE(pf.last_purchase_at, so.created_at),
                      COALESCE(hf.last_hub_at, so.created_at),
                      COALESCE(paf.last_parcel_at, so.created_at),
                      COALESCE(cf.last_customs_at, so.created_at)
                    ) < NOW() - ($5::int * INTERVAL '1 minute')
                 THEN CASE
                   WHEN (
                     CASE
                       WHEN so.order_status = 'available' THEN 'RELAY'
                       WHEN so.order_status = 'in_transit' AND COALESCE(paf.has_in_transit, FALSE) THEN 'TRANSPORT'
                       WHEN so.order_status = 'in_transit'
                            AND (COALESCE(paf.has_arrived, FALSE) OR COALESCE(cf.has_customs, FALSE)) THEN 'CUSTOMS'
                       WHEN so.order_status = 'in_transit' THEN 'TRANSPORT'
                       WHEN so.order_status = 'shipped' THEN 'FORWARDER'
                       WHEN so.order_status = 'preparation' AND COALESCE(hf.has_receiving_pending, FALSE) THEN 'HUB_RECEIVING'
                       WHEN so.order_status = 'preparation'
                            AND (COALESCE(hf.has_control, FALSE) OR COALESCE(hf.has_quarantine, FALSE) OR COALESCE(paf.has_preparation, FALSE)) THEN 'HUB_CONTROL'
                       WHEN so.order_status = 'preparation' AND COALESCE(hf.has_dispatched, FALSE) THEN 'FORWARDER'
                       WHEN so.order_status = 'preparation' THEN 'HUB_CONTROL'
                       WHEN so.order_status = 'ordered' AND COALESCE(pf.supplier_acknowledged, FALSE) THEN 'SUPPLIER'
                       WHEN so.order_status = 'ordered' THEN 'PURCHASING'
                       WHEN COALESCE(pf.supplier_acknowledged, FALSE) THEN 'SUPPLIER'
                       WHEN COALESCE(pf.po_count, 0) > 0 THEN 'PURCHASING'
                       ELSE 'ORDER'
                     END
                   )
                   WHEN 'PURCHASING' THEN 'purchasing'
                   WHEN 'SUPPLIER' THEN 'purchasing'
                   WHEN 'HUB_RECEIVING' THEN 'hub'
                   WHEN 'HUB_CONTROL' THEN 'hub'
                   WHEN 'FORWARDER' THEN 'transitaire'
                   WHEN 'TRANSPORT' THEN 'logistics'
                   WHEN 'CUSTOMS' THEN 'customs'
                   WHEN 'RELAY' THEN 'relais'
                   ELSE 'operations'
                 END
               ELSE NULL
             END AS exception_owner_role,
             ss.primary_severity AS exception_severity,
             COALESCE(ss.exception_causes, '[]'::jsonb) AS exception_causes,
             GREATEST(
               so.updated_at,
               COALESCE(pf.last_purchase_at, so.created_at),
               COALESCE(hf.last_hub_at, so.created_at),
               COALESCE(paf.last_parcel_at, so.created_at),
               COALESCE(cf.last_customs_at, so.created_at)
             ) AS last_fact_at
        FROM scoped_orders so
        LEFT JOIN purchase_facts pf ON pf.order_id = so.id
        LEFT JOIN hub_facts hf ON hf.order_id = so.id
        LEFT JOIN parcel_facts paf ON paf.order_id = so.id
        LEFT JOIN customs_facts cf ON cf.order_id = so.id
        LEFT JOIN signal_summary ss ON ss.order_id = so.id
    )
    SELECT order_reference,
           current_stage,
           health,
           exception_code,
           exception_summary,
           exception_owner_role,
           exception_severity,
           exception_causes,
           purchase_order_refs,
           hub_unit_refs,
           parcel_refs,
           parcels_count
      FROM projected
     ORDER BY
       CASE health WHEN 'RED' THEN 1 WHEN 'ORANGE' THEN 2 WHEN 'UNKNOWN' THEN 3 ELSE 4 END,
       last_fact_at ASC,
       order_reference ASC
     LIMIT $3
  `, params);

  const orders = rows.map(projectRow);
  const byStage = Object.fromEntries(STAGES.map(stage => [stage.key, []]));
  orders.forEach(order => {
    if (byStage[order.stage]) byStage[order.stage].push(order);
  });

  return Object.freeze({
    stages: STAGES,
    orders: Object.freeze(orders),
    by_stage: Object.freeze(Object.fromEntries(
      Object.entries(byStage).map(([key, list]) => [key, Object.freeze(list)])
    )),
    structural_alerts: buildStructuralAlerts(orders),
  });
}

async function getOrderControlSnapshot(order) {
  if (!order || !order.id) throw new Error('control_tower_resolved_order_required');
  const result = await getControlChain({
    market: order.market_id ? { id: order.market_id } : null,
    orderId: order.id,
    limit: 1,
  });
  return result.orders.find(row => row.order_reference === order.reference) || result.orders[0] || null;
}

module.exports = {
  STAGES,
  HEALTH,
  STRUCTURAL_ALERT_MIN_ORDERS,
  CONTROL_CHAIN_STALE_AFTER_MINUTES,
  healthRank,
  buildStructuralAlerts,
  normalizeExceptions,
  projectRow,
  getControlChain,
  getOrderControlSnapshot,
};
