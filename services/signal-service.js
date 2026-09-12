/**
 * @komerce-arch
 * @role          signal-service
 * @domain        decision-signals
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload, optional_server_resolved_market_id
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js
 * @used-by       routes/signals.js, bootstrap/feature-wiring.js, services/action-center-workspace.js
 * @db-read       cash_collections, orders, parcels, purchase_orders
 * @db-write      signals
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change, market_scope_is_server_authority
 * @impact-areas  decision-signals, purchasing, orders, logistics, market-authorization
 * @version       2026-09
 */

'use strict';

/**
 * Signal Service — Komerce
 * Generates, deduplicates, and manages platform signals.
 * Signals are the common language between CT and BO.
 *
 * `market_id = NULL` is an explicit GLOBAL fact. A non-null market_id is an
 * exact canonical market fact and is never inferred here from browser data.
 */

let db = require('../db');
let log = require('../utils/logger').child({ module: 'signal-service' });

/* ═══════════════════════════════════════════════════════════════
   UPSERT — insert or update one active derived fact
   Identity = signal_type + market_id + entity_type + entity_id.
   ═══════════════════════════════════════════════════════════════ */
async function upsertSignal(sig) {
  const marketId = sig.market_id || null;
  const sql = `
    WITH candidate AS (
      SELECT id
        FROM signals
       WHERE signal_type = $1
         AND market_id IS NOT DISTINCT FROM $16
         AND entity_type IS NOT DISTINCT FROM $10
         AND entity_id IS NOT DISTINCT FROM $11
         AND status IN ('open','acknowledged','snoozed')
       ORDER BY
         CASE status WHEN 'snoozed' THEN 1 WHEN 'acknowledged' THEN 2 ELSE 3 END,
         created_at DESC
       LIMIT 1
    ), active AS (
      UPDATE signals s
         SET severity = $2,
             title = $3,
             summary = $4,
             source_module = $5,
             target_shell = $6,
             target_view = $7,
             target_filters = $8,
             owner_role = $9,
             recommendation = $12,
             confidence = $13,
             meta = $14,
             expires_at = $15,
             status = CASE
               WHEN s.status = 'snoozed' AND s.snoozed_until <= NOW() THEN 'open'
               ELSE s.status
             END,
             snoozed_until = CASE
               WHEN s.status = 'snoozed' AND s.snoozed_until <= NOW() THEN NULL
               ELSE s.snoozed_until
             END,
             updated_at = NOW()
        FROM candidate c
       WHERE s.id = c.id
      RETURNING s.id, s.signal_ref
    ), inserted AS (
      INSERT INTO signals (
        signal_type, severity, title, summary,
        source_module, target_shell, target_view, target_filters,
        owner_role, entity_type, entity_id,
        recommendation, confidence, meta, expires_at, market_id
      )
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
       WHERE NOT EXISTS (SELECT 1 FROM active)
      ON CONFLICT (signal_type, market_id, entity_type, entity_id)
        WHERE status IN ('open','acknowledged','snoozed')
      DO UPDATE SET
        severity = EXCLUDED.severity,
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        source_module = EXCLUDED.source_module,
        target_shell = EXCLUDED.target_shell,
        target_view = EXCLUDED.target_view,
        target_filters = EXCLUDED.target_filters,
        owner_role = EXCLUDED.owner_role,
        recommendation = EXCLUDED.recommendation,
        confidence = EXCLUDED.confidence,
        meta = EXCLUDED.meta,
        expires_at = EXCLUDED.expires_at,
        status = CASE
          WHEN signals.status = 'snoozed' AND signals.snoozed_until <= NOW() THEN 'open'
          ELSE signals.status
        END,
        snoozed_until = CASE
          WHEN signals.status = 'snoozed' AND signals.snoozed_until <= NOW() THEN NULL
          ELSE signals.snoozed_until
        END,
        updated_at = NOW()
      RETURNING id, signal_ref
    )
    SELECT * FROM active
    UNION ALL
    SELECT * FROM inserted
    LIMIT 1
  `;
  const result = await db.query(sql, [
    sig.signal_type,
    sig.severity || 'warning',
    sig.title,
    sig.summary || null,
    sig.source_module || 'signal-service',
    sig.target_shell || 'bo',
    sig.target_view || null,
    JSON.stringify(sig.target_filters || {}),
    sig.owner_role || 'admin',
    sig.entity_type || null,
    sig.entity_id || null,
    sig.recommendation || null,
    sig.confidence || 'high',
    JSON.stringify(sig.meta || {}),
    sig.expires_at || null,
    marketId,
  ]);
  return result.rows[0];
}

