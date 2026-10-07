/**
 * @komerce-arch
 * @role          canonical-reference-resolver
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        arbitrary_operational_reference
 * @outputs       canonical_identity_matches_with_order_lineage_and_current_position
 * @depends       db, services/logistics-control-chain-projection
 * @used-by       routes/admin-dashboard-market.js
 * @db-read       orders, markets, purchase_orders, purchase_lines, order_items, hub_purchase_allocations, hub_physical_unit_placements, hub_physical_units, parcels, customs_shipment_parcels, customs_shipments
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, entity_identity_resolution_only, canonical_owner_navigation
 * @impact-areas  admin-dashboard, orders, purchasing, logistics, customs
 * @version       2026-10
 */

'use strict';

const db = require('../db');
const controlChain = require('./logistics-control-chain-projection');

const MAX_REFERENCE_LENGTH = 200;

class CanonicalReferenceResolverError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CanonicalReferenceResolverError';
    this.code = code;
    this.status = status;
  }
}

function normalizeReference(value) {
  const reference = String(value || '').trim();
  if (!reference) {
    throw new CanonicalReferenceResolverError(
      'reference_required',
      'Référence requise',
      400
    );
  }
  if (reference.length > MAX_REFERENCE_LENGTH) {
    throw new CanonicalReferenceResolverError(
      'reference_too_long',
      'Référence trop longue',
      400
    );
  }
  return reference;
}

function canonicalDestination(match, options = {}) {
  const role = options.role || null;
  const orderHref = '/admin/orders/' + encodeURIComponent(match.order_reference);
  if (match.entity_type === 'ORDER') {
    return Object.freeze({
      owner: 'orders',
      href: orderHref,
      fallback_href: orderHref,
    });
  }
  if (['PURCHASE_ORDER', 'SUPPLIER_ORDER', 'SUPPLIER_UNIT'].includes(match.entity_type)) {
    return Object.freeze({
      owner: 'purchasing',
      href: role === 'admin'
        ? '/admin/workspaces/purchasing?po=' + encodeURIComponent(match.canonical_id)
        : orderHref,
      fallback_href: orderHref,
    });
  }
  if (match.entity_type === 'HUB_UNIT') {
    return Object.freeze({
      owner: 'logistics',
      href: '/admin/workspaces/operations',
      fallback_href: orderHref,
    });
  }
  if (match.entity_type === 'CUSTOMS_SHIPMENT') {
    return Object.freeze({
      owner: 'customs',
      href: options.global === true ? '/admin/workspaces/shipping-customs' : orderHref,
      fallback_href: orderHref,
    });
  }
  if (match.entity_type === 'PARCEL') {
    return Object.freeze({
      owner: 'logistics',
      href: options.global === true ? '/admin/workspaces/shipping-customs' : orderHref,
      fallback_href: orderHref,
    });
  }
  return Object.freeze({
    owner: 'orders',
    href: orderHref,
    fallback_href: orderHref,
  });
}

