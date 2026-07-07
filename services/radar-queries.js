/**
 * @komerce-arch
 * @role          radar-queries
 * @domain        recommendations
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/parcels.js, utils/rules.js
 * @used-by       routes/admin-radar.js
 * @db-read       cash_collections, cash_deposits, finance_config, incidents, orders, parcels, products, signals, users, wallets
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

'use strict';

/**
 * services/radar-queries.js — R9
 *
 * Logique de lecture du Radar admin, extraite de routes/admin-radar.js.
 * La route devient une façade (auth + appel service + réponse).
 *
 * Fonctions pures : computeDetailFallback, getDetail
 * Lectures        : getAlerts, getMoneyCards, getStatusDetails,
 *                   getOrdersByDetail, getRadarSummary
 * Cache mémoire   : cached / invalidateCache (TTL via DASHBOARD_CACHE_TTL_SEC)
 *
 * Iso-comportement avec la route d'origine (mêmes SQL, mêmes seuils, même ordre).
 */

const db = require('../db');
const { getRuleNumber } = require('../utils/rules');

// Fallback : si computeOrderStatusDetail pas exporté par parcels.js, on le calcule localement
let computeOrderStatusDetail;
try {
  computeOrderStatusDetail = require('../utils/parcels').computeOrderStatusDetail;
} catch (_) {
  computeOrderStatusDetail = null;
}

// Buckets de status_detail autorisés (guard de orders-by-detail)
const ALLOWED_DETAILS = [
  'full_available', 'partial_available', 'partial_collected',
  'remaining_in_transit', 'awaiting_stock', 'fully_cancelled',
  'fully_collected', 'no_parcels',
];

// ══════════════════════════════════════════════════════════════════════════
// Cache mémoire simple (TTL lu depuis DASHBOARD_CACHE_TTL_SEC)
// ══════════════════════════════════════════════════════════════════════════
const _cache = new Map();

async function cached(key, ttlSecDefault, fn) {
  const ttlSec = await getRuleNumber('DASHBOARD_CACHE_TTL_SEC', ttlSecDefault);
  const ttlMs = ttlSec * 1000;
  const now = Date.now();
  const entry = _cache.get(key);
  if (entry && now - entry.at < ttlMs) return entry.data;
  const data = await fn();
  _cache.set(key, { data, at: now });
  return data;
}

function invalidateCache() { _cache.clear(); }

// ══════════════════════════════════════════════════════════════════════════
// Fallback computeOrderStatusDetail (si pas exporté par parcels.js)
// ══════════════════════════════════════════════════════════════════════════
function computeDetailFallback(parcels) {
  if (!parcels || parcels.length === 0) return null;
  const statuses = parcels.map(p => p.status);
  const all = (s) => statuses.every(x => x === s);
  const some = (s) => statuses.some(x => x === s);

  if (all('cancelled')) return 'fully_cancelled';
  if (all('collected')) return 'fully_collected';
  if (some('collected')) {
    if (some('in_transit') || some('shipped')) return 'remaining_in_transit';
    if (some('available')) return 'partial_collected';
  }
  if (some('available')) {
    if (some('shipped') || some('in_transit')) return 'partial_available';
    if (all('available')) return 'full_available';
  }
  if (some('draft') || some('preparation')) return 'awaiting_stock';
  return null;
}

function getDetail(parcels) {
  if (computeOrderStatusDetail) return computeOrderStatusDetail(parcels);
  return computeDetailFallback(parcels);
}