/* ═══════════════════════════════════════════════════════════════
   AUTO-RESOLVE — exact scope only. A market generator can never resolve a
   global fact or a fact belonging to another market.
   ═══════════════════════════════════════════════════════════════ */
async function autoResolveSignals(signalType, stillActiveEntityIds, marketId = null) {
  if (!stillActiveEntityIds || stillActiveEntityIds.length === 0) {
    await db.query(`
      UPDATE signals
         SET status = 'resolved', resolved_at = NOW(), snoozed_until = NULL, updated_at = NOW()
       WHERE signal_type = $1
         AND market_id IS NOT DISTINCT FROM $2
         AND status IN ('open','acknowledged','snoozed')
    `, [signalType, marketId]);
    return;
  }
  await db.query(`
    UPDATE signals
       SET status = 'resolved', resolved_at = NOW(), snoozed_until = NULL, updated_at = NOW()
     WHERE signal_type = $1
       AND status IN ('open','acknowledged','snoozed')
       AND entity_id IS NOT NULL
       AND entity_id != ALL($2)
       AND market_id IS NOT DISTINCT FROM $3
  `, [signalType, stillActiveEntityIds, marketId]);
}

async function expireOldSignals() {
  const result = await db.query(`
    UPDATE signals SET status = 'expired', updated_at = NOW()
    WHERE status IN ('open','acknowledged','snoozed')
      AND expires_at IS NOT NULL AND expires_at < NOW()
  `);
  return result.rowCount || 0;
}

let GENERATORS = {};

