/**
 * @komerce-arch
 * @role          canonical-action-center-workspace-service
 * @domain        decision-signals
 * @layer         service
 * @criticality   high
 * @inputs        signal_ref, signal_filters, authenticated_actor, server_resolved_market
 * @outputs       canonical_action_center_projection, signal_lifecycle_results
 * @depends       db.js, services/signal-admin-service.js, services/signal-service.js
 * @used-by       routes/admin-action-center.js
 * @db-read       orders, products, parcels, cash_collections
 * @db-write      none
 * @db-txn        none
 * @doctrine      action_center_manages_derived_signals_only, browser_business_refs_only, exact_market_scope_or_global_null
 * @impact-areas  decision-signals, admin-dashboard, orders, catalog, logistics, market-authorization
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const signalAdminService = require('./signal-admin-service');
const signalService = require('./signal-service');

const SIGNAL_REF_RE = /^KSG-\d{6,}$/;

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function requireSignalRef(signalRef) {
  const ref = String(signalRef || '').trim().toUpperCase();
  if (!SIGNAL_REF_RE.test(ref)) {
    throw httpError(400, 'Référence signal invalide', 'action_center_signal_ref_invalid');
  }
  return ref;
}

function actionSet(status) {
  if (status === 'open') return ['acknowledge', 'snooze', 'resolve'];
  if (status === 'acknowledged') return ['snooze', 'resolve'];
  if (status === 'snoozed') return ['resolve'];
  return [];
}

function countMap(rows, key) {
  return Object.fromEntries((rows || []).map(row => [row[key], Number(row.count) || 0]));
}

function requireMarket(market) {
  if (!market || !market.id || !market.code) {
    throw httpError(500, 'Contexte marché serveur manquant', 'action_center_market_context_missing');
  }
  return market;
}

async function resolveEntityBusinessRefs(signals, marketId = null) {
  const idsByType = new Map();
  for (const signal of signals) {
    if (!signal.entity_type || !signal.entity_id) continue;
    if (!idsByType.has(signal.entity_type)) idsByType.set(signal.entity_type, new Set());
    idsByType.get(signal.entity_type).add(String(signal.entity_id));
  }

  const maps = {
    order: new Map(),
    product: new Map(),
    parcel: new Map(),
    cash_collection: new Map(),
  };

  const orderIds = [...(idsByType.get('order') || [])];
  const productIds = [...(idsByType.get('product') || [])];
  const parcelIds = [...(idsByType.get('parcel') || [])];
  const cashIds = [...(idsByType.get('cash_collection') || [])];
  const queries = [];

  if (orderIds.length) {
    queries.push(db.query(
      `SELECT id::text AS internal_id, reference
         FROM orders
        WHERE id::text = ANY($1::text[])
          AND ($2::uuid IS NULL OR market_id = $2::uuid)`,
      [orderIds, marketId]
    ).then(({ rows }) => rows.forEach(row => maps.order.set(row.internal_id, {
      type: 'order', ref: row.reference, label: row.reference,
      href: row.reference ? `/admin/orders/${encodeURIComponent(row.reference)}` : null,
    }))));
  }

  if (productIds.length) {
    queries.push(db.query(
      `SELECT id::text AS internal_id, product_ref, name
         FROM products
        WHERE id::text = ANY($1::text[])`,
      [productIds]
    ).then(({ rows }) => rows.forEach(row => maps.product.set(row.internal_id, {
      type: 'product', ref: row.product_ref, label: row.name || row.product_ref,
      href: row.product_ref ? `/admin/products/${encodeURIComponent(row.product_ref)}` : null,
    }))));
  }

  if (parcelIds.length) {
    queries.push(db.query(
      `SELECT p.id::text AS internal_id, p.reference AS tracking_number, o.reference AS order_reference
         FROM parcels p
         LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.id::text = ANY($1::text[])
          AND ($2::uuid IS NULL OR o.market_id = $2::uuid)`,
      [parcelIds, marketId]
    ).then(({ rows }) => rows.forEach(row => maps.parcel.set(row.internal_id, {
      type: 'parcel', ref: row.tracking_number || null,
      label: row.tracking_number || 'Colis', parent_order_ref: row.order_reference || null,
      href: row.order_reference ? `/admin/orders/${encodeURIComponent(row.order_reference)}` : null,
    }))));
  }

  if (cashIds.length) {
    queries.push(db.query(
      `SELECT cc.id::text AS internal_id, o.reference AS order_reference
         FROM cash_collections cc
         LEFT JOIN orders o ON o.id = cc.order_id
        WHERE cc.id::text = ANY($1::text[])
          AND ($2::uuid IS NULL OR o.market_id = $2::uuid)`,
      [cashIds, marketId]
    ).then(({ rows }) => rows.forEach(row => maps.cash_collection.set(row.internal_id, {
      type: 'cash_collection', ref: row.order_reference || null,
      label: row.order_reference ? `Cash · ${row.order_reference}` : 'Encaissement cash',
      parent_order_ref: row.order_reference || null,
      href: row.order_reference ? `/admin/orders/${encodeURIComponent(row.order_reference)}` : null,
    }))));
  }

  await Promise.all(queries);
  return maps;
}

function publicSignal(signal, entityMaps) {
  const entityMap = entityMaps[signal.entity_type];
  const entity = signal.entity_id && entityMap
    ? entityMap.get(String(signal.entity_id)) || { type: signal.entity_type, ref: null, label: signal.entity_type, href: null }
    : (signal.entity_type ? { type: signal.entity_type, ref: null, label: signal.entity_type, href: null } : null);

  return {
    signal_ref: signal.signal_ref,
    family: signalAdminService.familyForType(signal.signal_type),
    signal_type: signal.signal_type,
    severity: signal.severity,
    title: signal.title,
    summary: signal.summary || null,
    recommendation: signal.recommendation || null,
    confidence: signal.confidence || null,
    owner_role: signal.owner_role || null,
    status: signal.status,
    source_module: signal.source_module || null,
    created_at: signal.created_at,
    updated_at: signal.updated_at,
    expires_at: signal.expires_at || null,
    actions: actionSet(signal.status),
    entity,
  };
}

function summaryFromStats(stats) {
  const bySeverity = countMap(stats.bySeverity, 'severity');
  const byFamily = countMap(stats.byFamily, 'family');
  return {
    total_active: stats.total,
    urgent: (bySeverity.urgent || 0) + (bySeverity.critical || 0),
    warning: bySeverity.warning || 0,
    info: bySeverity.info || 0,
    ops: byFamily.ops || 0,
    economic: byFamily.eco || 0,
    sourcing: byFamily.sourcing || 0,
    disputes: byFamily.disputes || 0,
  };
}

async function buildScopedWorkspace({ market = null, filters = {} } = {}) {
  const marketId = market ? requireMarket(market).id : null;
  await signalAdminService.reactivateExpiredSnoozes(marketId);
  const scopedFilters = {
    severity: filters.severity,
    signal_type: filters.signal_type,
    owner_role: filters.owner_role,
    family: filters.family,
    limit: filters.limit || 100,
    offset: filters.offset || 0,
    market_id: marketId,
  };
  const [list, stats] = await Promise.all([
    signalAdminService.listSignals(scopedFilters),
    signalAdminService.getStats({ market_id: marketId }),
  ]);
  const entityMaps = await resolveEntityBusinessRefs(list.signals, marketId);

  return {
    scope: market ? {
      mode: 'market_decision_signals',
      label: `Centre d’actions · ${market.name || market.code}`,
      market_dimension: 'canonical',
      market: {
        code: market.code,
        name: market.name || market.code,
        currency: market.currency || null,
      },
      market_note: 'Seuls les signaux rattachés à ce Market ID canonique sont visibles et actionnables.',
    } : {
      mode: 'global_decision_signals',
      label: 'Centre d’actions central Komerce',
      market_dimension: 'canonical',
      market: null,
      market_note: 'Vue centrale limitée aux signaux globaux ; les signaux pays restent isolés dans leur Market ID.',
    },
    summary: summaryFromStats(stats),
    signals: list.signals.map(signal => publicSignal(signal, entityMaps)),
    pagination: { total: list.total, limit: list.limit, offset: list.offset },
  };
}

async function buildWorkspace(filters = {}) {
  return buildScopedWorkspace({ filters });
}

async function buildMarketWorkspace(market, filters = {}) {
  return buildScopedWorkspace({ market: requireMarket(market), filters });
}

async function generateSignals(types) {
  if (types != null && !Array.isArray(types)) {
    throw httpError(400, 'types doit être un tableau', 'action_center_generate_types_invalid');
  }
  return signalService.generateSignals(types || null);
}

async function acknowledge(signalRef, marketId = null) {
  const ref = requireSignalRef(signalRef);
  const result = await signalAdminService.acknowledgeByRef(ref, marketId);
  if (!result) throw httpError(404, 'Signal introuvable ou déjà acquitté', 'action_center_signal_not_open');
  return { signal_ref: result.signal_ref, status: result.status };
}

async function snooze(signalRef, hours, marketId = null) {
  const ref = requireSignalRef(signalRef);
  const result = await signalAdminService.snoozeByRef(ref, hours, marketId);
  if (!result) throw httpError(404, 'Signal introuvable ou non actif', 'action_center_signal_not_active');
  return { signal_ref: result.signal_ref, status: result.status, snoozed_until: result.snoozed_until };
}

async function resolve(signalRef, user, marketId = null) {
  const ref = requireSignalRef(signalRef);
  const result = await signalAdminService.resolveByRef(ref, user && user.id, marketId);
  if (!result) throw httpError(404, 'Signal introuvable ou non actif', 'action_center_signal_not_active');
  return { signal_ref: result.signal_ref, status: result.status, resolved_at: result.resolved_at };
}

module.exports = {
  buildWorkspace,
  buildMarketWorkspace,
  buildScopedWorkspace,
  generateSignals,
  acknowledge,
  snooze,
  resolve,
  publicSignal,
  actionSet,
  requireSignalRef,
};