// ══════════════════════════════════════════════════════════════════════════
// 0. Synthèse légère (racine du radar)
// ══════════════════════════════════════════════════════════════════════════
async function getRadarSummary() {
  let alertCount = 0;
  try {
    const { rows: [r] } = await db.query(
      `SELECT COUNT(*)::int AS c FROM signals
        WHERE severity IN ('critical','high') AND resolved_at IS NULL`
    );
    alertCount = r ? r.c : 0;
  } catch (_) { /* table peut ne pas exister */ }

  return {
    ok: true,
    alert_count: alertCount,
    generated_at: new Date().toISOString(),
    hint: 'Pour détail : /alerts, /money, /status-details',
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 1. Alertes "à action aujourd'hui" (cache 30s)
// ══════════════════════════════════════════════════════════════════════════
async function getAlerts() {
  return cached('radar:alerts', 30, async () => {

    // Seuils dynamiques
    const slaWarningDays  = await getRuleNumber('SLA_WARNING_DAYS', 35);
    const slaLateDays     = await getRuleNumber('SLA_LATE_DAYS', 42);
    const slaBlockedDays  = await getRuleNumber('SLA_BLOCKED_DAYS', 56);
    const cashTimeoutHrs  = await getRuleNumber('CASH_PAYMENT_TIMEOUT_HOURS', 36);
    const cashCollectKmf  = await getRuleNumber('CASH_COLLECT_ALERT_KMF', 1000000);
    const walletTotalKmf  = await getRuleNumber('WALLET_TOTAL_ALERT_KMF', 5000000);
    const paymentFailedCt = await getRuleNumber('PAYMENT_FAILED_ALERT_COUNT_24H', 5);
    const cancelRatePct   = await getRuleNumber('CANCEL_RATE_ALERT_PCT', 15);
    const backorderMaxD   = await getRuleNumber('BACKORDER_MAX_DAYS', 45);
    const stockLowThresh  = await getRuleNumber('STOCK_LOW_THRESHOLD', 5);

    const alerts = [];

    // ── A. Commandes cash impayées > timeout ───────────────────────────
    const { rows: cashOverdue } = await db.query(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(total_kmf), 0) AS total_kmf
      FROM orders
      WHERE payment_mode = 'cash_relais'
        AND status = 'pending'
        AND created_at < NOW() - ($1 * INTERVAL '1 hour')
    `, [cashTimeoutHrs]);
    if (cashOverdue[0].cnt > 0) {
      alerts.push({
        level: 'critical',
        icon: '💸',
        code: 'CASH_OVERDUE',
        title: `${cashOverdue[0].cnt} commande(s) cash impayée(s) > ${cashTimeoutHrs}h`,
        value_kmf: Number(cashOverdue[0].total_kmf),
        count: Number(cashOverdue[0].cnt),
        action: 'Relancer ou annuler',
        target_view: 'orders',
        target_filter: { payment_mode: 'cash_relais', status: 'pending', overdue: true },
      });
    }

    // ── B. Paiements Stripe échoués > seuil 24h ─────────────────────────
    const { rows: stripeFailed } = await db.query(`
      SELECT COUNT(*) AS cnt
      FROM orders
      WHERE payment_mode = 'stripe_eur'
        AND payment_status = 'failed'
        AND created_at > NOW() - INTERVAL '24 hours'
    `).catch(() => ({ rows: [{ cnt: 0 }] }));
    if (Number(stripeFailed[0].cnt) >= paymentFailedCt) {
      alerts.push({
        level: 'critical',
        icon: '🚨',
        code: 'STRIPE_FAILED',
        title: `${stripeFailed[0].cnt} paiement(s) Stripe échoué(s) en 24h`,
        count: Number(stripeFailed[0].cnt),
        action: 'Vérifier Stripe dashboard',
        target_view: 'orders',
        target_filter: { payment_status: 'failed' },
      });
    }

    // ── C. Colis bloqués > SLA_BLOCKED_DAYS ─────────────────────────────
    const { rows: blockedParcels } = await db.query(`
      SELECT COUNT(DISTINCT p.id) AS cnt
      FROM parcels p
      WHERE p.status NOT IN ('collected', 'cancelled')
        AND p.created_at < NOW() - ($1 * INTERVAL '1 day')
    `, [slaBlockedDays]);
    if (Number(blockedParcels[0].cnt) > 0) {
      alerts.push({
        level: 'critical',
        icon: '🔴',
        code: 'PARCELS_BLOCKED',
        title: `${blockedParcels[0].cnt} colis bloqué(s) > ${slaBlockedDays}j`,
        count: Number(blockedParcels[0].cnt),
        action: 'Intervention urgente',
        target_view: 'orders',
        target_filter: { parcel_status: 'blocked' },
      });
    }

    // ── D. Cash en attente aux relais > seuil ───────────────────────────
    const { rows: cashPending } = await db.query(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(total_kmf), 0) AS total_kmf
      FROM orders
      WHERE payment_mode = 'cash_relais'
        AND status = 'available'
        AND total_kmf > 0
    `);
    const cashPendingKmf = Number(cashPending[0].total_kmf);
    if (cashPendingKmf >= cashCollectKmf) {
      alerts.push({
        level: 'critical',
        icon: '💰',
        code: 'CASH_PENDING_HIGH',
        title: `${cashPendingKmf.toLocaleString('fr-FR')} KMF attendus aux relais`,
        value_kmf: cashPendingKmf,
        count: Number(cashPending[0].cnt),
        action: 'Accélérer collecte',
        target_view: 'relais',
        target_filter: {},
      });
    }

    // ── E. Trésorerie wallets > seuil alerte ────────────────────────────
    const { rows: wallets } = await db.query(`
      SELECT COALESCE(SUM(balance_kmf), 0) AS total
      FROM wallets
      WHERE balance_kmf > 0
    `);
    const walletTotal = Number(wallets[0].total);
    if (walletTotal >= walletTotalKmf) {
      alerts.push({
        level: 'signal',
        icon: '💼',
        code: 'WALLET_TOTAL_HIGH',
        title: `Encours wallets: ${walletTotal.toLocaleString('fr-FR')} KMF`,
        value_kmf: walletTotal,
        action: 'Encourager utilisation',
        target_view: 'finances',
        target_filter: {},
      });
    }

    // ── F. Commandes partiellement livrées depuis > 7j ────────────────
    const { rows: partialOrders } = await db.query(`
      SELECT o.id, o.reference, o.created_at, o.total_kmf,
             COALESCE(json_agg(p.status), '[]'::json) AS parcel_statuses,
             COALESCE(json_agg(p.id), '[]'::json) AS parcel_ids
      FROM orders o
      JOIN parcels p ON p.order_id = o.id
      WHERE o.status NOT IN ('cancelled', 'refunded')
        AND o.created_at < NOW() - INTERVAL '7 days'
      GROUP BY o.id
    `);

    let partialCollectedCount = 0;
    let partialAvailableCount = 0;
    let awaitingStockCount = 0;
    for (const order of partialOrders) {
      const fakeParcels = order.parcel_statuses.map(s => ({ status: s }));
      const detail = getDetail(fakeParcels);
      if (detail === 'partial_collected') partialCollectedCount++;
      if (detail === 'partial_available') partialAvailableCount++;
      if (detail === 'awaiting_stock' &&
          (new Date() - new Date(order.created_at)) / 86400000 > backorderMaxD) {
        awaitingStockCount++;
      }
    }

    if (partialCollectedCount > 0) {
      alerts.push({
        level: 'critical',
        icon: '⚠️',
        code: 'PARTIAL_COLLECTED_STALE',
        title: `${partialCollectedCount} commande(s) partiellement récupérée(s) > 7j`,
        count: partialCollectedCount,
        action: 'Client a laissé du stock au relais',
        target_view: 'orders',
        target_filter: { status_detail: 'partial_collected' },
      });
    }
    if (partialAvailableCount > 0) {
      alerts.push({
        level: 'signal',
        icon: '🟠',
        code: 'PARTIAL_AVAILABLE_STALE',
        title: `${partialAvailableCount} commande(s) partiellement disponible(s) > 7j`,
        count: partialAvailableCount,
        action: 'Compléter la livraison',
        target_view: 'orders',
        target_filter: { status_detail: 'partial_available' },
      });
    }
    if (awaitingStockCount > 0) {
      alerts.push({
        level: 'critical',
        icon: '📦',
        code: 'AWAITING_STOCK_EXPIRED',
        title: `${awaitingStockCount} commande(s) en attente stock > ${backorderMaxD}j`,
        count: awaitingStockCount,
        action: 'Échec sourcing — décider',
        target_view: 'orders',
        target_filter: { status_detail: 'awaiting_stock' },
      });
    }

    // ── G. Taux annulation 7j > seuil ──────────────────────────────────
    const { rows: cancelStats } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS total_7d,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days' AND status = 'cancelled') AS cancelled_7d
      FROM orders
    `);
    const total7d = Number(cancelStats[0].total_7d);
    const cancelled7d = Number(cancelStats[0].cancelled_7d);
    if (total7d > 0) {
      const ratePct = (cancelled7d / total7d) * 100;
      if (ratePct >= cancelRatePct) {
        alerts.push({
          level: 'critical',
          icon: '📉',
          code: 'CANCEL_RATE_HIGH',
          title: `Taux annulation 7j: ${ratePct.toFixed(1)}% (seuil ${cancelRatePct}%)`,
          value_pct: Number(ratePct.toFixed(1)),
          count: cancelled7d,
          action: 'Analyser les causes',
          target_view: 'orders',
          target_filter: { status: 'cancelled' },
        });
      }
    }

    // ── H. Incidents ouverts critiques ─────────────────────────────────
    const { rows: incidents } = await db.query(`
      SELECT COUNT(*) AS cnt
      FROM incidents
      WHERE status = 'open'
        AND (severity = 'critical' OR severity = 'high')
    `).catch(() => ({ rows: [{ cnt: 0 }] }));
    if (Number(incidents[0].cnt) > 0) {
      alerts.push({
        level: 'critical',
        icon: '🔥',
        code: 'INCIDENTS_OPEN',
        title: `${incidents[0].cnt} incident(s) critique(s) ouvert(s)`,
        count: Number(incidents[0].cnt),
        action: 'Traiter',
        target_view: 'incidents',
        target_filter: { status: 'open' },
      });
    }

    // ── I. Stock bas (produits actifs) ─────────────────────────────────
    const { rows: lowStock } = await db.query(`
      SELECT COUNT(*) AS cnt
      FROM products
      WHERE is_active = TRUE
        AND stock > 0
        AND stock <= $1
    `, [stockLowThresh]).catch(() => ({ rows: [{ cnt: 0 }] }));
    if (Number(lowStock[0].cnt) > 0) {
      alerts.push({
        level: 'signal',
        icon: '📉',
        code: 'STOCK_LOW',
        title: `${lowStock[0].cnt} produit(s) stock bas (≤ ${stockLowThresh})`,
        count: Number(lowStock[0].cnt),
        action: 'Réapprovisionner',
        target_view: 'inventory',
        target_filter: {},
      });
    }

    // ── J. Ruptures ────────────────────────────────────────────────────
    const { rows: ruptures } = await db.query(`
      SELECT COUNT(*) AS cnt
      FROM products
      WHERE is_active = TRUE AND stock = 0
    `).catch(() => ({ rows: [{ cnt: 0 }] }));
    if (Number(ruptures[0].cnt) > 0) {
      alerts.push({
        level: 'signal',
        icon: '❌',
        code: 'STOCK_OUT',
        title: `${ruptures[0].cnt} produit(s) en rupture`,
        count: Number(ruptures[0].cnt),
        action: 'Désactiver ou réapprovisionner',
        target_view: 'inventory',
        target_filter: {},
      });
    }

    // ── K. Cash non déclaré > 48h ──────────────────────────────────────
    const cashNotCollectedHrs = await getRuleNumber('CASH_NOT_COLLECTED_HOURS', 48);
    try {
      const { rows: [uncollected] } = await db.query(`
        SELECT COUNT(*) AS cnt, COALESCE(SUM(o.total_kmf), 0) AS total_kmf
        FROM orders o
        WHERE o.payment_mode = 'cash_relais'
          AND o.status IN ('available', 'collected')
          AND o.created_at < NOW() - ($1 * INTERVAL '1 hour')
          AND NOT EXISTS (
            SELECT 1 FROM cash_collections cc WHERE cc.order_id = o.id
          )
      `, [cashNotCollectedHrs]);
      if (Number(uncollected.cnt) > 0) {
        alerts.push({
          level: 'critical',
          icon: '🕳️',
          code: 'CASH_NOT_COLLECTED',
          title: `${uncollected.cnt} commande(s) cash livrée(s) > ${cashNotCollectedHrs}h sans encaissement déclaré`,
          value_kmf: Number(uncollected.total_kmf),
          count: Number(uncollected.cnt),
          action: 'Vérifier avec les agents relais',
          target_view: 'cash',
          target_filter: { type: 'uncollected' },
        });
      }
    } catch (_) { /* cash_collections table may not exist yet */ }

    // ── L. Cash non déposé > 72h ───────────────────────────────────────
    const cashNotDepositedHrs = await getRuleNumber('CASH_NOT_DEPOSITED_HOURS', 72);
    try {
      const { rows: [undeposited] } = await db.query(`
        SELECT
          COUNT(DISTINCT cc.collected_by) AS agent_count,
          COALESCE(SUM(cc.amount_kmf), 0) AS total_kmf
        FROM cash_collections cc
        WHERE cc.confirmed_at < NOW() - ($1 * INTERVAL '1 hour')
          AND NOT EXISTS (
            SELECT 1 FROM cash_deposits cd
            WHERE cd.agent_id = cc.collected_by
              AND cd.period_start <= cc.confirmed_at::date
              AND cd.period_end >= cc.confirmed_at::date
          )
      `, [cashNotDepositedHrs]);
      if (Number(undeposited.total_kmf) > 0) {
        alerts.push({
          level: 'critical',
          icon: '🏦',
          code: 'CASH_NOT_DEPOSITED',
          title: `${Number(undeposited.total_kmf).toLocaleString('fr-FR')} KMF encaissés non déposés (${undeposited.agent_count} agent(s))`,
          value_kmf: Number(undeposited.total_kmf),
          count: Number(undeposited.agent_count),
          action: 'Demander les versements',
          target_view: 'cash',
          target_filter: { type: 'undeposited' },
        });
      }
    } catch (_) { /* table may not exist yet */ }

    // ── M. Dépôts en attente de vérification ───────────────────────────
    try {
      const { rows: [pendingDeposits] } = await db.query(`
        SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_kmf), 0) AS total_kmf
        FROM cash_deposits
        WHERE status = 'pending'
      `);
      if (Number(pendingDeposits.cnt) > 0) {
        alerts.push({
          level: 'signal',
          icon: '📋',
          code: 'DEPOSITS_PENDING_REVIEW',
          title: `${pendingDeposits.cnt} dépôt(s) en attente de vérification (${Number(pendingDeposits.total_kmf).toLocaleString('fr-FR')} KMF)`,
          value_kmf: Number(pendingDeposits.total_kmf),
          count: Number(pendingDeposits.cnt),
          action: 'Vérifier les justificatifs',
          target_view: 'cash',
          target_filter: { type: 'pending_deposits' },
        });
      }
    } catch (_) { /* table may not exist yet */ }

    // ── N. Pattern suspect : agent avec écart > 3 semaines consécutives ──
    try {
      const { rows: suspectAgents } = await db.query(`
        WITH cc_aligned AS (
          SELECT
            cc.collected_by,
            cc.amount_kmf,
            DATE_TRUNC('week', cc.confirmed_at) AS week_start
          FROM cash_collections cc
          WHERE cc.confirmed_at > NOW() - INTERVAL '4 weeks'
        ),
        weekly_gaps AS (
          SELECT
            cca.collected_by AS agent_id,
            cca.week_start,
            SUM(cca.amount_kmf) AS declared_kmf,
            COALESCE((
              SELECT SUM(cd.amount_kmf)
              FROM cash_deposits cd
              WHERE cd.agent_id = cca.collected_by
                AND cd.period_start <= (cca.week_start + INTERVAL '6 days')::date
                AND cd.period_end >= cca.week_start::date
            ), 0) AS deposited_kmf
          FROM cc_aligned cca
          GROUP BY cca.collected_by, cca.week_start
        ),
        agent_gaps AS (
          SELECT
            agent_id,
            COUNT(*) FILTER (WHERE declared_kmf - deposited_kmf > 0) AS weeks_with_gap,
            SUM(declared_kmf - deposited_kmf) AS total_gap_kmf
          FROM weekly_gaps
          GROUP BY agent_id
          HAVING COUNT(*) FILTER (WHERE declared_kmf - deposited_kmf > 0) >= 3
        )
        SELECT ag.agent_id, u.full_name, ag.weeks_with_gap, ag.total_gap_kmf
        FROM agent_gaps ag
        LEFT JOIN users u ON u.id = ag.agent_id
      `);
      if (suspectAgents.length > 0) {
        const names = suspectAgents.map(a => a.full_name || 'Inconnu').join(', ');
        const totalGap = suspectAgents.reduce((s, a) => s + Number(a.total_gap_kmf), 0);
        alerts.push({
          level: 'critical',
          icon: '🚩',
          code: 'CASH_SUSPECT_PATTERN',
          title: `Pattern suspect : ${suspectAgents.length} agent(s) avec écart cash > 3 semaines`,
          value_kmf: totalGap,
          count: suspectAgents.length,
          detail: names,
          action: 'Investigation requise',
          target_view: 'cash',
          target_filter: { type: 'suspect' },
        });
      }
    } catch (_) { /* tables may not exist yet */ }

    // Tri : critical d'abord, puis signal
    alerts.sort((a, b) => {
      if (a.level === 'critical' && b.level !== 'critical') return -1;
      if (b.level === 'critical' && a.level !== 'critical') return 1;
      return 0;
    });

    return {
      generated_at: new Date().toISOString(),
      total: alerts.length,
      critical: alerts.filter(a => a.level === 'critical').length,
      signal:   alerts.filter(a => a.level === 'signal').length,
      alerts,
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 2. Money cards (cache 30s)
// ══════════════════════════════════════════════════════════════════════════
async function getMoneyCards() {
  return cached('radar:money', 30, async () => {

    // ── CA : aujourd'hui vs hier ────────────────────────────────────────
    const { rows: caJour } = await db.query(`
      SELECT
        COALESCE(SUM(total_kmf) FILTER (WHERE created_at::date = CURRENT_DATE), 0) AS ca_today_kmf,
        COALESCE(SUM(total_kmf) FILTER (WHERE created_at::date = CURRENT_DATE - INTERVAL '1 day'), 0) AS ca_yesterday_kmf,
        COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS orders_today,
        COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE - INTERVAL '1 day') AS orders_yesterday
      FROM orders
      WHERE status NOT IN ('pending', 'cancelled', 'refunded')
    `);

    const caToday = Number(caJour[0].ca_today_kmf);
    const caYesterday = Number(caJour[0].ca_yesterday_kmf);
    const caDeltaPct = caYesterday > 0
      ? ((caToday - caYesterday) / caYesterday) * 100
      : (caToday > 0 ? 100 : 0);

    // ── CA : ce mois vs mois précédent (même nb de jours) ──────────────
    const { rows: caMois } = await db.query(`
      WITH bounds AS (
        SELECT
          DATE_TRUNC('month', CURRENT_DATE) AS start_current,
          CURRENT_DATE AS end_current,
          DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' AS start_previous,
          DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' + (CURRENT_DATE - DATE_TRUNC('month', CURRENT_DATE)) AS end_previous
      )
      SELECT
        COALESCE(SUM(o.total_kmf) FILTER (WHERE o.created_at >= b.start_current AND o.created_at <= b.end_current), 0) AS ca_mtd_kmf,
        COALESCE(SUM(o.total_kmf) FILTER (WHERE o.created_at >= b.start_previous AND o.created_at <= b.end_previous), 0) AS ca_prev_mtd_kmf
      FROM orders o, bounds b
      WHERE o.status NOT IN ('pending', 'cancelled', 'refunded')
    `);
    const caMtd = Number(caMois[0].ca_mtd_kmf);
    const caPrevMtd = Number(caMois[0].ca_prev_mtd_kmf);
    const caMtdDeltaPct = caPrevMtd > 0
      ? ((caMtd - caPrevMtd) / caPrevMtd) * 100
      : (caMtd > 0 ? 100 : 0);

    // ── Cash attendu aux relais ────────────────────────────────────────
    const { rows: cashAttendu } = await db.query(`
      SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(total_kmf), 0) AS total_kmf
      FROM orders
      WHERE payment_mode = 'cash_relais'
        AND status = 'available'
    `);
    const cashAttenduKmf = Number(cashAttendu[0].total_kmf);
    const cashAttenduCount = Number(cashAttendu[0].cnt);

    // ── Trésorerie wallets totale ──────────────────────────────────────
    const { rows: wallets } = await db.query(`
      SELECT
        COALESCE(SUM(balance_kmf), 0) AS total_kmf,
        COUNT(*) FILTER (WHERE balance_kmf > 0) AS active_count
      FROM wallets
    `);
    const walletTotal = Number(wallets[0].total_kmf);
    const walletActiveCount = Number(wallets[0].active_count);

    // ── Marge : margin_kmf si dispo, sinon MARGE_PCT * CA ──────────────
    let margeMtd = 0;
    let margePrevMtd = 0;
    try {
      const { rows: margeRows } = await db.query(`
        WITH bounds AS (
          SELECT
            DATE_TRUNC('month', CURRENT_DATE) AS start_current,
            CURRENT_DATE AS end_current,
            DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' AS start_previous,
            DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' + (CURRENT_DATE - DATE_TRUNC('month', CURRENT_DATE)) AS end_previous
        )
        SELECT
          COALESCE(SUM(margin_kmf) FILTER (WHERE created_at >= b.start_current AND created_at <= b.end_current), 0) AS marge_mtd,
          COALESCE(SUM(margin_kmf) FILTER (WHERE created_at >= b.start_previous AND created_at <= b.end_previous), 0) AS marge_prev_mtd
        FROM orders o, bounds b
        WHERE status = 'collected'
      `);
      margeMtd = Number(margeRows[0].marge_mtd);
      margePrevMtd = Number(margeRows[0].marge_prev_mtd);
    } catch (_) {
      // Colonne margin_kmf absente → fallback : marge cible × CA
      let margePct;
      try {
        const { rows } = await db.query('SELECT target_marge_brute_pct FROM finance_config WHERE id = 1');
        margePct = Number(rows[0]?.target_marge_brute_pct) || 0;
      } catch (_) { margePct = 0; }
      if (!margePct) {
        margePct = await getRuleNumber('MARGE_PCT', 40);
      }
      margeMtd = Math.round(caMtd * margePct / 100);
      margePrevMtd = Math.round(caPrevMtd * margePct / 100);
    }
    const margeDeltaPct = margePrevMtd > 0
      ? ((margeMtd - margePrevMtd) / margePrevMtd) * 100
      : (margeMtd > 0 ? 100 : 0);

    return {
      generated_at: new Date().toISOString(),
      cards: [
        {
          id: 'ca_today',
          label: "CA aujourd'hui",
          value_kmf: caToday,
          value_count: Number(caJour[0].orders_today),
          comparison: {
            label: 'vs hier',
            previous_kmf: caYesterday,
            delta_pct: Number(caDeltaPct.toFixed(1)),
            direction: caDeltaPct >= 0 ? 'up' : 'down',
          },
          icon: '📈',
          color: caDeltaPct >= 0 ? 'green' : 'red',
        },
        {
          id: 'ca_mtd',
          label: 'CA mois en cours',
          value_kmf: caMtd,
          comparison: {
            label: 'vs mois précédent (même période)',
            previous_kmf: caPrevMtd,
            delta_pct: Number(caMtdDeltaPct.toFixed(1)),
            direction: caMtdDeltaPct >= 0 ? 'up' : 'down',
          },
          icon: '📊',
          color: caMtdDeltaPct >= 0 ? 'green' : 'red',
        },
        {
          id: 'cash_pending',
          label: 'Cash attendu relais',
          value_kmf: cashAttenduKmf,
          value_count: cashAttenduCount,
          sub_label: `${cashAttenduCount} commandes à collecter`,
          icon: '💰',
          color: 'amber',
          action_label: 'Voir relais',
          action_view: 'relais',
        },
        {
          id: 'wallets_total',
          label: 'Encours wallets',
          value_kmf: walletTotal,
          value_count: walletActiveCount,
          sub_label: `${walletActiveCount} wallets actifs`,
          icon: '💼',
          color: 'blue',
          action_label: 'Voir wallets',
          action_view: 'finances',
        },
        {
          id: 'marge_mtd',
          label: 'Marge mois en cours',
          value_kmf: margeMtd,
          comparison: {
            label: 'vs mois précédent',
            previous_kmf: margePrevMtd,
            delta_pct: Number(margeDeltaPct.toFixed(1)),
            direction: margeDeltaPct >= 0 ? 'up' : 'down',
          },
          icon: '💎',
          color: margeDeltaPct >= 0 ? 'green' : 'red',
        },
      ],
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 3. Distribution fine des status_detail (cache 30s)
// ══════════════════════════════════════════════════════════════════════════
async function getStatusDetails() {
  return cached('radar:status_details', 30, async () => {

    // PATCH P1-1 : LIMIT 2000 — évite la saturation pool sur gros volumes.
    const RADAR_MAX_ORDERS = 2000;
    const { rows: orders } = await db.query(`
      SELECT
        o.id,
        o.reference,
        o.total_kmf,
        o.status AS order_status,
        o.created_at,
        u.full_name AS recipient_name,
        u.phone AS recipient_phone,
        COALESCE(json_agg(p.status ORDER BY p.status) FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS parcel_statuses
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN parcels p ON p.order_id = o.id
      WHERE o.status NOT IN ('refunded')
      GROUP BY
        o.id,
        o.reference,
        o.total_kmf,
        o.status,
        o.created_at,
        u.full_name,
        u.phone
      ORDER BY o.created_at DESC
      LIMIT $1
    `, [RADAR_MAX_ORDERS]);

    const distribution = {
      full_available:       { count: 0, value_kmf: 0, orders: [] },
      partial_available:    { count: 0, value_kmf: 0, orders: [] },
      partial_collected:    { count: 0, value_kmf: 0, orders: [] },
      remaining_in_transit: { count: 0, value_kmf: 0, orders: [] },
      awaiting_stock:       { count: 0, value_kmf: 0, orders: [] },
      fully_cancelled:      { count: 0, value_kmf: 0, orders: [] },
      fully_collected:      { count: 0, value_kmf: 0, orders: [] },
      no_parcels:           { count: 0, value_kmf: 0, orders: [] },
    };

    for (const o of orders) {
      const parcels = (o.parcel_statuses || []).map(s => ({ status: s }));
      const detail = getDetail(parcels) || 'no_parcels';
      if (!distribution[detail]) continue;

      distribution[detail].count++;
      distribution[detail].value_kmf += Number(o.total_kmf || 0);

      if (distribution[detail].orders.length < 5) {
        distribution[detail].orders.push({
          id: o.id,
          reference: o.reference,
          total_kmf: Number(o.total_kmf || 0),
          recipient_name: o.recipient_name,
          created_at: o.created_at,
          order_status: o.order_status,
        });
      }
    }

    const meta = {
      full_available:       { label: 'Entièrement disponibles',     icon: '📦', severity: 'ok',       hint: 'Prêt à être récupéré au relais.' },
      partial_available:    { label: 'Partiellement disponibles',   icon: '🟠', severity: 'signal',   hint: 'Une partie arrive encore.' },
      partial_collected:    { label: 'Partiellement récupérées',    icon: '⚠️', severity: 'critical', hint: 'Client a pris une partie seulement.' },
      remaining_in_transit: { label: 'Reste en transit',            icon: '🚢', severity: 'signal',   hint: 'Client a récupéré, la suite arrive.' },
      awaiting_stock:       { label: 'En attente stock',            icon: '⏳', severity: 'signal',   hint: 'Sourcing en cours.' },
      fully_cancelled:      { label: 'Annulées',                    icon: '❌', severity: 'info',     hint: 'Commande annulée.' },
      fully_collected:      { label: 'Entièrement récupérées',      icon: '✅', severity: 'info',     hint: 'Commande clôturée.' },
      no_parcels:           { label: 'Sans colis (en cours)',       icon: '📝', severity: 'info',     hint: 'Commande créée, colisage à venir.' },
    };

    const result = {};
    for (const [key, val] of Object.entries(distribution)) {
      result[key] = { ...meta[key], ...val };
    }

    return {
      generated_at: new Date().toISOString(),
      total_orders_analyzed: orders.length,
      truncated: orders.length >= RADAR_MAX_ORDERS,
      details: result,
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 4. Drill-down : commandes pour un status_detail donné
// ══════════════════════════════════════════════════════════════════════════
async function getOrdersByDetail(detail) {
  const { rows: orders } = await db.query(`
    SELECT
      o.id, o.reference, o.total_kmf, o.status AS order_status,
      o.created_at, u.full_name AS recipient_name, u.phone AS recipient_phone,
      o.payment_mode,
      COALESCE(json_agg(p.status ORDER BY p.status) FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS parcel_statuses
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN parcels p ON p.order_id = o.id
    WHERE o.status NOT IN ('refunded')
    GROUP BY o.id, u.full_name, u.phone
    ORDER BY o.created_at DESC
    LIMIT 500
  `);

  const filtered = orders
    .map(o => ({
      ...o,
      computed_detail: getDetail((o.parcel_statuses || []).map(s => ({ status: s }))) || 'no_parcels',
    }))
    .filter(o => o.computed_detail === detail);

  return {
    detail,
    count: filtered.length,
    total_value_kmf: filtered.reduce((s, o) => s + Number(o.total_kmf || 0), 0),
    orders: filtered,
  };
}

module.exports = {
  ALLOWED_DETAILS,
  invalidateCache,
  computeDetailFallback,
  getDetail,
  getRadarSummary,
  getAlerts,
  getMoneyCards,
  getStatusDetails,
  getOrdersByDetail,
};