async function queryMatches(reference) {
  const { rows } = await db.query(
    `
    WITH po_orders AS (
      SELECT po.id AS purchase_order_id,
             COALESCE(oi.order_id, po.order_id) AS order_id
        FROM purchase_orders po
        LEFT JOIN purchase_lines pl
          ON pl.purchase_order_id = po.id
         AND pl.cancelled_at IS NULL
        LEFT JOIN order_items oi ON oi.id = pl.order_item_id
       WHERE po.id::text = $1
          OR lower(COALESCE(po.supplier_order_id, '')) = lower($1)
          OR lower(COALESCE(po.supplier_unit_ref, '')) = lower($1)
    ),
    raw_matches AS (
      SELECT 'ORDER'::text AS entity_type,
             o.reference::text AS matched_reference,
             o.reference::text AS canonical_id,
             o.id AS order_id,
             o.reference AS order_reference,
             o.market_id,
             m.code AS market_code
        FROM orders o
        LEFT JOIN markets m ON m.id = o.market_id
       WHERE lower(o.reference) = lower($1)

      UNION ALL

      SELECT CASE
               WHEN po.id::text = $1 THEN 'PURCHASE_ORDER'
               WHEN lower(COALESCE(po.supplier_order_id, '')) = lower($1) THEN 'SUPPLIER_ORDER'
               ELSE 'SUPPLIER_UNIT'
             END,
             CASE
               WHEN po.id::text = $1 THEN po.id::text
               WHEN lower(COALESCE(po.supplier_order_id, '')) = lower($1) THEN po.supplier_order_id
               ELSE po.supplier_unit_ref
             END,
             po.id::text,
             o.id,
             o.reference,
             o.market_id,
             m.code
        FROM purchase_orders po
        JOIN po_orders por ON por.purchase_order_id = po.id
        JOIN orders o ON o.id = por.order_id
        LEFT JOIN markets m ON m.id = o.market_id
       WHERE por.order_id IS NOT NULL

      UNION ALL

      SELECT 'HUB_UNIT',
             hpu.reference,
             hpu.id::text,
             o.id,
             o.reference,
             o.market_id,
             m.code
        FROM hub_physical_units hpu
        JOIN hub_physical_unit_placements hp
          ON hp.physical_unit_id = hpu.id
         AND hp.removed_at IS NULL
        JOIN hub_purchase_allocations hpa ON hpa.id = hp.allocation_id
        JOIN orders o ON o.id = hpa.order_id
        LEFT JOIN markets m ON m.id = o.market_id
       WHERE lower(hpu.reference) = lower($1)

      UNION ALL

      SELECT 'PARCEL',
             p.reference,
             p.id::text,
             o.id,
             o.reference,
             o.market_id,
             m.code
        FROM parcels p
        JOIN orders o ON o.id = p.order_id
        LEFT JOIN markets m ON m.id = o.market_id
       WHERE lower(p.reference) = lower($1)

      UNION ALL

      SELECT 'CUSTOMS_SHIPMENT',
             cs.reference,
             cs.id::text,
             o.id,
             o.reference,
             o.market_id,
             m.code
        FROM customs_shipments cs
        JOIN customs_shipment_parcels csp ON csp.shipment_id = cs.id
        JOIN parcels p ON p.id = csp.parcel_id
        JOIN orders o ON o.id = p.order_id
        LEFT JOIN markets m ON m.id = o.market_id
       WHERE lower(cs.reference) = lower($1)
         AND cs.is_active = TRUE
    )
    SELECT DISTINCT ON (entity_type, canonical_id, order_id)
           entity_type,
           matched_reference,
           canonical_id,
           order_id,
           order_reference,
           market_id,
           market_code
      FROM raw_matches
     WHERE order_id IS NOT NULL
     ORDER BY entity_type, canonical_id, order_id
    `,
    [reference]
  );
  return rows;
}

function canonicalOwnerForEntity(entityType) {
  if (['PURCHASE_ORDER', 'SUPPLIER_ORDER', 'SUPPLIER_UNIT'].includes(entityType)) return 'purchasing';
  if (entityType === 'CUSTOMS_SHIPMENT') return 'customs';
  if (['HUB_UNIT', 'PARCEL'].includes(entityType)) return 'logistics';
  return 'orders';
}

