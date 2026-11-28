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
 * @db-read       orders, order_status_history, order_items, purchase_lines, purchase_orders, supplier_execution_payments, hub_purchase_allocations, hub_physical_unit_placements, hub_physical_units, parcels, customs_shipment_parcels, customs_shipments, incidents, alerts, signals
 * @db-write      none
 * @db-txn        none
 * @doctrine      DOCTRINE_LOGISTICS_CONTROL_CHAIN, dashboard_no_business_recompute, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, logistics, purchasing, orders, market-authorization
 * @version       2026-10
 */

'use strict';

const db = require('../db');
const {isValidScope}=require('./simulation-scope-service');
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

const STRUCTURAL_ALERT_MIN_ORDERS = 3;
const DRILL_PAGE_SIZE = 25;
const PHASE_STAGES = Object.freeze({
  ORDER: Object.freeze(['ORDER']),
  PURCHASING: Object.freeze(['PURCHASING','SUPPLIER']),
  HUB: Object.freeze(['HUB_RECEIVING','HUB_CONTROL']),
  CUSTOMS: Object.freeze(['FORWARDER','TRANSPORT','CUSTOMS']),
  RELAY: Object.freeze(['RELAY']),
});
function drillError(status, code) {
  return Object.assign(new Error(code), {status, code});
}

// Only a validated server-side selection can reach the paged projection.
function parseChainDrill(query = {}) {
  const phase = query.chain_drill;
  const health = query.health == null ? null : query.health;
  const page = Number(query.page);
  if (typeof phase !== 'string' || (phase !== 'ALL' && !Object.prototype.hasOwnProperty.call(PHASE_STAGES,phase))
      || (health !== null && (phase === 'ALL' || !Object.prototype.hasOwnProperty.call(HEALTH,health) || typeof health !== 'string'))
      || typeof query.page !== 'string' || !/^[1-9][0-9]*$/.test(query.page)
      || !Number.isSafeInteger(page) || page > 1000000
      || typeof query.token !== 'string' || !/^[a-f0-9]{32}$/.test(query.token)
      || (query.simulation_scope !== undefined && !isValidScope(query.simulation_scope))) {
    throw drillError(400,'invalid_control_chain_drill');
  }
  return {phase,health,page,token:query.token,stages:phase==='ALL'?null:PHASE_STAGES[phase],
    ...(query.simulation_scope ? {simulationScope:query.simulation_scope}: {})};
}

// A census is authoritative only when all stage/health cells reconcile to the full total.
// The token pins membership, position, health and sort order (not a historical snapshot).
function readCensus(rows,total) {
  const first=rows[0];
  if (!first || !Array.isArray(first.population_distribution) || !Number.isSafeInteger(total)
      || typeof first.population_token !== 'string' || !/^[a-f0-9]{32}$/.test(first.population_token)
      || !rows.every(row=>row.population_token===first.population_token)) return null;
  const counts=Object.fromEntries(STAGES.map(stage=>[stage.key,{GREEN:0,ORANGE:0,RED:0,UNKNOWN:0}]));
  const seen=new Set();
  let sum=0;
  for (const cell of first.population_distribution) {
    if (!cell || !Object.prototype.hasOwnProperty.call(counts,cell.stage)
        || !Object.prototype.hasOwnProperty.call(HEALTH,cell.health)
        || !Number.isSafeInteger(cell.count) || cell.count<1) return null;
    const key=cell.stage+':'+cell.health;
    if(seen.has(key)) return null;
    seen.add(key);
    counts[cell.stage][cell.health]=cell.count;
    sum+=cell.count;
  }
  if(sum!==total) return null;
  for (const row of rows) {
    const key=row.current_stage;
    if (!counts[key] || !counts[key][row.health]) return null;
  }
  return Object.freeze({token:first.population_token,stage_counts:Object.freeze(Object.fromEntries(
    Object.entries(counts).map(([key,value])=>[key,Object.freeze(value)])))});
}

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
  // Local pur : pas de preuve importée (PO/Hub/colis) à inventer.
  if (row.local_only === true && row.current_stage === 'RELAY'
      && toTextArray(row.parcel_refs).length === 0) {
    return Object.freeze({ type: 'ORDER', refs: Object.freeze([String(row.order_reference)]) });
  }
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
    local_only: row.local_only === true,
    health,
    exception: exceptions[0] || null,
    exceptions,
    envelope: envelopeFor(row),
    split: Number(row.parcels_count || 0) > 1,
    transitions: Object.freeze((Array.isArray(row.recent_transitions) ? row.recent_transitions : [])
      .filter(item => item && item.status)
      .map(item => Object.freeze({ status: String(item.status), at: item.at || null }))),
    lineage: Object.freeze({
      purchase_orders: Object.freeze(toTextArray(row.purchase_order_refs)),
      hub_units: Object.freeze(toTextArray(row.hub_unit_refs)),
      parcels: Object.freeze(toTextArray(row.parcel_refs)),
    }),
  });
}

