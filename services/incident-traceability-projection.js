/**
 * @komerce-arch
 * @role          canonical-purchasing-hub-incident-read-model
 * @domain        incident-management
 * @layer         service
 * @criticality   high
 * @inputs        server-resolved_order_id, server-resolved_purchase_order_id, admin_global_scope
 * @outputs       immutable_public_incident_work_items
 * @depends       db.js, services/incident-governance.js
 * @used-by       services/order-360.js, services/purchasing-order-detail.js, services/action-center-workspace.js
 * @db-read       incidents, parcels, orders, order_items, purchase_lines, purchase_orders
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_incident_lifecycle, exact_server_resolved_lineage, no_market_inference, do_not_auto_close
 * @impact-areas  purchasing, logistics, orders, incident-management, decision-signals
 * @version       2026-11
 */
'use strict';

const db = require('../db');
const { resolverDomainToOwnerRole } = require('./incident-governance');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = "('open','investigating')";

function nextAction(row) {
  if (row.resolution_class === 'PHYSICAL_PROOF') {
    return 'Hub : vérifier la marchandise et produire une preuve physique, puis revalider.';
  }
  if (row.resolution_class === 'UPSTREAM_TRUTH') {
    return row.resolver_domain === 'PURCHASING'
      ? 'Achats : vérifier la PO et sa vérité fournisseur, puis demander une revalidation au Hub.'
      : 'Corriger la donnée dans le domaine responsable, puis demander une revalidation au Hub.';
  }
  return 'Administrateur : qualifier le responsable avant toute clôture.';
}

function publicIncident(row) {
  // Stable display-only short reference; never accepted as an authority for mutations.
  const id = String(row.id || '');
  return Object.freeze({
    reference: UUID.test(id) ? 'INC-' + id.replace(/-/g, '').slice(0, 12).toUpperCase() : 'Incident',
    type: row.incident_type,
    title: row.title || row.incident_type,
    description: row.description || null,
    severity: row.severity,
    status: row.status,
    owner_role: resolverDomainToOwnerRole(row.resolver_domain),
    next_action: nextAction(row),
    created_at: row.created_at,
    due_at: row.due_at || null,
    business_blocking: isBusinessBlocker(row),
    // Only the business navigation destinations are public. Never emit an incident UUID.
    order_reference: row.order_reference || null,
    purchase_order_link: UUID.test(String(row.purchase_order_id || ''))
      ? '/admin/workspaces/purchasing?po=' + encodeURIComponent(row.purchase_order_id) : null,
    order_link: row.order_reference
      ? '/admin/orders/' + encodeURIComponent(row.order_reference) : null,
  });
}

// A high severity alone is insufficient: only a proven operational block
// with a persisted client impact or a quarantined upstream reconciliation goes to À traiter.
const RECONCILIATION_BLOCKERS = Object.freeze([
  'hub_purchase_identity_conflict', 'hub_purchase_quantity_conflict', 'hub_destination_conflict',
]);
function isBusinessBlocker(row) {
  if (!['open', 'investigating'].includes(row.status)) return false;
  const highImpact = ['blocked', 'partial_delivery'].includes(row.client_impact)
    && ['high', 'critical'].includes(row.severity);
  const physicalHold = row.incident_type === 'reconciliation_error'
    && RECONCILIATION_BLOCKERS.includes(row.subtype || row.details?.type)
    && Boolean(row.physical_unit_id || row.details?.physical_unit_id);
  return highImpact || physicalHold;
}

const FIELDS = `
  i.id, i.incident_type, i.title, i.description, i.severity, i.status,
  i.resolver_domain, i.resolution_class, i.client_impact, i.created_at, i.due_at,
  i.details->>'purchase_order_id' AS purchase_order_id,
  i.details->>'type' AS subtype,
  i.details->>'physical_unit_id' AS physical_unit_id
`;

// The source is incidents itself, not a snapshot of derived signals.
// A grouped PO may span many orders: for Order 360 a PO incident affects every
// order actually participating in that PO; no browser market ID is involved.
const ORDER_SQL = `
  SELECT ${FIELDS}, $2::text AS order_reference
    FROM incidents i
   WHERE i.order_id = $1::uuid
      OR EXISTS (SELECT 1 FROM parcels p WHERE p.id = i.parcel_id AND p.order_id = $1::uuid)
      OR EXISTS (
        SELECT 1
          FROM purchase_orders po
         WHERE po.id::text = i.details->>'purchase_order_id'
           AND (po.order_id = $1::uuid OR EXISTS (
             SELECT 1
               FROM purchase_lines pl
               JOIN order_items oi ON oi.id = pl.order_item_id
              WHERE pl.purchase_order_id = po.id AND oi.order_id = $1::uuid
           ))
      )
   ORDER BY i.created_at DESC, i.id DESC
   LIMIT 60
`;

// A PO is related only by an explicit recorded physical or supplier PO link;
// an incident on some other PO of the same customer must never leak onto it.
const PO_SQL = `
  SELECT ${FIELDS}, NULL::text AS order_reference
    FROM incidents i
   WHERE i.details->>'purchase_order_id' = $1::text
   ORDER BY CASE WHEN i.status IN ${OPEN} THEN 0 ELSE 1 END,
            i.created_at DESC, i.id DESC
   LIMIT 60
`;

const GLOBAL_SQL = `
  SELECT ${FIELDS},
         COALESCE(o.reference, parcel_order.reference) AS order_reference
    FROM incidents i
    LEFT JOIN orders o ON o.id = i.order_id
    LEFT JOIN parcels p ON p.id = i.parcel_id
    LEFT JOIN orders parcel_order ON parcel_order.id = p.order_id
   WHERE i.status IN ${OPEN}
     AND (
       (i.client_impact IN ('blocked','partial_delivery') AND i.severity IN ('high','critical'))
       OR (i.incident_type='reconciliation_error'
           AND i.details->>'type' IN ('hub_purchase_identity_conflict','hub_purchase_quantity_conflict','hub_destination_conflict')
           AND NULLIF(i.details->>'physical_unit_id','') IS NOT NULL)
     )
     AND (i.origin_domain IN ('LOGISTICS','PURCHASING')
       OR i.resolver_domain IN ('LOGISTICS','PURCHASING'))
   ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
            i.created_at ASC, i.id ASC
   LIMIT 40
`;

async function listForPurchaseOrder(purchaseOrderId, executor = db) {
  if (!UUID.test(String(purchaseOrderId || ''))) throw new TypeError('server_resolved_purchase_order_id_required');
  const { rows } = await executor.query(PO_SQL, [purchaseOrderId]);
  return Object.freeze(rows.map(publicIncident));
}

async function listForOrder(order, executor = db) {
  if (!UUID.test(String(order?.id || '')) || !order.reference) {
    throw new TypeError('server_resolved_order_required');
  }
  const { rows } = await executor.query(ORDER_SQL, [order.id, order.reference]);
  return Object.freeze(rows.map(publicIncident));
}

// Only global-admin Action Center calls this. Market-scoped queues remain
// isolated until a separate scoped, multi-market-safe authorization contract.
async function listGlobalOpen(executor = db) {
  const { rows } = await executor.query(GLOBAL_SQL);
  return Object.freeze(rows.map(publicIncident));
}

module.exports = { nextAction, publicIncident, listForPurchaseOrder, listForOrder, listGlobalOpen,
  ORDER_SQL, PO_SQL, GLOBAL_SQL, isBusinessBlocker };
