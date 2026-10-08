/**
 * @komerce-arch
 * @role          signal-service
 * @domain        decision-signals
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload, optional_server_resolved_market_id, optional_transaction_executor
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js, utils/rules.js, services/supplier-payment-review.js
 * @used-by       routes/signals.js, bootstrap/feature-wiring.js, services/action-center-workspace.js,
 *                services/incident-escalation.js
 * @db-read       cash_collections, customs_shipment_parcels, customs_shipments, hub_physical_unit_placements, hub_purchase_allocations, order_items, orders, parcels, purchase_orders, v_purchase_line_progress, supplier_execution_payments
 * @db-write      signals
 * @db-txn        optional_caller_owned_transaction_for_upsert
 * @doctrine      resolve_before_behavior_change, market_scope_is_server_authority, preserve_caller_transaction
 * @impact-areas  decision-signals, purchasing, orders, logistics, market-authorization, incident-management
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
const { getSupplierPaymentReview } = require('./supplier-payment-review');
const { getRuleNumber } = require('../utils/rules');
const { reconcileOrderFinancialClose, VERDICT: FINANCIAL_CLOSE_VERDICT } = require('./order-financial-closure-reconciliation');

/* ═══════════════════════════════════════════════════════════════
   UPSERT — insert or update one active derived fact
   Identity = signal_type + market_id + entity_type + entity_id.
   An optional executor lets an owning caller persist the signal inside its
   already-open transaction; default behavior remains the shared db pool.
   ═══════════════════════════════════════════════════════════════ */
async function upsertSignal(sig, executor = db) {
  const q = executor && typeof executor.query === 'function' ? executor : db;
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
  const result = await q.query(sql, [
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

GENERATORS.supplier_payment_review = async function() {
  try {
    const review = await getSupplierPaymentReview({ limit: 50, include_internal_identity: true });
    let generated = 0;
    const entityIds = [];

    for (const payment of review.items) {
      entityIds.push(payment.payment_id);
      const mismatched = payment.reconciliation_status === 'mismatched';
      await upsertSignal({
        signal_type: 'supplier_payment_review',
        severity: mismatched ? 'critical' : 'warning',
        title: `Paiement fournisseur à revoir — ${payment.provider || 'provider'}`,
        summary: [
          payment.status || 'statut inconnu',
          `rapprochement ${payment.reconciliation_status || 'inconnu'}`,
          payment.review_reason || null,
        ].filter(Boolean).join(' · '),
        source_module: 'signal-service',
        target_shell: 'bo',
        target_view: 'purchasing',
        target_filters: {},
        owner_role: 'admin',
        entity_type: 'supplier_payment',
        entity_id: payment.payment_id,
        recommendation: 'Ouvrir la PO dans Achats et traiter la réconciliation fournisseur',
        confidence: 'high',
        meta: {
          provider: payment.provider || null,
          review_reason: payment.review_reason || null,
        },
      });
      generated++;
    }

    // Avec une file tronquée, ne jamais auto-résoudre des paiements actifs non lus.
    if (!review.truncated) {
      await autoResolveSignals('supplier_payment_review', entityIds);
    }
    return { generated, truncated: review.truncated === true };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] supplier_payment_review error:');
    return { generated: 0, error: e.message };
  }
};

GENERATORS.customer_payment_attention = async function() {
  try {
    // Reuse the payment owner's existing business rule. No dashboard-specific
    // timeout is invented here: cash becomes observable at the same H+N as
    // the canonical reminder lifecycle, while an explicit failed payment is
    // observable immediately.
    const cashTimeoutHours = await getRuleNumber('CASH_PAYMENT_TIMEOUT_HOURS', 36);
    const reminderHours = Math.max(1, Math.round(Number(cashTimeoutHours || 36) / 3));
    const rows = (await db.query(`
      SELECT o.id, o.reference, o.payment_mode::text AS payment_mode,
             o.payment_status::text AS payment_status, o.created_at,
             CASE
               WHEN o.payment_status::text = 'failed' THEN 'payment_failed'
               ELSE 'cash_payment_overdue'
             END AS reason
        FROM orders o
       WHERE o.status::text NOT IN ('cancelled','collected','refunded')
         AND (
           o.payment_status::text = 'failed'
           OR (
             o.payment_mode::text = 'cash_relais'
             AND o.payment_status::text = 'pending'
             AND o.status::text = 'pending'
             AND o.created_at <= NOW() - ($1 * INTERVAL '1 hour')
           )
         )
       ORDER BY o.created_at ASC
       LIMIT 50
    `, [reminderHours])).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      const failed = r.reason === 'payment_failed';
      await upsertSignal({
        signal_type: 'customer_payment_attention',
        severity: failed ? 'critical' : 'warning',
        title: r.reference
          ? (failed ? 'Paiement client échoué — ' : 'Paiement client en attente — ') + r.reference
          : (failed ? 'Paiement client échoué' : 'Paiement client en attente'),
        summary: failed
          ? 'Le paiement client est explicitement en échec.'
          : `Paiement cash relais toujours en attente après ${reminderHours} h.`,
        source_module: 'signal-service',
        target_shell: 'bo',
        target_view: 'orders',
        target_filters: { payment_status: r.payment_status, payment_mode: r.payment_mode },
        owner_role: 'finance',
        entity_type: 'order',
        entity_id: r.id,
        recommendation: failed
          ? 'Vérifier le rail de paiement et permettre une nouvelle tentative client'
          : 'Relancer le paiement ou appliquer le lifecycle cash existant',
        confidence: 'high',
        meta: {
          reason: r.reason,
          payment_mode: r.payment_mode,
          payment_status: r.payment_status,
          ...(failed ? {} : { reminder_hours: reminderHours }),
        },
      });
      generated++;
    }
    await autoResolveSignals('customer_payment_attention', entityIds);
    return { generated, reminder_hours: reminderHours };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] customer_payment_attention error:');
    return { generated: 0, error: e.message };
  }
};

