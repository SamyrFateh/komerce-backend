/**
 * @komerce-arch
 * @role          canonical-operations-workspace-service
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, authenticated_actor, operation_reference
 * @outputs       market_scoped_operations_work_queue, delegated_domain_mutations
 * @depends       db, services/order-status-machine.js, services/auto-parcel.js, services/scan-engine.js, services/inventory-service.js, services/parcel-auto-create-service.js
 * @used-by       routes/admin-operations-workspace.js
 * @db-read       orders, order_items, parcels, parcel_items, products, relais, users, inventory_items
 * @db-write      order_comments
 * @db-write-via:order-status-machine product_variants, order_status_history, products
 * @db-write-via:auto-parcel parcel_items, parcels
 * @db-write-via:scan-engine order_items, parcel_items, parcels, scan_events, incidents
 * @db-write-via:inventory-service inventory_items, parcel_items, orders
 * @db-write-via:parcel-auto-create-service orders, parcel_items, parcels, scan_events
 * @db-txn        delegated_to_domain_authority
 * @doctrine      workspace_acts_dashboard_observes, server_market_scope_is_authority, no_client_market_authority, reuse_domain_mutation_authorities
 * @impact-areas  admin-dashboard, logistics, inventory, orders, payments, market-authorization
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const { transitionOrderStatus } = require('./order-status-machine');
const autoParcel = require('./auto-parcel');
const scanEngine = require('./scan-engine');
const inventory = require('./inventory-service');
const { confirmCashAndCreateParcel } = require('./parcel-auto-create-service');
const { cacheCodeForReveal } = require('./pickup-secret-service');
const log = require('../utils/logger').child({ module: 'operations-workspace' });

class OperationsWorkspaceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'OperationsWorkspaceError';
    this.code = code;
    this.status = status;
  }
}

function requireMarket(market) {
  if (!market || !market.id || !market.code) {
    throw new OperationsWorkspaceError(
      'workspace_market_required',
      'Le Workspace Opérations exige un marché serveur explicite',
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

async function queryOrders(marketId) {
  const { rows } = await db.query(
    `SELECT o.reference, o.status, o.payment_mode, o.payment_status,
            o.total_kmf, o.created_at, o.updated_at,
            u.full_name AS client_name,
            r.name AS relais_name, r.island AS relais_island,
            (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.market_id = $1
        AND o.status NOT IN ('cancelled', 'refunded', 'collected')
      ORDER BY o.created_at ASC`,
    [marketId]
  );
  return rows;
}

async function queryParcels(marketId) {
  const { rows } = await db.query(
    `SELECT p.reference, p.status, p.created_at, p.updated_at, p.shipped_at,
            p.recipient_name, p.destination_island,
            o.reference AS order_ref, o.total_kmf,
            r.name AS relais_name, r.island AS relais_island,
            COALESCE((SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id = p.id), 0) AS item_count
       FROM parcels p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN relais r ON r.id = p.relais_id
      WHERE o.market_id = $1
        AND (p.relais_id IS NULL OR r.market_id = $1)
        AND p.status NOT IN ('cancelled', 'collected')
      ORDER BY p.created_at ASC`,
    [marketId]
  );
  return rows;
}

async function queryDistribution(marketId) {
  const { rows: parcels } = await db.query(
    `SELECT p.reference, p.status,
            r.name AS relais_name, r.island AS relais_island,
            COALESCE(agg.orders_count, 0)::int AS orders_count,
            COALESCE(agg.items_count, 0)::int AS items_count,
            COALESCE(agg.total_kmf, 0)::int AS total_kmf
       FROM parcels p
       JOIN orders owner_order ON owner_order.id = p.order_id
       LEFT JOIN relais r ON r.id = p.relais_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS orders_count,
                COALESCE(SUM(per_order.items_count), 0)::int AS items_count,
                COALESCE(SUM(per_order.total_kmf), 0)::int AS total_kmf
           FROM (
             SELECT linked_order.id,
                    COUNT(pi.id)::int AS items_count,
                    MAX(linked_order.total_kmf)::int AS total_kmf
               FROM parcel_items pi
               JOIN order_items oi ON oi.id = pi.order_item_id
               JOIN orders linked_order ON linked_order.id = oi.order_id
              WHERE pi.parcel_id = p.id
                AND linked_order.market_id = $1
              GROUP BY linked_order.id
           ) per_order
       ) agg ON true
      WHERE owner_order.market_id = $1
        AND (p.relais_id IS NULL OR r.market_id = $1)
        AND p.status IN ('draft', 'preparation')
      ORDER BY p.created_at ASC`,
    [marketId]
  );

  const { rows: unassigned } = await db.query(
    `SELECT o.reference, o.status, o.total_kmf, o.created_at,
            u.full_name AS client_name,
            r.name AS relais_name, r.island AS relais_island,
            (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.market_id = $1
        AND (o.relais_id IS NULL OR r.market_id = $1)
        AND o.status IN ('ordered', 'preparation')
        AND NOT EXISTS (
          SELECT 1
            FROM parcel_items pi
            JOIN order_items oi ON oi.id = pi.order_item_id
            JOIN parcels p ON p.id = pi.parcel_id AND p.status <> 'cancelled'
           WHERE oi.order_id = o.id
        )
        AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)
      ORDER BY o.created_at ASC`,
    [marketId]
  );

  return { parcels, unassigned };
}

async function queryInventory(marketId) {
  const { rows: items } = await db.query(
    `SELECT ii.id AS item_id, ii.status, ii.received_at, ii.proposed_at,
            ii.buffer_until, ii.buffer_reason,
            p.name AS product_name,
            o.reference AS order_ref,
            o.destination_island,
            proposed.reference AS proposed_parcel_ref,
            EXTRACT(EPOCH FROM (NOW() - ii.received_at)) / 60 AS wait_minutes
       FROM inventory_items ii
       JOIN orders o ON o.id = ii.order_id
       JOIN order_items oi ON oi.id = ii.order_item_id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN parcels proposed ON proposed.id = ii.proposed_parcel_id
      WHERE o.market_id = $1
        AND ii.status IN ('received', 'proposed', 'buffered')
      ORDER BY CASE ii.status WHEN 'buffered' THEN 0 WHEN 'received' THEN 1 ELSE 2 END,
               ii.received_at ASC`,
    [marketId]
  );

  const { rows: openParcels } = await db.query(
    `SELECT p.reference, p.status,
            o.destination_island,
            o.reference AS order_ref,
            COALESCE((SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id = p.id), 0) AS item_count
       FROM parcels p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN relais r ON r.id = p.relais_id
      WHERE o.market_id = $1
        AND (p.relais_id IS NULL OR r.market_id = $1)
        AND p.status IN ('draft', 'preparation')
      ORDER BY p.created_at DESC`,
    [marketId]
  );

  return { items, open_parcels: openParcels };
}

function buildQueues(orders, parcels) {
  return {
    hub: {
      to_order: orders.filter(row => row.status === 'confirmed'),
      to_ship: parcels.filter(row => row.status === 'preparation'),
    },
    relay: {
      cash_pending: orders.filter(row =>
        row.status === 'pending' &&
        ['cash_relais', 'cash_relay'].includes(row.payment_mode) &&
        row.payment_status !== 'paid'
      ),
      to_receive: parcels.filter(row => ['shipped', 'in_transit'].includes(row.status)),
      to_collect: parcels.filter(row => row.status === 'available'),
    },
  };
}

function buildSummary(queues, distribution, inventoryState) {
  return Object.freeze({
    hub_to_order: queues.hub.to_order.length,
    hub_unassigned: distribution.unassigned.length,
    hub_to_ship: queues.hub.to_ship.length,
    relay_cash_pending: queues.relay.cash_pending.length,
    relay_to_receive: queues.relay.to_receive.length,
    relay_to_collect: queues.relay.to_collect.length,
    inventory_to_assign: inventoryState.items.length,
  });
}

async function buildWorkspace(options = {}) {
  const market = requireMarket(options.market);
  const [orders, parcels, distribution, inventoryState] = await Promise.all([
    queryOrders(market.id),
    queryParcels(market.id),
    queryDistribution(market.id),
    queryInventory(market.id),
  ]);
  const queues = buildQueues(orders, parcels);

  return Object.freeze({
    scope: publicMarket(market),
    summary: buildSummary(queues, distribution, inventoryState),
    queues,
    distribution,
    inventory: inventoryState,
    data_quality: Object.freeze({
      generated_at: new Date().toISOString(),
      scope_enforced: true,
      scope_mode: 'market',
      action_context: 'single_market_only',
      source_tables: Object.freeze([
        'orders',
        'order_items',
        'parcels',
        'parcel_items',
        'inventory_items',
        'relais',
      ]),
    }),
  });
}

async function resolveOrderInMarket(reference, marketId) {
  const { rows } = await db.query(
    `SELECT o.id, o.reference, o.status, o.payment_mode, o.payment_status,
            o.total_kmf, o.relais_id, r.market_id AS relais_market_id
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.reference = $1
        AND o.market_id = $2
      LIMIT 1`,
    [reference, marketId]
  );
  if (!rows.length) {
    throw new OperationsWorkspaceError(
      'workspace_order_not_found',
      'Commande introuvable dans ce marché',
      404
    );
  }
  const order = rows[0];
  if (order.relais_id && order.relais_market_id !== marketId) {
    throw new OperationsWorkspaceError(
      'relay_market_mismatch',
      'Le relais de la commande appartient à un autre marché',
      409
    );
  }
  return order;
}

async function resolveParcelInMarket(reference, marketId) {
  const { rows } = await db.query(
    `SELECT p.id, p.reference, p.status, p.order_id, p.relais_id,
            o.market_id AS order_market_id,
            r.market_id AS relais_market_id
       FROM parcels p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN relais r ON r.id = p.relais_id
      WHERE p.reference = $1
        AND o.market_id = $2
      LIMIT 1`,
    [reference, marketId]
  );
  if (!rows.length) {
    throw new OperationsWorkspaceError(
      'workspace_parcel_not_found',
      'Colis introuvable dans ce marché',
      404
    );
  }
  const parcel = rows[0];
  if (parcel.relais_id && parcel.relais_market_id !== marketId) {
    throw new OperationsWorkspaceError(
      'relay_market_mismatch',
      'Le relais du colis appartient à un autre marché',
      409
    );
  }
  return parcel;
}

async function markOrdered(reference, market, actor = {}) {
  const resolvedMarket = requireMarket(market);
  const order = await resolveOrderInMarket(reference, resolvedMarket.id);
  if (order.status !== 'confirmed') {
    throw new OperationsWorkspaceError(
      'invalid_order_state',
      `La commande doit être confirmed avant l'envoi au sourcing (actuel: ${order.status})`,
      409
    );
  }

  const result = await transitionOrderStatus({
    orderId: order.id,
    newStatus: 'ordered',
    actor: { id: actor.id || null, role: actor.role || 'admin' },
    source: 'canonical_operations_workspace',
    note: `Workspace Opérations ${resolvedMarket.code}: commande envoyée au sourcing`,
  });
  if (!result.success) {
    throw new OperationsWorkspaceError(
      'order_transition_rejected',
      result.error || 'Transition de commande refusée',
      409
    );
  }

  try {
    await db.query(
      `INSERT INTO order_comments (order_id, author_id, author_name, text)
       VALUES ($1, $2, $3, $4)`,
      [
        order.id,
        actor.id || null,
        actor.full_name || 'Workspace Opérations',
        `🛒 Commandé au sourcing · marché ${resolvedMarket.code}`,
      ]
    );
  } catch (err) {
    log.warn({ err, reference: order.reference }, '[operations-workspace] order comment skipped');
  }

  return Object.freeze({ reference: order.reference, status: 'ordered' });
}

async function runDistribution(market) {
  const resolvedMarket = requireMarket(market);
  const { rows } = await db.query(
    `SELECT o.id, o.reference, o.relais_id, r.market_id AS relais_market_id
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.market_id = $1
        AND o.status IN ('ordered', 'preparation')
        AND NOT EXISTS (
          SELECT 1
            FROM parcel_items pi
            JOIN order_items oi ON oi.id = pi.order_item_id
            JOIN parcels p ON p.id = pi.parcel_id AND p.status <> 'cancelled'
           WHERE oi.order_id = o.id
        )
        AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)
      ORDER BY o.created_at ASC`,
    [resolvedMarket.id]
  );

  const inconsistent = rows.find(row => row.relais_id && row.relais_market_id !== resolvedMarket.id);
  if (inconsistent) {
    throw new OperationsWorkspaceError(
      'relay_market_mismatch',
      `Répartition bloquée : ${inconsistent.reference} pointe vers un relais hors marché`,
      409
    );
  }

  const details = [];
  for (const row of rows) {
    try {
      const result = await autoParcel.distributeOrder(row.id);
      details.push({
        order_ref: row.reference,
        success: Boolean(result && result.success),
        queued: Boolean(result && result.queued),
        already_assigned: Boolean(result && result.already_assigned),
        parcel_ref: result && result.parcel_ref ? result.parcel_ref : null,
        error: result && result.error ? result.error : null,
      });
    } catch (err) {
      details.push({
        order_ref: row.reference,
        success: false,
        queued: false,
        already_assigned: false,
        parcel_ref: null,
        error: err.message,
      });
    }
  }

  return Object.freeze({
    market: resolvedMarket.code,
    attempted: rows.length,
    distributed: details.filter(row => row.success && !row.queued && !row.already_assigned).length,
    queued: details.filter(row => row.queued).length,
    already_assigned: details.filter(row => row.already_assigned).length,
    errors: details.filter(row => !row.success).length,
    details: Object.freeze(details),
  });
}

const SCAN_ACTIONS = Object.freeze({
  ship: Object.freeze({ event_type: 'shipped', notes: 'Expédié depuis le Hub · Workspace Opérations' }),
  receive: Object.freeze({ event_type: 'relais_received', notes: 'Réceptionné au relais · Workspace Opérations' }),
  collect: Object.freeze({ event_type: 'customer_collected', notes: 'Remis au client · Workspace Opérations' }),
});

async function scanParcel(reference, action, market, actor = {}) {
  const resolvedMarket = requireMarket(market);
  const scan = SCAN_ACTIONS[action];
  if (!scan) {
    throw new OperationsWorkspaceError('invalid_scan_action', 'Action colis inconnue', 400);
  }
  const parcel = await resolveParcelInMarket(reference, resolvedMarket.id);
  const result = await scanEngine.processScan({
    parcel_id: parcel.id,
    event_type: scan.event_type,
    scanned_by: actor.id || null,
    actor_name: actor.full_name || 'Workspace Opérations',
    actor_role: actor.role || 'admin',
    location: resolvedMarket.code,
    notes: scan.notes,
    metadata: {
      source: 'canonical_operations_workspace',
      market_code: resolvedMarket.code,
    },
  });
  if (!result.success) {
    const error = result.error || {};
    throw new OperationsWorkspaceError(
      error.code || 'scan_rejected',
      error.message || 'Scan refusé par le moteur logistique',
      409
    );
  }
  return Object.freeze({
    reference: parcel.reference,
    action,
    status: result.parcel && result.parcel.status ? result.parcel.status : null,
    catchup_events: Array.isArray(result.catchup_events) ? result.catchup_events.length : 0,
    incidents: Array.isArray(result.incidents) ? result.incidents.length : 0,
  });
}

async function confirmCash(reference, market, actor = {}) {
  const resolvedMarket = requireMarket(market);
  const order = await resolveOrderInMarket(reference, resolvedMarket.id);
  const operationActor = {
    id: actor.id || null,
    role: actor.role || 'admin',
    full_name: actor.full_name || 'Workspace Opérations',
    email: actor.email || null,
  };

  const { order: confirmed, parcelResult, pickupCodeToCache } =
    await confirmCashAndCreateParcel(order.reference, operationActor);

  if (pickupCodeToCache) {
    cacheCodeForReveal(confirmed.id, pickupCodeToCache)
      .catch(err => log.error({ err, reference }, '[operations-workspace] pickup cache failed'));
  }

  const notifications = require('./notification-service');
  notifications.notifyPaymentConfirmed(confirmed.id, confirmed.reference)
    .catch(err => log.error({ err, reference }, '[operations-workspace] payment notification failed'));
  require('./invoice-service').issueInvoice(confirmed.id)
    .catch(err => log.error({ err, reference }, '[operations-workspace] invoice generation failed'));

  if (parcelResult && parcelResult.success && parcelResult.parcel) {
    notifications.notifyParcelCreated(parcelResult.parcel.reference, confirmed.id, confirmed.reference)
      .catch(err => log.error({ err, reference }, '[operations-workspace] parcel notification failed'));
  }

  return Object.freeze({
    reference: confirmed.reference,
    payment_status: 'paid',
    order_status: parcelResult && parcelResult.success ? 'preparation' : 'confirmed',
    parcel_ref: parcelResult && parcelResult.success && parcelResult.parcel
      ? parcelResult.parcel.reference
      : null,
  });
}

async function assignInventory(itemId, parcelReference, market) {
  const resolvedMarket = requireMarket(market);
  if (!itemId || !parcelReference) {
    throw new OperationsWorkspaceError(
      'inventory_assignment_invalid',
      'Article inventaire et colis requis',
      400
    );
  }

  const { rows } = await db.query(
    `SELECT ii.id, ii.status, ii.order_id, o.market_id
       FROM inventory_items ii
       JOIN orders o ON o.id = ii.order_id
      WHERE ii.id = $1
        AND o.market_id = $2
      LIMIT 1`,
    [itemId, resolvedMarket.id]
  );
  if (!rows.length) {
    throw new OperationsWorkspaceError(
      'workspace_inventory_item_not_found',
      'Article inventaire introuvable dans ce marché',
      404
    );
  }

  const parcel = await resolveParcelInMarket(parcelReference, resolvedMarket.id);
  if (!['draft', 'preparation'].includes(parcel.status)) {
    throw new OperationsWorkspaceError(
      'inventory_parcel_not_open',
      `Le colis ${parcel.reference} n'est plus ouvert à l'affectation inventaire`,
      409
    );
  }
  const result = await inventory.scanIntoParcel(rows[0].id, parcel.id);
  return Object.freeze({
    item_id: rows[0].id,
    parcel_ref: parcel.reference,
    assigned: Boolean(result && result.assigned),
    matched_proposal: Boolean(result && result.matched_proposal),
  });
}

module.exports = {
  OperationsWorkspaceError,
  publicMarket,
  buildQueues,
  buildSummary,
  buildWorkspace,
  resolveOrderInMarket,
  resolveParcelInMarket,
  markOrdered,
  runDistribution,
  scanParcel,
  confirmCash,
  assignInventory,
  SCAN_ACTIONS,
};
