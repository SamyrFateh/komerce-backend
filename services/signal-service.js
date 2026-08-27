/**
 * @komerce-arch
 * @role          signal-service
 * @domain        decision-signals
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js
 * @used-by       routes/signals.js, bootstrap/feature-wiring.js, services/action-center-workspace.js
 * @db-read       cash_collections, order_items, orders, parcels, products, users
 * @db-write      signals
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */


'use strict';
/**
 * Signal Service — Komerce
 * Generates, deduplicates, and manages platform signals.
 * Signals are the common language between CT and BO.
 *
 * Each generator queries the database for a specific condition
 * and upserts signals with deduplication (type + entity).
 */

let db = require('../db');
// Manquait : les 5 catch non-fatals appellent log.warn(...) → sans cet import,
// une sous-erreur lève "ReferenceError: log is not defined" et transforme un
// warning non-fatal en 500 (détecté par la sonde de conformité P4-1).
let log = require('../utils/logger').child({ module: 'signal-service' });

/* ═══════════════════════════════════════════════════════════════
   UPSERT — insert or update a signal (dedup on type+entity)
   ═══════════════════════════════════════════════════════════════ */
async function upsertSignal(sig) {
  // A signal is one derived fact across its whole active lifecycle.
  // Update an existing open/acknowledged/snoozed signal first; only
  // insert when no active fact exists. An expired snooze wakes up.
  let sql = `
    WITH candidate AS (
      SELECT id
        FROM signals
       WHERE signal_type = $1
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
        recommendation, confidence, meta, expires_at
      )
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       WHERE NOT EXISTS (SELECT 1 FROM active)
      ON CONFLICT (signal_type, entity_type, entity_id) WHERE status IN ('open','acknowledged','snoozed')
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
  let result = await db.query(sql, [
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
    sig.expires_at || null
  ]);
  return result.rows[0];
}

/* ═══════════════════════════════════════════════════════════════
   AUTO-RESOLVE — close signals whose condition no longer holds
   ═══════════════════════════════════════════════════════════════ */
async function autoResolveSignals(signalType, stillActiveEntityIds) {
  if (!stillActiveEntityIds || stillActiveEntityIds.length === 0) {
    // Resolve ALL open signals of this type
    await db.query(`
      UPDATE signals SET status = 'resolved', resolved_at = NOW(), snoozed_until = NULL, updated_at = NOW()
      WHERE signal_type = $1 AND status IN ('open','acknowledged','snoozed')
    `, [signalType]);
    return;
  }
  await db.query(`
    UPDATE signals SET status = 'resolved', resolved_at = NOW(), snoozed_until = NULL, updated_at = NOW()
    WHERE signal_type = $1 AND status IN ('open','acknowledged','snoozed')
      AND entity_id IS NOT NULL
      AND entity_id != ALL($2)
  `, [signalType, stillActiveEntityIds]);
}

/* ═══════════════════════════════════════════════════════════════
   EXPIRE — close signals past their expiration date
   ═══════════════════════════════════════════════════════════════ */
async function expireOldSignals() {
  let result = await db.query(`
    UPDATE signals SET status = 'expired', updated_at = NOW()
    WHERE status IN ('open','acknowledged','snoozed')
      AND expires_at IS NOT NULL AND expires_at < NOW()
  `);
  return result.rowCount || 0;
}

/* ═══════════════════════════════════════════════════════════════
   GENERATORS — one per signal type
   Each returns { generated: N, resolved: N }
   ═══════════════════════════════════════════════════════════════ */

let GENERATORS = {};

/* ── 1. parcel_blocked: colis bloqué > 3 jours dans un statut ── */
GENERATORS.parcel_blocked = async function() {
  try {
    let rows = (await db.query(`
      SELECT p.id, p.tracking_number, p.status, p.order_id,
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
    let entityIds = [];
    for (let r of rows) {
      entityIds.push(r.id);
      let severity = r.days_stuck > 7 ? 'critical' : r.days_stuck > 5 ? 'warning' : 'info';
      await upsertSignal({
        signal_type:   'parcel_blocked',
        severity:      severity,
        title:         'Colis bloqué — ' + (r.tracking_number || r.id).substring(0, 12),
        summary:       'Statut "' + r.status + '" depuis ' + r.days_stuck + ' jours' +
                       (r.reference ? ' (cmd ' + r.reference + ')' : ''),
        source_module: 'signal-service',
        target_shell:  'bo',
        target_view:   'parcels',
        target_filters: { status: r.status },
        owner_role:    'hub',
        entity_type:   'parcel',
        entity_id:     r.id,
        recommendation: r.days_stuck > 5 ? 'Contacter le transitaire ou escalader' : 'Vérifier le suivi',
        confidence:    'high',
        meta:          { days_stuck: r.days_stuck, tracking: r.tracking_number, order_ref: r.reference }
      });
      generated++;
    }
    await autoResolveSignals('parcel_blocked', entityIds);
    return { generated: generated, resolved: 0 };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] parcel_blocked error:');
    return { generated: 0, error: e.message };
  }
};