GENERATORS.customs_declaration_pending = async function() {
  try {
    // A parcel physically arrived while its active customs shipment is still
    // pending is already an actionable persisted fact. No arbitrary age
    // threshold is required to expose it.
    const rows = (await db.query(`
      SELECT DISTINCT
             o.id,
             o.reference,
             cs.id AS customs_shipment_id,
             cs.reference AS customs_reference,
             cs.status::text AS customs_status
        FROM customs_shipments cs
        JOIN customs_shipment_parcels csp ON csp.shipment_id = cs.id
        JOIN parcels p ON p.id = csp.parcel_id
        JOIN orders o ON o.id = p.order_id
       WHERE cs.is_active = TRUE
         AND cs.status::text = 'pending'
         AND (p.status::text = 'arrived' OR p.arrived_at IS NOT NULL)
         AND o.status::text NOT IN ('cancelled','collected','refunded')
       ORDER BY o.reference ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'customs_declaration_pending',
        severity: 'warning',
        title: r.reference
          ? 'Déclaration douane attendue — ' + r.reference
          : 'Déclaration douane attendue',
        summary: r.customs_reference
          ? 'Le colis est arrivé mais le dossier ' + r.customs_reference + ' est toujours pending.'
          : 'Le colis est arrivé mais la déclaration douane est toujours pending.',
        source_module: 'signal-service',
        target_shell: 'bo',
        target_view: 'shipping-customs',
        target_filters: { customs_shipment_id: r.customs_shipment_id },
        owner_role: 'customs',
        entity_type: 'order',
        entity_id: r.id,
        recommendation: 'Ouvrir Expéditions & Douane et déclarer le dossier',
        confidence: 'high',
        meta: {
          customs_shipment_id: r.customs_shipment_id,
          customs_reference: r.customs_reference || null,
          customs_status: r.customs_status,
        },
      });
      generated++;
    }
    await autoResolveSignals('customs_declaration_pending', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] customs_declaration_pending error:');
    return { generated: 0, error: e.message };
  }
};

GENERATORS.supplier_order_ambiguous = async function() {
  try {
    const rows = (await db.query(`
      WITH latest_create AS (
        SELECT DISTINCT ON (e.purchase_order_id, e.provider)
               e.purchase_order_id,
               e.provider,
               e.outcome,
               e.facts,
               e.created_at
          FROM supplier_execution_events e
         WHERE e.operation = 'create_order'
         ORDER BY e.purchase_order_id, e.provider, e.created_at DESC, e.id DESC
      )
      SELECT DISTINCT
             o.id,
             o.reference,
             lc.purchase_order_id,
             lc.provider,
             lc.created_at
        FROM latest_create lc
        JOIN purchase_orders po ON po.id = lc.purchase_order_id
        LEFT JOIN purchase_lines pl
          ON pl.purchase_order_id = po.id
         AND pl.cancelled_at IS NULL
        LEFT JOIN order_items oi ON oi.id = pl.order_item_id
        JOIN orders o ON o.id = COALESCE(oi.order_id, po.order_id)
       WHERE lc.outcome = 'ambiguous'
         AND COALESCE((lc.facts->>'replay_blocked')::boolean, FALSE) = TRUE
         AND po.status = 'pending'
       ORDER BY lc.created_at ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'supplier_order_ambiguous',
        severity: 'critical',
        title: r.reference
          ? 'Création fournisseur ambiguë — ' + r.reference
          : 'Création fournisseur ambiguë',
        summary: 'Replay automatique bloqué pour la PO ' + r.purchase_order_id
          + ' (' + r.provider + ') : vérifier le fournisseur avant toute nouvelle commande.',
        source_module: 'signal-service',
        target_shell: 'bo',
        target_view: 'purchasing',
        target_filters: { purchase_order_id: r.purchase_order_id },
        owner_role: 'purchasing',
        entity_type: 'order',
        entity_id: r.id,
        recommendation: 'Réconcilier la création fournisseur puis décider explicitement de reprendre ou non l’achat',
        confidence: 'high',
        meta: {
          purchase_order_id: r.purchase_order_id,
          provider: r.provider,
          replay_blocked: true,
        },
      });
      generated++;
    }
    await autoResolveSignals('supplier_order_ambiguous', entityIds);
    return { generated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] supplier_order_ambiguous error:');
    return { generated: 0, error: e.message };
  }
};