GENERATORS.parcel_blocked = async function() {
  try {
    const rows = (await db.query(`
      SELECT p.id, p.reference AS tracking_number, p.status, p.order_id,
             EXTRACT(DAY FROM NOW() - p.updated_at)::int AS days_stuck,
             o.reference
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.status NOT IN ('delivered','cancelled','returned')
        AND p.updated_at < NOW() - INTERVAL '3 days'
      ORDER BY p.updated_at ASC
      LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      const severity = r.days_stuck > 7 ? 'critical' : r.days_stuck > 5 ? 'warning' : 'info';
      await upsertSignal({
        signal_type: 'parcel_blocked', severity,
        title: r.tracking_number ? 'Colis bloqué — ' + r.tracking_number.substring(0, 12) : 'Colis bloqué',
        summary: 'Statut "' + r.status + '" depuis ' + r.days_stuck + ' jours' + (r.reference ? ' (cmd ' + r.reference + ')' : ''),
        source_module: 'signal-service', target_shell: 'bo', target_view: 'parcels',
        target_filters: { status: r.status }, owner_role: 'hub',
        entity_type: 'parcel', entity_id: r.id,
        recommendation: r.days_stuck > 5 ? 'Contacter le transitaire ou escalader' : 'Vérifier le suivi',
        confidence: 'high',
        meta: { days_stuck: r.days_stuck, tracking: r.tracking_number, order_ref: r.reference },
      });
      generated++;
    }
    await autoResolveSignals('parcel_blocked', entityIds);
    return { generated, resolved: 0 };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] parcel_blocked error:');
    return { generated: 0, error: e.message };
  }
};

GENERATORS.cash_expiring = async function() {
  try {
    const rows = (await db.query(`
      SELECT cc.id, cc.order_id, cc.amount, cc.relay_id,
             EXTRACT(DAY FROM NOW() - cc.created_at)::int AS days_pending,
             o.reference
      FROM cash_collections cc
      LEFT JOIN orders o ON o.id = cc.order_id
      WHERE cc.status = 'pending'
        AND cc.created_at < NOW() - INTERVAL '5 days'
      ORDER BY cc.created_at ASC
      LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      const severity = r.days_pending > 10 ? 'critical' : 'warning';
      await upsertSignal({
        signal_type: 'cash_expiring', severity,
        title: 'Cash en attente — ' + (r.amount || 0).toLocaleString('fr-FR') + ' KMF',
        summary: 'En attente depuis ' + r.days_pending + ' jours' + (r.reference ? ' (cmd ' + r.reference + ')' : ''),
        source_module: 'signal-service', target_shell: 'bo', target_view: 'reconciliation',
        target_filters: { status: 'pending' }, owner_role: 'relais',
        entity_type: 'cash_collection', entity_id: r.id,
        recommendation: 'Relancer le relais pour confirmer la réception', confidence: 'high',
        meta: { amount: r.amount, days_pending: r.days_pending, relay_id: r.relay_id },
      });
      generated++;
    }
    await autoResolveSignals('cash_expiring', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] cash_expiring error:');
    return { generated: 0, error: e.message };
  }
};

const OBSOLETE_SIGNAL_TYPES = Object.freeze(['stock_rupture', 'margin_drift', 'dispute_sensitive']);

async function retireObsoleteSignalTypes() {
  try {
    const result = await db.query(`
      UPDATE signals
         SET status = 'resolved',
             resolved_at = COALESCE(resolved_at, NOW()),
             snoozed_until = NULL,
             updated_at = NOW()
       WHERE signal_type = ANY($1::text[])
         AND status IN ('open','acknowledged','snoozed')
    `, [OBSOLETE_SIGNAL_TYPES]);
    return result.rowCount || 0;
  } catch (e) {
    log.warn({ err: e }, '[signal-service] obsolete signal retirement error:');
    return 0;
  }
}

GENERATORS.ordered_without_purchase_order = async function() {
  try {
    const rows = (await db.query(`
      SELECT o.id, o.reference,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(o.ordered_at, o.updated_at, o.created_at)))::int / 60 AS minutes_waiting
        FROM orders o
       WHERE o.status = 'ordered'
         AND COALESCE(o.ordered_at, o.updated_at, o.created_at) < NOW() - INTERVAL '15 minutes'
         AND NOT EXISTS (
           SELECT 1 FROM purchase_orders po
            WHERE po.order_id = o.id AND po.status != 'cancelled'
         )
       ORDER BY COALESCE(o.ordered_at, o.updated_at, o.created_at) ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'ordered_without_purchase_order', severity: 'critical',
        title: r.reference ? 'Commande sans PO — ' + r.reference : 'Commande sans PO',
        summary: 'Commande au statut ordered depuis ' + Number(r.minutes_waiting || 0) + ' min sans bon d’achat actif',
        source_module: 'signal-service', target_shell: 'bo', target_view: 'orders',
        target_filters: { status: 'ordered' }, owner_role: 'sourcing',
        entity_type: 'order', entity_id: r.id,
        recommendation: 'Relancer le déclenchement sourcing et vérifier le mapping fournisseur', confidence: 'high',
        meta: { minutes_waiting: Number(r.minutes_waiting || 0) },
      });
      generated++;
    }
    await autoResolveSignals('ordered_without_purchase_order', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] ordered_without_purchase_order error:');
    return { generated: 0, error: e.message };
  }
};

GENERATORS.purchase_order_overreceived = async function() {
  try {
    const rows = (await db.query(`
      SELECT o.id, o.reference,
             COUNT(*)::int AS po_count,
             SUM(po.received_qty - po.qty)::int AS excess_qty
        FROM purchase_orders po
        JOIN orders o ON o.id = po.order_id
       WHERE po.status != 'cancelled'
         AND po.received_qty > po.qty
       GROUP BY o.id, o.reference
       ORDER BY SUM(po.received_qty - po.qty) DESC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'purchase_order_overreceived', severity: 'critical',
        title: r.reference ? 'Réception PO incohérente — ' + r.reference : 'Réception PO incohérente',
        summary: Number(r.po_count || 0) + ' PO avec quantité reçue supérieure à la quantité commandée · excédent ' + Number(r.excess_qty || 0),
        source_module: 'signal-service', target_shell: 'bo', target_view: 'purchasing',
        target_filters: {}, owner_role: 'hub', entity_type: 'order', entity_id: r.id,
        recommendation: 'Vérifier la réception fournisseur avant toute correction de donnée', confidence: 'high',
        meta: { po_count: Number(r.po_count || 0), excess_qty: Number(r.excess_qty || 0) },
      });
      generated++;
    }
    await autoResolveSignals('purchase_order_overreceived', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] purchase_order_overreceived error:');
    return { generated: 0, error: e.message };
  }
};