async function getControlChain(options = {}) {
  const drill = options.drill || null;
  const limit = drill ? DRILL_PAGE_SIZE : Math.max(1, Math.min(Number(options.limit) || 250, 500));
  const orderId = options.orderId || null;
  const params = [marketId(options.market), ACTIVE_ORDER_STATUSES, limit, orderId];
  if (drill) params.push(drill.stages,drill.health,(drill.page-1)*limit);
  const simulationScope=drill ? drill.simulationScope : options.simulationScope;
  if(simulationScope!==undefined && !isValidScope(simulationScope)) throw drillError(400,'invalid_simulation_scope');
  const scopeParam=simulationScope ? params.push(simulationScope) : null;

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
         AND ${scopeParam ? 'o.simulation_scope = $'+scopeParam+'::text' : 'o.simulation_scope IS NULL'}
         AND o.status::text = ANY($2::text[])
         AND ($4::uuid IS NULL OR o.id = $4::uuid)
    ),
    fulfillment_facts AS (
      -- LOCAL_ONLY exige toutes les lignes explicitement LOCAL_STOCK.
      -- Une provenance NULL n'est ni une preuve de LOCAL ni une preuve d'IMPORT.
      SELECT oi.order_id,
             BOOL_AND(COALESCE(oi.fulfillment_source = 'LOCAL_STOCK', FALSE)) AS local_only
        FROM order_items oi
        JOIN scoped_orders so ON so.id = oi.order_id
       GROUP BY oi.order_id
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
             COALESCE(ff.local_only, FALSE) AS local_only,
             CASE
               -- orders.status est l'agrégat canonique "pire état visible" des colis.
               -- Il garde une commande splittée à l'étape de son engagement restant
               -- au lieu de la pousser vers le morceau le plus avancé.
               WHEN so.order_status = 'available' THEN 'RELAY'
               -- Commande 100% locale : préparer puis remettre directement
               -- au relais, sans PO ni étape Hub fictive.
               WHEN COALESCE(ff.local_only, FALSE)
                    AND so.order_status IN ('confirmed','ordered','preparation') THEN 'RELAY'
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
               -- L'inactivité n'est pas un risque : seule une anomalie métier
               -- persistée ou une quarantaine influe sur la couleur.
               WHEN COALESCE(hf.has_quarantine, FALSE) THEN 'RED'
               WHEN ss.primary_severity IN ('urgent','critical','high') THEN 'RED'
               WHEN ss.primary_severity = 'warning' THEN 'ORANGE'
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
               ELSE ss.primary_signal_type
             END AS exception_code,
             CASE
               WHEN COALESCE(hf.has_quarantine, FALSE) THEN 'Unité HUB en quarantaine'
               ELSE ss.primary_summary
             END AS exception_summary,
             CASE
               WHEN COALESCE(hf.has_quarantine, FALSE) THEN 'hub'
               ELSE ss.primary_owner_role
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
        LEFT JOIN fulfillment_facts ff ON ff.order_id = so.id
        LEFT JOIN purchase_facts pf ON pf.order_id = so.id
        LEFT JOIN hub_facts hf ON hf.order_id = so.id
        LEFT JOIN parcel_facts paf ON paf.order_id = so.id
        LEFT JOIN customs_facts cf ON cf.order_id = so.id
        LEFT JOIN signal_summary ss ON ss.order_id = so.id
    )
    SELECT order_reference,
           -- Même snapshot et mêmes prédicats que la liste. La fenêtre précède
           -- le LIMIT : le total décrit toute la population canonique éligible.
           COUNT(*) OVER () AS population_total,
           -- Census and stable ordering token use the same scoped SQL snapshot.
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('stage',d.current_stage,'health',d.health,'count',d.n)), '[]'::jsonb)
              FROM (SELECT current_stage,health,COUNT(*)::int AS n FROM projected GROUP BY current_stage,health) d) AS population_distribution,
           (SELECT md5(COALESCE(string_agg(jsonb_build_array(order_reference,current_stage,health,last_fact_at)::text, ',' ORDER BY order_reference), ''))
              FROM projected) AS population_token,
           current_stage,
           local_only,
           health,
           exception_code,
           exception_summary,
           exception_owner_role,
           exception_severity,
           exception_causes,
           purchase_order_refs,
           hub_unit_refs,
           parcel_refs,
           parcels_count,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('status', t.status, 'at', t.created_at) ORDER BY t.created_at DESC), '[]'::jsonb)
              FROM (SELECT osh.status::text AS status, osh.created_at
                      FROM order_status_history osh
                      JOIN orders ho ON ho.id = osh.order_id
                     WHERE ho.reference = projected.order_reference
                     ORDER BY osh.created_at DESC
                     LIMIT 6) t) AS recent_transitions
      FROM projected
     ${drill ? 'WHERE ($5::text[] IS NULL OR current_stage = ANY($5::text[])) AND ($6::text IS NULL OR health = $6)' : ''}
     ORDER BY
       CASE health WHEN 'RED' THEN 1 WHEN 'ORANGE' THEN 2 WHEN 'UNKNOWN' THEN 3 ELSE 4 END,
       last_fact_at ASC,
       order_reference ASC
     LIMIT $3 ${drill ? 'OFFSET $7' : ''}
  `, params);

  const orders = rows.map(projectRow);
  const byStage = Object.fromEntries(STAGES.map(stage => [stage.key, []]));
  orders.forEach(order => {
    if (byStage[order.stage]) byStage[order.stage].push(order);
  });

  // La requête non paginée en offset et de limite >= 1 ne peut renvoyer
  // zéro ligne que si sa population est vide. En cas de métadonnée absente
  // ou incohérente, l'exhaustivité est indéterminée, jamais supposée.
  const rawTotal = rows.length ? rows[0].population_total : (drill ? null : 0);
  const total = rawTotal !== null && rawTotal !== undefined && String(rawTotal).trim() !== ''
    ? Number(rawTotal) : NaN;
  const exact = Number.isSafeInteger(total) && total >= orders.length
    && rows.every(row => Number(row.population_total) === total)
    && orders.every(order => Object.prototype.hasOwnProperty.call(byStage, order.stage));
  const population = Object.freeze({
    total: exact ? total : null,
    shown: orders.length,
    limit,
    complete: exact ? total === orders.length : null,
    clock: 'current_active_orders',
    simulation_scope: simulationScope || 'real_only',
  });

  // A drill never claims an empty page to be an empty population. A changed
  // or now-empty selection must be reopened from a fresh overview.
  if(drill) {
    if (!exact || !rows.length || rows.some(row=>row.population_token!==drill.token)
        || orders.some(order=>(drill.stages&&!drill.stages.includes(order.stage))||(drill.health&&order.health!==drill.health))
        || orders.length !== Math.min(limit,Math.max(0,total-(drill.page-1)*limit))) {
      throw drillError(409,'control_chain_population_changed');
    }
  }
  const census = !drill && exact ? readCensus(rows,total) : null;
  return Object.freeze({
    stages: STAGES,
    population,
    ...(census ? {population_census:census} : {}),
    ...(drill ? {drill:Object.freeze({phase:drill.phase,health:drill.health,page:drill.page,
      page_size:limit,total,token:drill.token,...(simulationScope ? {simulation_scope:simulationScope}: {})})} : {}),
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
  PHASE_STAGES,
  parseChainDrill,
  STRUCTURAL_ALERT_MIN_ORDERS,
  healthRank,
  buildStructuralAlerts,
  normalizeExceptions,
  projectRow,
  getControlChain,
  getOrderControlSnapshot,
};