GENERATORS.parcel_blocked = async function() {
  try {
    const rows = (await db.query(`
      SELECT p.id, p.reference AS tracking_number, p.status, p.order_id,
             EXTRACT(DAY FROM NOW() - p.updated_at)::int AS days_stuck,
             o.reference
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.status::text NOT IN ('collected','cancelled')
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
        target_filters: { status: r.status },
        owner_role: r.status === 'shipped'
          ? 'transitaire'
          : r.status === 'in_transit'
            ? 'logistics'
            : r.status === 'arrived'
              ? 'customs'
              : r.status === 'available'
                ? 'relais'
                : 'hub',
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

// Clôture financière : commande encaissée et payée dont les faits économiques ne sont pas mûrs.
// Le verdict vient de reconcileOrderFinancialClose (seule autorité) ; ce générateur ne recalcule rien.
// Fenêtre et plafond bornent le coût (≈5 requêtes par commande) ; un plafond atteint est rapporté
// (`truncated`) et journalisé, jamais silencieux. Un signal n'est résolu que si sa commande a été
// réévaluée et n'est plus en attente, ou si elle n'est plus candidate.
const FINANCIAL_CLOSE_WINDOW_DAYS = 60;
const FINANCIAL_CLOSE_MAX_EVALUATIONS = 200;
const FINANCIAL_CLOSE_CANDIDATES_SQL = `
  FROM orders o
 WHERE o.status::text = 'collected'
   AND o.payment_status::text = 'paid'
   AND o.updated_at > NOW() - ($1::int * INTERVAL '1 day')`;

GENERATORS.financial_close_economic_facts_pending = async function() {
  try {
    const rows = (await db.query(
      `SELECT o.id, o.reference ${FINANCIAL_CLOSE_CANDIDATES_SQL}
        ORDER BY o.updated_at ASC
        LIMIT $2`,
      [FINANCIAL_CLOSE_WINDOW_DAYS, FINANCIAL_CLOSE_MAX_EVALUATIONS + 1]
    )).rows;
    const truncated = rows.length > FINANCIAL_CLOSE_MAX_EVALUATIONS;
    const evaluated = rows.slice(0, FINANCIAL_CLOSE_MAX_EVALUATIONS);

    let generated = 0;
    const notPendingIds = [];
    for (const r of evaluated) {
      let verdict;
      try {
        verdict = await reconcileOrderFinancialClose(db, { orderId: r.id });
      } catch (error) {
        // Évaluation impossible : on ne résout rien (fail-closed) et on continue.
        log.warn({ err: error, order_id: r.id }, '[signal-service] financial_close evaluation failed');
        continue;
      }
      if (verdict.verdict === FINANCIAL_CLOSE_VERDICT.PENDING && verdict.reason === 'FINANCIAL_CLOSE_ECONOMIC_FACTS_PENDING') {
        await upsertSignal({
          signal_type: 'financial_close_economic_facts_pending', severity: 'warning',
          title: r.reference ? 'Clôture financière en attente des faits économiques — ' + r.reference : 'Clôture financière en attente des faits économiques',
          summary: 'Commande encaissée et payée, mais les faits économiques ne sont pas mûrs : la clôture financière ne peut pas être prononcée.',
          source_module: 'signal-service', target_shell: 'bo', target_view: 'orders',
          target_filters: { status: 'collected' }, owner_role: 'finance', entity_type: 'order', entity_id: r.id,
          recommendation: 'Compléter les faits économiques de la commande (imputations de coûts, disposition) puis relancer la clôture',
          confidence: 'high',
          meta: { reason: verdict.reason },
        });
        generated++;
      } else {
        notPendingIds.push(r.id);
      }
    }

    // Résolution bornée : commandes réévaluées et non en attente, ou sorties du périmètre candidat.
    await db.query(
      `UPDATE signals s
          SET status = 'resolved', resolved_at = NOW(), snoozed_until = NULL, updated_at = NOW()
        WHERE s.signal_type = 'financial_close_economic_facts_pending'
          AND s.status IN ('open','acknowledged','snoozed')
          AND s.entity_id IS NOT NULL
          AND (
            s.entity_id::text = ANY($1::text[])
            OR NOT EXISTS (
              SELECT 1 FROM orders o
               WHERE o.id::text = s.entity_id::text
                 AND o.status::text = 'collected'
                 AND o.payment_status::text = 'paid'
                 AND o.updated_at > NOW() - ($2::int * INTERVAL '1 day')
            )
          )`,
      [notPendingIds.map(String), FINANCIAL_CLOSE_WINDOW_DAYS]
    );

    if (truncated) log.warn({ max: FINANCIAL_CLOSE_MAX_EVALUATIONS }, '[signal-service] financial_close candidates truncated');
    return { generated, evaluated: evaluated.length, truncated };
  } catch (e) {
    log.warn({ err: e }, '[signal-service] financial_close_economic_facts_pending error:');
    return { generated: 0, error: e.message };
  }
};

// PR 7 — « couverture » d'achat lue sur les lignes (v_purchase_line_progress) : un item non LOCAL_STOCK est couvert
// quand la somme des quantités effectives de ses lignes non annulées (ouvertes, en brouillon ou engagées) atteint sa
// quantité. Une ligne soldée sans reliquat rouvert laisse l'item non couvert (la commande reste bloquée, fail-closed).
const UNCOVERED_ITEM_PREDICATE = `
  COALESCE(oi.fulfillment_source, '') <> 'LOCAL_STOCK'
  AND COALESCE((
    SELECT SUM(v.effective_quantity)
      FROM v_purchase_line_progress v
     WHERE v.order_item_id = oi.id AND NOT v.cancelled
  ), 0) < oi.quantity`;

GENERATORS.ordered_without_purchase_order = async function() {
  try {
    const rows = (await db.query(`
      WITH uncovered AS (
        SELECT oi.order_id, COUNT(*)::int AS uncovered_items
          FROM order_items oi
          JOIN orders od ON od.id = oi.order_id AND od.status = 'ordered'
         WHERE ${UNCOVERED_ITEM_PREDICATE}
         GROUP BY oi.order_id
      )
      SELECT o.id, o.reference, u.uncovered_items,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(o.ordered_at, o.updated_at, o.created_at)))::int / 60 AS minutes_waiting
        FROM orders o
        JOIN uncovered u ON u.order_id = o.id
       WHERE o.status = 'ordered'
         AND COALESCE(o.ordered_at, o.updated_at, o.created_at) < NOW() - INTERVAL '15 minutes'
       ORDER BY COALESCE(o.ordered_at, o.updated_at, o.created_at) ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'ordered_without_purchase_order', severity: 'critical',
        title: r.reference ? 'Commande sans achat couvert — ' + r.reference : 'Commande sans achat couvert',
        summary: Number(r.uncovered_items || 0) + ' item(s) non couvert(s) par une ligne d’achat depuis ' + Number(r.minutes_waiting || 0) + ' min',
        source_module: 'signal-service', target_shell: 'bo', target_view: 'orders',
        target_filters: { status: 'ordered' }, owner_role: 'sourcing',
        entity_type: 'order', entity_id: r.id,
        recommendation: 'Relancer le déclenchement sourcing, vérifier le mapping fournisseur ou racheter le reliquat', confidence: 'high',
        meta: { minutes_waiting: Number(r.minutes_waiting || 0), uncovered_items: Number(r.uncovered_items || 0) },
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
             COUNT(DISTINCT v.purchase_order_id)::int AS po_count,
             SUM(v.received_quantity - v.effective_quantity)::int AS excess_qty
        FROM v_purchase_line_progress v
        JOIN orders o ON o.id = v.order_id
       WHERE v.purchase_order_id IS NOT NULL
         AND NOT v.cancelled
         AND v.received_quantity > v.effective_quantity
       GROUP BY o.id, o.reference
       ORDER BY SUM(v.received_quantity - v.effective_quantity) DESC
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
    // Filet de la complétude Hub : tout est couvert ET entièrement reçu, mais la commande est toujours « ordered ».
    // Dernière réception d'une ligne regroupée = dernier placement RECEIVE ; historique = hub_received_at de la PO.
    const rows = (await db.query(`
      SELECT o.id, o.reference,
             COUNT(DISTINCT v.purchase_order_id)::int AS po_count,
             EXTRACT(EPOCH FROM (NOW() - MAX(COALESCE(lr.received_at, v.hub_received_at))))::int / 60 AS minutes_stuck
        FROM orders o
        JOIN v_purchase_line_progress v ON v.order_id = o.id AND v.purchase_order_id IS NOT NULL AND NOT v.cancelled
        LEFT JOIN LATERAL (
          SELECT MAX(p.placed_at) AS received_at
            FROM hub_physical_unit_placements p
            JOIN hub_purchase_allocations a ON a.id = p.allocation_id
           WHERE v.line_id IS NOT NULL AND a.purchase_line_id = v.line_id AND p.operation_type = 'RECEIVE'
        ) lr ON TRUE
       WHERE o.status = 'ordered'
         AND NOT EXISTS (
           SELECT 1 FROM order_items oi
            WHERE oi.order_id = o.id AND ${UNCOVERED_ITEM_PREDICATE}
         )
         AND NOT EXISTS (
           SELECT 1 FROM v_purchase_line_progress w
            WHERE w.order_id = o.id AND NOT w.cancelled AND w.received_quantity < w.effective_quantity
         )
       GROUP BY o.id, o.reference
      HAVING COUNT(*) > 0
         AND BOOL_AND(COALESCE(lr.received_at, v.hub_received_at) IS NOT NULL)
         AND MAX(COALESCE(lr.received_at, v.hub_received_at)) < NOW() - INTERVAL '15 minutes'
       ORDER BY MAX(COALESCE(lr.received_at, v.hub_received_at)) ASC
       LIMIT 50
    `)).rows;

    let generated = 0;
    const entityIds = [];
    for (const r of rows) {
      entityIds.push(r.id);
      await upsertSignal({
        signal_type: 'purchase_order_receipt_stuck', severity: 'warning',
        title: r.reference ? 'Achats reçus, commande bloquée — ' + r.reference : 'Achats reçus, commande bloquée',
        summary: Number(r.po_count || 0) + ' PO reçues et items couverts mais commande toujours ordered depuis ' + Number(r.minutes_stuck || 0) + ' min',
        source_module: 'signal-service', target_shell: 'bo', target_view: 'orders',
        target_filters: { status: 'ordered' }, owner_role: 'hub', entity_type: 'order', entity_id: r.id,
        recommendation: 'Vérifier la transition ordered → preparation et la complétude d’achat après réception Hub', confidence: 'high',
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