async function queryOrphans(reference) {
  const { rows } = await db.query(
    `
    WITH orphan_candidates AS (
      SELECT CASE
               WHEN po.id::text = $1 THEN 'PURCHASE_ORDER'
               WHEN lower(COALESCE(po.supplier_order_id, '')) = lower($1) THEN 'SUPPLIER_ORDER'
               ELSE 'SUPPLIER_UNIT'
             END::text AS entity_type,
             CASE
               WHEN po.id::text = $1 THEN po.id::text
               WHEN lower(COALESCE(po.supplier_order_id, '')) = lower($1) THEN po.supplier_order_id
               ELSE po.supplier_unit_ref
             END::text AS matched_reference,
             po.id::text AS canonical_id
        FROM purchase_orders po
       WHERE (
              po.id::text = $1
           OR lower(COALESCE(po.supplier_order_id, '')) = lower($1)
           OR lower(COALESCE(po.supplier_unit_ref, '')) = lower($1)
       )
         AND NOT (
           (po.order_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM orders direct_order WHERE direct_order.id = po.order_id
           ))
           OR EXISTS (
             SELECT 1
               FROM purchase_lines pl
               JOIN order_items oi ON oi.id = pl.order_item_id
               JOIN orders linked_order ON linked_order.id = oi.order_id
              WHERE pl.purchase_order_id = po.id
                AND pl.cancelled_at IS NULL
           )
         )

      UNION ALL

      SELECT 'HUB_UNIT', hpu.reference, hpu.id::text
        FROM hub_physical_units hpu
       WHERE lower(hpu.reference) = lower($1)
         AND NOT EXISTS (
           SELECT 1
             FROM hub_physical_unit_placements hp
             JOIN hub_purchase_allocations hpa ON hpa.id = hp.allocation_id
             JOIN orders o ON o.id = hpa.order_id
            WHERE hp.physical_unit_id = hpu.id
              AND hp.removed_at IS NULL
         )

      UNION ALL

      SELECT 'PARCEL', p.reference, p.id::text
        FROM parcels p
       WHERE lower(p.reference) = lower($1)
         AND NOT EXISTS (
           SELECT 1 FROM orders o WHERE o.id = p.order_id
         )

      UNION ALL

      SELECT 'CUSTOMS_SHIPMENT', cs.reference, cs.id::text
        FROM customs_shipments cs
       WHERE lower(cs.reference) = lower($1)
         AND cs.is_active = TRUE
         AND NOT EXISTS (
           SELECT 1
             FROM customs_shipment_parcels csp
             JOIN parcels p ON p.id = csp.parcel_id
             JOIN orders o ON o.id = p.order_id
            WHERE csp.shipment_id = cs.id
         )
    )
    SELECT DISTINCT entity_type, matched_reference, canonical_id
      FROM orphan_candidates
     ORDER BY entity_type, canonical_id
    `,
    [reference]
  );
  return rows;
}

async function resolveReference(value, options = {}) {
  const reference = normalizeReference(value);
  const rows = await queryMatches(reference);
  const visibleRows = options.global === true
    ? rows
    : rows.filter(row => options.authorizedMarketIds instanceof Set
      && options.authorizedMarketIds.has(row.market_id));
  if (!visibleRows.length) {
    if (options.global === true) {
      const orphanRows = await queryOrphans(reference);
      if (orphanRows.length) {
        const orphans = orphanRows.map(row => Object.freeze({
          entity_type: row.entity_type,
          matched_reference: row.matched_reference,
          canonical_id: row.canonical_id,
          canonical_owner: canonicalOwnerForEntity(row.entity_type),
          reason: 'missing_customer_order_lineage',
        }));
        return Object.freeze({
          query: reference,
          found: true,
          orphaned: true,
          ambiguous: orphans.length > 1,
          matches: Object.freeze([]),
          orphans: Object.freeze(orphans),
        });
      }
    }
    return Object.freeze({
      query: reference,
      found: false,
      matches: Object.freeze([]),
    });
  }

  const snapshotByOrder = new Map();
  await Promise.all(visibleRows.map(async row => {
    const key = String(row.order_id);
    if (snapshotByOrder.has(key)) return;
    const snapshot = await controlChain.getOrderControlSnapshot({
      id: row.order_id,
      reference: row.order_reference,
      market_id: row.market_id,
    });
    snapshotByOrder.set(key, snapshot);
  }));

  const matches = visibleRows.map(row => {
    const destination = canonicalDestination(row, options);
    const position = snapshotByOrder.get(String(row.order_id)) || null;
    return Object.freeze({
      entity_type: row.entity_type,
      matched_reference: row.matched_reference,
      canonical_id: row.canonical_id,
      canonical_owner: destination.owner,
      customer_order_reference: row.order_reference,
      market_code: row.market_code || null,
      current_position: position ? Object.freeze({
        stage: position.stage,
        health: position.health,
        cause: position.exception || null,
        envelope: position.envelope,
        split: position.split === true,
        lineage: position.lineage,
      }) : null,
      canonical_href: destination.href,
      fallback_href: destination.fallback_href,
    });
  });

  return Object.freeze({
    query: reference,
    found: true,
    ambiguous: matches.length > 1,
    matches: Object.freeze(matches),
  });
}

module.exports = {
  MAX_REFERENCE_LENGTH,
  CanonicalReferenceResolverError,
  normalizeReference,
  canonicalDestination,
  canonicalOwnerForEntity,
  queryMatches,
  queryOrphans,
  resolveReference,
};