/* ── 2. cash_expiring: réconciliation cash en attente > 5 jours ── */
GENERATORS.cash_expiring = async function() {
  try {
    let rows = (await db.query(`
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
    let entityIds = [];
    for (let r of rows) {
      entityIds.push(r.id);
      let severity = r.days_pending > 10 ? 'critical' : 'warning';
      await upsertSignal({
        signal_type:   'cash_expiring',
        severity:      severity,
        title:         'Cash en attente — ' + (r.amount || 0).toLocaleString('fr-FR') + ' KMF',
        summary:       'En attente depuis ' + r.days_pending + ' jours' +
                       (r.reference ? ' (cmd ' + r.reference + ')' : ''),
        source_module: 'signal-service',
        target_shell:  'bo',
        target_view:   'reconciliation',
        target_filters: { status: 'pending' },
        owner_role:    'relais',
        entity_type:   'cash_collection',
        entity_id:     r.id,
        recommendation: 'Relancer le relais pour confirmer la réception',
        confidence:    'high',
        meta:          { amount: r.amount, days_pending: r.days_pending, relay_id: r.relay_id }
      });
      generated++;
    }
    await autoResolveSignals('cash_expiring', entityIds);
    return { generated: generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] cash_expiring error:');
    return { generated: 0, error: e.message };
  }
};

/* ── 3. stock_rupture: produits actifs sans aucune vente récente ── */
GENERATORS.stock_rupture = async function() {
  try {
    // Products active but with 0 orders in last 30 days = potential dead stock
    let rows = (await db.query(`
      SELECT p.id, p.name, p.category, p.price_kmf,
             COALESCE(recent.cnt, 0) AS recent_orders
      FROM products p
      LEFT JOIN (
        SELECT oi.product_id, COUNT(*) AS cnt
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at > NOW() - INTERVAL '30 days'
        GROUP BY oi.product_id
      ) recent ON recent.product_id = p.id
      WHERE p.is_active = TRUE
        AND COALESCE(recent.cnt, 0) = 0
      ORDER BY p.created_at ASC
      LIMIT 30
    `)).rows;

    let generated = 0;
    let entityIds = [];
    for (let r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type:   'stock_rupture',
        severity:      'info',
        title:         'Produit sans vente — ' + (r.name || '').substring(0, 40),
        summary:       '0 commande en 30 jours · ' + r.category,
        source_module: 'signal-service',
        target_shell:  'bo',
        target_view:   'inventory',
        target_filters: { category: r.category },
        owner_role:    'sourcing',
        entity_type:   'product',
        entity_id:     r.id,
        recommendation: 'Évaluer si le produit doit être mis en avant ou désactivé',
        confidence:    'medium',
        meta:          { category: r.category, price: r.price_kmf }
      });
      generated++;
    }
    // Don't auto-resolve here — these should be manually reviewed
    return { generated: generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] stock_rupture error:');
    return { generated: 0, error: e.message };
  }
};

/* ── 4. margin_drift: commandes avec marge estimée faible ── */
GENERATORS.margin_drift = async function() {
  try {
    // Orders where the margin might be too low
    // Simple heuristic: total_kmf / nb_items < threshold
    let rows = (await db.query(`
      SELECT o.id, o.reference, o.total_kmf,
             COALESCE(o.items_total, 1) AS items,
             o.created_at
      FROM orders o
      WHERE o.created_at > NOW() - INTERVAL '7 days'
        AND o.status NOT IN ('cancelled')
        AND o.total_kmf > 0
        AND (o.total_kmf / GREATEST(COALESCE(o.items_total, 1), 1)) < 5000
      ORDER BY o.created_at DESC
      LIMIT 20
    `)).rows;

    let generated = 0;
    let entityIds = [];
    for (let r of rows) {
      entityIds.push(r.id);
      let avgPerItem = Math.round(r.total_kmf / Math.max(r.items, 1));
      await upsertSignal({
        signal_type:   'margin_drift',
        severity:      'warning',
        title:         'Marge faible — cmd ' + (r.reference || r.id).substring(0, 12),
        summary:       'Panier moyen/article: ' + avgPerItem.toLocaleString('fr-FR') + ' KMF (' + r.items + ' articles)',
        source_module: 'signal-service',
        target_shell:  'ct',
        target_view:   'dashboard',
        target_filters: {},
        owner_role:    'finance',
        entity_type:   'order',
        entity_id:     r.id,
        recommendation: 'Vérifier le pricing des produits concernés',
        confidence:    'medium',
        meta:          { total: r.total_kmf, items: r.items, avg_per_item: avgPerItem }
      });
      generated++;
    }
    await autoResolveSignals('margin_drift', entityIds);
    return { generated: generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] margin_drift error:');
    return { generated: 0, error: e.message };
  }
};

/* ── 5. dispute_sensitive: commandes avec statut problématique ── */
GENERATORS.dispute_sensitive = async function() {
  try {
    let rows = (await db.query(`
      SELECT o.id, o.reference, o.status, o.total_kmf,
             EXTRACT(DAY FROM NOW() - o.updated_at)::int AS days_in_status,
             u.full_name AS client_name, u.phone
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.status IN ('disputed','problem','refund_requested')
        AND o.updated_at > NOW() - INTERVAL '30 days'
      ORDER BY o.updated_at ASC
      LIMIT 20
    `)).rows;

    let generated = 0;
    let entityIds = [];
    for (let r of rows) {
      entityIds.push(r.id);
      let severity = r.days_in_status > 5 ? 'critical' : 'warning';
      await upsertSignal({
        signal_type:   'dispute_sensitive',
        severity:      severity,
        title:         'Litige — cmd ' + (r.reference || r.id).substring(0, 12),
        summary:       'Statut "' + r.status + '" depuis ' + r.days_in_status + ' jours' +
                       (r.client_name ? ' · ' + r.client_name : ''),
        source_module: 'signal-service',
        target_shell:  'bo',
        target_view:   'orders',
        target_filters: { status: r.status },
        owner_role:    'support',
        entity_type:   'order',
        entity_id:     r.id,
        recommendation: r.days_in_status > 5
          ? 'Escalader — le client attend depuis trop longtemps'
          : 'Traiter le litige rapidement',
        confidence:    'high',
        meta:          { status: r.status, days: r.days_in_status, total: r.total_kmf, client: r.client_name }
      });
      generated++;
    }
    await autoResolveSignals('dispute_sensitive', entityIds);
    return { generated: generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] dispute_sensitive error:');
    return { generated: 0, error: e.message };
  }
};

/* ═══════════════════════════════════════════════════════════════
   MAIN GENERATOR — runs all or specific generators
   ═══════════════════════════════════════════════════════════════ */
async function generateSignals(types) {
  let expired = await expireOldSignals();
  let results = { expired: expired, generators: {} };

  let toRun = types || Object.keys(GENERATORS);
  for (let type of toRun) {
    if (GENERATORS[type]) {
      results.generators[type] = await GENERATORS[type]();
    } else {
      results.generators[type] = { error: 'Unknown generator: ' + type };
    }
  }
  return results;
}

module.exports = {
  upsertSignal: upsertSignal,
  autoResolveSignals: autoResolveSignals,
  expireOldSignals: expireOldSignals,
  generateSignals: generateSignals,
  GENERATORS: GENERATORS
};
