/**
 * @komerce-arch
 * @role          canonical-shipping-customs-workspace-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, authenticated_actor, parcel_or_shipment_reference
 * @outputs       market_scoped_shipping_customs_queue, delegated_domain_mutations
 * @depends       db, services/scan-engine.js, services/customs-shipment-service.js
 * @used-by       routes/admin-shipping-customs-workspace.js
 * @db-read       orders, parcels, parcel_items, users, relais, scan_events, customs_shipments, customs_shipment_parcels
 * @db-write      customs_shipments
 * @db-write-via:scan-engine parcels, scan_events, incidents, orders
 * @db-write-via:customs-shipment-service customs_shipments, customs_shipment_parcels, orders, parcels, order_item_real_cost_allocations
 * @db-txn        delegated_to_domain_authority
 * @doctrine      workspace_acts_dashboard_observes, server_market_scope_is_authority, no_global_workspace_mutation, reuse_domain_mutation_authorities
 * @impact-areas  admin-dashboard, logistics, customs, market-authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const scanEngine = require('./scan-engine');
const customs = require('./customs-shipment-service');

const CUSTOMS_PARCEL_STATUSES = Object.freeze(['shipped', 'in_transit']);

class ShippingCustomsWorkspaceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ShippingCustomsWorkspaceError';
    this.code = code;
    this.status = status;
  }
}

function requireMarket(market) {
  if (!market || !market.id || !market.code) {
    throw new ShippingCustomsWorkspaceError(
      'workspace_market_required',
      'Le Workspace Expéditions & Douane exige un marché serveur explicite',
      400
    );
  }
  return market;
}

function publicMarket(market) {
  const resolved = requireMarket(market);
  return Object.freeze({
    code: resolved.code,
    name: resolved.name || resolved.code,
    currency: resolved.currency || null,
  });
}

async function queryTransit(marketId) {
  const { rows } = await db.query(
    `SELECT p.reference, p.status, p.weight_kg, p.shipped_at, p.updated_at,
            o.reference AS order_ref, o.destination_island,
            u.full_name AS client_name,
            r.name AS relais_name,
            COALESCE((SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id = p.id), 0) AS item_count
       FROM parcels p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN relais r ON r.id = COALESCE(p.relais_id, o.relais_id)
      WHERE o.market_id = $1
        AND (r.id IS NULL OR r.market_id = $1)
        AND p.status IN ('shipped', 'in_transit')
      ORDER BY CASE p.status WHEN 'shipped' THEN 0 ELSE 1 END,
               p.shipped_at ASC NULLS LAST,
               p.created_at ASC`,
    [marketId]
  );
  return {
    ready: rows.filter(row => row.status === 'shipped'),
    in_transit: rows.filter(row => row.status === 'in_transit'),
  };
}

async function queryTransitHistory(marketId) {
  const { rows } = await db.query(
    `SELECT se.event_type, se.created_at, se.actor_name, se.notes,
            p.reference AS parcel_ref,
            o.reference AS order_ref
       FROM scan_events se
       JOIN parcels p ON p.id = se.parcel_id
       JOIN orders o ON o.id = p.order_id
      WHERE o.market_id = $1
        AND se.event_type = 'transit_confirmed'
        AND se.status = 'applied'
      ORDER BY se.created_at DESC
      LIMIT 50`,
    [marketId]
  );
  return rows;
}

async function queryCustoms(marketId) {
  const { rows } = await db.query(
    `SELECT cs.reference, cs.shipment_date, cs.transitaire_name, cs.transport_mode,
            cs.cif_value_kmf, cs.customs_paid_kmf, cs.freight_kmf,
            cs.total_weight_kg, cs.nb_parcels, cs.allocation_method,
            cs.status, cs.is_active, cs.declared_at, cs.created_at,
            COUNT(csp.parcel_id)::int AS linked_parcels
       FROM customs_shipments cs
       LEFT JOIN customs_shipment_parcels csp ON csp.shipment_id = cs.id
      WHERE cs.market_id = $1
      GROUP BY cs.id
      ORDER BY cs.shipment_date DESC, cs.created_at DESC`,
    [marketId]
  );
  return rows;
}

async function queryCustomsCandidates(marketId) {
  const { rows } = await db.query(
    `SELECT p.reference, p.status, p.weight_kg,
            o.reference AS order_ref, o.destination_island,
            r.name AS relais_name
       FROM parcels p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN relais r ON r.id = COALESCE(p.relais_id, o.relais_id)
      WHERE o.market_id = $1
        AND (r.id IS NULL OR r.market_id = $1)
        AND p.status IN ('in_transit', 'shipped')
        AND NOT EXISTS (
          SELECT 1
            FROM customs_shipment_parcels csp
            JOIN customs_shipments cs ON cs.id = csp.shipment_id
           WHERE csp.parcel_id = p.id
             AND cs.is_active = TRUE
        )
      ORDER BY p.shipped_at ASC NULLS LAST, p.created_at ASC`,
    [marketId]
  );
  return rows;
}

async function buildWorkspace({ market }) {
  const resolved = requireMarket(market);
  const [transit, history, shipments, candidates] = await Promise.all([
    queryTransit(resolved.id),
    queryTransitHistory(resolved.id),
    queryCustoms(resolved.id),
    queryCustomsCandidates(resolved.id),
  ]);

  return {
    scope: publicMarket(resolved),
    summary: {
      transit_ready: transit.ready.length,
      transit_active: transit.in_transit.length,
      customs_pending: shipments.filter(row => row.status === 'pending' && row.is_active).length,
      customs_declared: shipments.filter(row => row.status === 'declared' && row.is_active).length,
      customs_candidates: candidates.length,
    },
    transit: {
      ready: transit.ready,
      in_transit: transit.in_transit,
      history,
    },
    customs: {
      shipments,
      candidates,
    },
  };
}

async function resolveParcel(reference, marketId, allowedStatuses = null) {
  const ref = String(reference || '').trim();
  if (!ref) {
    throw new ShippingCustomsWorkspaceError('parcel_reference_required', 'Référence colis requise', 400);
  }
  const params = [ref, marketId];
  let statusSql = '';
  if (Array.isArray(allowedStatuses) && allowedStatuses.length) {
    params.push(allowedStatuses);
    statusSql = ` AND p.status = ANY($${params.length}::text[])`;
  }
  const { rows } = await db.query(
    `SELECT p.id, p.reference, p.status, p.relais_id, o.id AS order_id, o.market_id,
            r.market_id AS relais_market_id
       FROM parcels p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN relais r ON r.id = COALESCE(p.relais_id, o.relais_id)
      WHERE p.reference = $1
        AND o.market_id = $2
        AND (r.id IS NULL OR r.market_id = $2)${statusSql}
      LIMIT 1`,
    params
  );
  if (!rows.length) {
    throw new ShippingCustomsWorkspaceError('parcel_not_found', 'Colis introuvable dans ce marché ou statut incompatible', 404);
  }
  return rows[0];
}

async function confirmTransit(reference, market, actor = {}, notes = null) {
  const resolved = requireMarket(market);
  const parcel = await resolveParcel(reference, resolved.id, ['shipped']);
  const result = await scanEngine.processScan({
    parcel_id: parcel.id,
    event_type: 'transit_confirmed',
    scanned_by: actor.id || null,
    actor_name: actor.full_name || actor.email || actor.role || 'Opérateur',
    actor_role: actor.role || 'system',
    location: resolved.code,
    notes: notes || 'Transit confirmé depuis le Workspace Expéditions & Douane',
    metadata: { source: 'canonical_shipping_customs_workspace', market_code: resolved.code },
  });
  if (!result || result.success !== true) {
    const scanError = result && result.error;
    throw new ShippingCustomsWorkspaceError(
      (scanError && scanError.code) || 'transit_scan_rejected',
      (scanError && scanError.message) || 'Le moteur logistique a refusé la confirmation de transit',
      409
    );
  }
  return {
    parcel_ref: parcel.reference,
    status: result.parcel && result.parcel.status,
    event_applied: true,
  };
}

async function resolveParcelRefs(parcelRefs, marketId, allowedStatuses = CUSTOMS_PARCEL_STATUSES) {
  const refs = [...new Set((Array.isArray(parcelRefs) ? parcelRefs : []).map(value => String(value || '').trim()).filter(Boolean))];
  if (!refs.length) return [];
  const statuses = Array.isArray(allowedStatuses) && allowedStatuses.length
    ? allowedStatuses
    : CUSTOMS_PARCEL_STATUSES;
  const { rows } = await db.query(
    `SELECT p.id, p.reference, p.status
       FROM parcels p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN relais r ON r.id = COALESCE(p.relais_id, o.relais_id)
      WHERE p.reference = ANY($1::text[])
        AND o.market_id = $2
        AND (r.id IS NULL OR r.market_id = $2)
        AND p.status = ANY($3::text[])`,
    [refs, marketId, statuses]
  );
  if (rows.length !== refs.length) {
    throw new ShippingCustomsWorkspaceError(
      'customs_parcel_scope_mismatch',
      'Au moins un colis douane est introuvable, hors du marché sélectionné ou hors du flux expédition/transit',
      404
    );
  }
  return rows;
}

async function resolveShipment(reference, marketId) {
  const ref = String(reference || '').trim();
  if (!ref) {
    throw new ShippingCustomsWorkspaceError('shipment_reference_required', 'Référence expédition requise', 400);
  }
  const { rows } = await db.query(
    `SELECT id, reference, status, is_active
       FROM customs_shipments
      WHERE reference = $1 AND market_id = $2
      LIMIT 1`,
    [ref, marketId]
  );
  if (!rows.length) {
    throw new ShippingCustomsWorkspaceError('customs_shipment_not_found', 'Expédition douane introuvable dans ce marché', 404);
  }
  return rows[0];
}

function sanitizeCreateBody(body, parcelIds) {
  const source = body || {};
  return {
    reference: source.reference,
    shipment_date: source.shipment_date,
    transitaire_name: source.transitaire_name,
    transport_mode: source.transport_mode,
    cif_value_kmf: source.cif_value_kmf,
    customs_paid_kmf: source.customs_paid_kmf,
    freight_kmf: source.freight_kmf,
    total_weight_kg: source.total_weight_kg,
    nb_parcels: source.nb_parcels,
    allocation_method: source.allocation_method,
    allocation_config: source.allocation_config,
    notes: source.notes,
    supplier_id: source.supplier_id,
    parcel_ids: parcelIds,
  };
}

async function createCustomsShipment(body, market, actor = {}) {
  const resolved = requireMarket(market);
  const parcels = await resolveParcelRefs(body && body.parcel_refs, resolved.id);
  let created;
  try {
    created = await customs.createShipment(
      db,
      sanitizeCreateBody(body, parcels.map(parcel => parcel.id)),
      actor.id || null
    );
    const { rows } = await db.query(
      `UPDATE customs_shipments
          SET market_id = $2
        WHERE id = $1 AND market_id IS NULL
        RETURNING reference, status, is_active, shipment_date`,
      [created.shipment.id, resolved.id]
    );
    if (!rows.length) throw new Error('customs_market_tag_failed');
    return { shipment: rows[0], allocations: created.allocations || [] };
  } catch (err) {
    if (created && created.shipment && created.shipment.id) {
      await customs.deleteShipment(db, created.shipment.id).catch(() => {});
    }
    throw err;
  }
}

function sanitizeUpdateBody(body) {
  const source = body || {};
  const allowed = [
    'shipment_date', 'transitaire_name', 'transport_mode', 'cif_value_kmf',
    'customs_paid_kmf', 'freight_kmf', 'total_weight_kg', 'nb_parcels',
    'allocation_method', 'allocation_config', 'notes', 'supplier_id',
  ];
  return allowed.reduce((out, key) => {
    if (source[key] !== undefined) out[key] = source[key];
    return out;
  }, {});
}

async function updateCustomsShipment(reference, body, market) {
  const resolved = requireMarket(market);
  const shipment = await resolveShipment(reference, resolved.id);
  const result = await customs.updateShipment(db, shipment.id, sanitizeUpdateBody(body));
  return {
    shipment: {
      reference: result.shipment.reference,
      status: result.shipment.status,
      is_active: result.shipment.is_active,
      shipment_date: result.shipment.shipment_date,
    },
  };
}

async function declareCustomsShipment(reference, body, market, actor = {}) {
  const resolved = requireMarket(market);
  const shipment = await resolveShipment(reference, resolved.id);
  return customs.declareCustomsPayment(db, shipment.id, {
    customs_paid_kmf: body && body.customs_paid_kmf,
    freight_kmf: body && body.freight_kmf,
    notes: body && body.notes,
  }, actor.id || null);
}

async function deactivateCustomsShipment(reference, body, market) {
  const resolved = requireMarket(market);
  const shipment = await resolveShipment(reference, resolved.id);
  const result = await customs.deactivateShipment(db, shipment.id, body && body.reason);
  return { reference: shipment.reference, is_active: false, parcels_reset: result.parcels_reset || 0 };
}

async function activateCustomsShipment(reference, body, market) {
  const resolved = requireMarket(market);
  const shipment = await resolveShipment(reference, resolved.id);
  const parcels = await resolveParcelRefs(body && body.parcel_refs, resolved.id);
  const result = await customs.activateShipment(db, shipment.id, parcels.map(parcel => parcel.id));
  return { reference: shipment.reference, is_active: true, allocations: (result.allocations || []).length };
}

module.exports = {
  ShippingCustomsWorkspaceError,
  buildWorkspace,
  confirmTransit,
  createCustomsShipment,
  updateCustomsShipment,
  declareCustomsShipment,
  deactivateCustomsShipment,
  activateCustomsShipment,
  _test: {
    CUSTOMS_PARCEL_STATUSES,
    requireMarket,
    publicMarket,
    resolveParcel,
    resolveParcelRefs,
    resolveShipment,
    sanitizeCreateBody,
    sanitizeUpdateBody,
  },
};