GENERATORS.purchase_order_receipt_stuck = async function() {
  try {
    const rows = (await db.query(`
      SELECT o.id, o.reference,
             COUNT(*)::int AS po_count,
             EXTRACT(EPOCH FROM (NOW() - MAX(po.hub_received_at)))::int / 60 AS minutes_stuck
        FROM orders o
        JOIN purchase_orders po ON po.order_id = o.id AND po.status != 'cancelled'
       WHERE o.status = 'ordered'
       GROUP BY o.id, o.reference
      HAVING COUNT(*) > 0
         AND BOOL_AND(po.received_qty >= po.qty AND po.hub_received_at IS NOT NULL)
         AND MAX(po.hub_received_at) < NOW() - INTERVAL '15 minutes'
       ORDER BY MAX(po.hub_received_at) ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'purchase_order_receipt_stuck', severity: 'warning',
        title: r.reference ? 'PO reçues, commande bloquée — ' + r.reference : 'PO reçues, commande bloquée',
        summary: Number(r.po_count || 0) + ' PO complètes mais commande toujours ordered depuis ' + Number(r.minutes_stuck || 0) + ' min',
        source_module: 'signal-service', target_shell: 'bo', target_view: 'orders',
        target_filters: { status: 'ordered' }, owner_role: 'hub', entity_type: 'order', entity_id: r.id,
        recommendation: 'Vérifier la transition ordered → preparation et les scans de réception Hub', confidence: 'high',
        meta: { po_count: Number(r.po_count || 0), minutes_stuck: Number(r.minutes_stuck || 0) },
      });
      generated++;
    }
    await autoResolveSignals('purchase_order_receipt_stuck', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] purchase_order_receipt_stuck error:');
    return { generated: 0, error: e.message };
  }
};

GENERATORS.pickup_overdue = async function() {
  try {
    const rows = (await db.query(`
      SELECT o.id, o.reference,
             EXTRACT(DAY FROM NOW() - o.available_at)::int AS days_waiting
        FROM orders o
       WHERE o.status = 'available'
         AND o.available_at IS NOT NULL
         AND o.available_at < NOW() - INTERVAL '7 days'
       ORDER BY o.available_at ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'pickup_overdue', severity: 'warning',
        title: r.reference ? 'Retrait en retard — ' + r.reference : 'Retrait en retard',
        summary: 'Commande disponible au relais depuis ' + Number(r.days_waiting || 0) + ' jours',
        source_module: 'signal-service', target_shell: 'bo', target_view: 'orders',
        target_filters: { status: 'available' }, owner_role: 'relais', entity_type: 'order', entity_id: r.id,
        recommendation: 'Contacter le relais et vérifier que le client a bien été informé', confidence: 'high',
        meta: { days_waiting: Number(r.days_waiting || 0) },
      });
      generated++;
    }
    await autoResolveSignals('pickup_overdue', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] pickup_overdue error:');
    return { generated: 0, error: e.message };
  }
};

GENERATORS.preparation_stuck = async function() {
  try {
    const rows = (await db.query(`
      SELECT o.id, o.reference,
             EXTRACT(DAY FROM NOW() - o.preparation_at)::int AS days_stuck
        FROM orders o
       WHERE o.status = 'preparation'
         AND o.preparation_at IS NOT NULL
         AND o.preparation_at < NOW() - INTERVAL '4 days'
       ORDER BY o.preparation_at ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'preparation_stuck', severity: 'info',
        title: r.reference ? 'Préparation bloquée — ' + r.reference : 'Préparation bloquée',
        summary: 'Commande en préparation depuis ' + Number(r.days_stuck || 0) + ' jours',
        source_module: 'signal-service', target_shell: 'bo', target_view: 'orders',
        target_filters: { status: 'preparation' }, owner_role: 'hub', entity_type: 'order', entity_id: r.id,
        recommendation: 'Vérifier l’exécution Hub et les scans attendus', confidence: 'high',
        meta: { days_stuck: Number(r.days_stuck || 0) },
      });
      generated++;
    }
    await autoResolveSignals('preparation_stuck', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] preparation_stuck error:');
    return { generated: 0, error: e.message };
  }
};

async function generateSignals(types) {
  const expired = await expireOldSignals();
  const results = { expired, generators: {} };
  const toRun = types || Object.keys(GENERATORS);
  for (const type of toRun) {
    if (GENERATORS[type]) results.generators[type] = await GENERATORS[type]();
    else results.generators[type] = { error: 'Unknown generator: ' + type };
  }
  results.retired_obsolete = await retireObsoleteSignalTypes();
  return results;
}

module.exports = {
  upsertSignal,
  autoResolveSignals,
  expireOldSignals,
  retireObsoleteSignalTypes,
  generateSignals,
  GENERATORS,
};
