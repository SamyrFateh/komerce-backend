/**
 * KOMERCE — Dashboard unifié v12.0 — Colis-Centric — Coffre-fort
 * ================================================
 * Consolidation de dashboard.js + pilotage.js + finance/summary + admin/margins
 *
 * 10 endpoints · 0 overlap · auth blindée · rate-limited · taux dynamiques
 *
 * GET /api/dashboard/ops         → pilotage opérationnel quotidien
 * GET /api/dashboard/finance     → KPIs financiers (CA, marges, paiements)
 * GET /api/dashboard/pilotage    → vue stratégique coûts & marges par produit
 * GET /api/dashboard/pipeline    → kanban pipeline commandes
 * GET /api/dashboard/retards     → clients en retard (SLA) + compensations
 * GET /api/dashboard/forecast    → projections CA/marge
 * GET /api/dashboard/clients     → analyse comportement clients
 * GET /api/dashboard/history     
 * GET /api/dashboard/hub-dubai   
 * GET /api/dashboard/relais      → historique mensuel (graphiques)
 * GET /api/dashboard/payments    → suivi des paiements Cash + Stripe (pending/paid/failed/urgency)
 *
 * Auth : JWT (cookie httpOnly ou Bearer) + rôle admin
 * Rate limit : dashboardLimiter (60 req/min)
 * Cache : mémoire TTL 30s (configurable)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { getRates } = require('../utils/rates');
const { getRule } = require('../utils/rules');
const { getEcoVar } = require('../utils/eco-bridge');

// ── Auth : toutes les routes dashboard = admin only ─────────────────────────
router.use(authenticate, requireRole(['admin']));

// ── Cache mémoire (TTL configurable via business_rules) ─────────────────────
let _cacheTtlMs = 30_000; // default 30s — rafraîchi depuis DB
const _cache = new Map();

function cached(key) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < _cacheTtlMs) return entry.data;
  return null;
}
function setCache(key, data) {
  _cache.set(key, { data, ts: Date.now() });
  if (_cache.size > 100) _cache.delete(_cache.keys().next().value);
}

// ── Helper : taux EUR/KMF dynamique (jamais hardcodé) ───────────────────────
async function getEurKmf() {
  const rates = await getRates();
  return { eur_kmf: rates.eur_kmf, aed_kmf: rates.aed_kmf };
}

// ── Helper : finance variables — source unique = economic_variables (eco-bridge) ──
// getFinanceVal supprimé — était cassé (finance_config = singleton row, pas key-value)
// Tout passe désormais par getEcoVar() depuis utils/eco-bridge.js

// ── Config SLA & Compensations (chargée depuis business_rules) ──────────────
// Fallback = valeurs actuelles hardcodées → zéro régression si DB vide
async function loadDashConfig() {
  const [slaWarn, slaLate, slaBlocked, inactive, compPrev, compCredit, compDiscount, compRefund, cacheSec,
         fraudReverseCritDays, fraudPendingCritH, fraudPendingWarnH, fraudStaleDays, fraudReverseSqlDays] = await Promise.all([
    getRule('SLA_WARNING_DAYS', 35),
    getRule('SLA_LATE_DAYS', 42),
    getRule('SLA_BLOCKED_DAYS', 56),
    getRule('SLA_INACTIVE_DAYS', 7),
    getRule('COMP_PREVENTIVE_DAYS', 28),
    getRule('COMP_CREDIT_DAYS', 35),
    getRule('COMP_DISCOUNT_DAYS', 42),
    getRule('COMP_REFUND_DAYS', 56),
    getRule('DASHBOARD_CACHE_TTL_SEC', 30),
    // Anti-fraude — variabilisé (plus de magic numbers)
    getRule('FRAUD_REVERSE_CRITICAL_DAYS', 7),    // délai reverse → critical
    getRule('FRAUD_PENDING_CRITICAL_HOURS', 36),   // paiement en attente → critical
    getRule('FRAUD_PENDING_WARNING_HOURS', 12),    // paiement en attente → warning
    getRule('FRAUD_STALE_PARCEL_DAYS', 14),        // colis bloqué au relais
    getRule('FRAUD_REVERSE_SQL_DAYS', 3),          // seuil SQL delayed reverse
  ]);
  _cacheTtlMs = cacheSec * 1000;
  return {
    SLA_WARNING_DAYS: slaWarn, SLA_LATE_DAYS: slaLate, SLA_BLOCKED_DAYS: slaBlocked, INACTIVE_DAYS: inactive,
    DELAY_PREVENTIF: compPrev, DELAY_AVOIR: compCredit, DELAY_REMISE: compDiscount, DELAY_REMBOURSEMENT: compRefund,
    FRAUD_REVERSE_CRIT_DAYS: fraudReverseCritDays, FRAUD_PENDING_CRIT_H: fraudPendingCritH,
    FRAUD_PENDING_WARN_H: fraudPendingWarnH, FRAUD_STALE_DAYS: fraudStaleDays, FRAUD_REVERSE_SQL_DAYS: fraudReverseSqlDays,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GET /ops — Vue opérationnelle quotidienne
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/ops', async (req, res, next) => {
  try {
    const hit = cached('ops');
    if (hit) return res.json(hit);

    const cfg = await loadDashConfig();

    // ── Activité globale ────────────────────────────────────────────────────
    const { rows: [activ] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)                                    AS commandes_aujourd_hui,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled'))                             AS commandes_en_cours,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled')
                           AND updated_at < NOW() - INTERVAL '7 days')                             AS commandes_bloquees,
        COUNT(*) FILTER (WHERE status = 'collected' AND updated_at::date = CURRENT_DATE)           AS livrees_aujourd_hui,
        COUNT(*) FILTER (WHERE status = 'collected' AND updated_at >= NOW() - INTERVAL '30 days')  AS livrees_30j
      FROM orders
    `);

    // ── SLA tracker ─────────────────────────────────────────────────────────
    const { rows: slaRows } = await db.query(`
      SELECT reference, status, created_at, updated_at,
        EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 AS age_jours,
        EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400 AS inactif_jours
      FROM orders
      WHERE status NOT IN ('collected','cancelled')
      ORDER BY created_at ASC
    `);

    const sla = { on_time: 0, warning: 0, late: 0, blocked: 0 };
    const lateCmds = [];
    for (const o of slaRows) {
      const age = Number(o.age_jours), inactif = Number(o.inactif_jours);
      if (inactif >= cfg.INACTIVE_DAYS || age >= cfg.SLA_BLOCKED_DAYS) sla.blocked++;
      else if (age >= cfg.SLA_LATE_DAYS) { sla.late++; lateCmds.push({ reference: o.reference, status: o.status, jours: Math.round(age) }); }
      else if (age >= cfg.SLA_WARNING_DAYS) sla.warning++;
      else sla.on_time++;
    }

    // ── Logistique COLIS (unité physique qui voyage) ───────────────────────
    const { rows: [parcelCounts] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('draft', 'preparation'))               AS hub_preparation,
        COUNT(*) FILTER (WHERE status = 'shipped')                               AS expedie,
        COUNT(*) FILTER (WHERE status = 'in_transit')                            AS en_transit,
        COUNT(*) FILTER (WHERE status = 'available')                             AS au_relais,
        COUNT(*) FILTER (WHERE status NOT IN ('collected', 'cancelled'))          AS total_actifs,
        COUNT(*) FILTER (WHERE status NOT IN ('collected', 'cancelled')
                           AND updated_at < NOW() - INTERVAL '7 days')           AS colis_bloques,
        COUNT(*) FILTER (WHERE status = 'collected' AND updated_at::date = CURRENT_DATE) AS livres_aujourd_hui
      FROM parcels
    `);

    const logistique = {
      hub_preparation: { count: Number(parcelCounts.hub_preparation), label: '📦 Hub préparation' },
      expedie:         { count: Number(parcelCounts.expedie),         label: '🚚 Expédié' },
      en_transit:      { count: Number(parcelCounts.en_transit),      label: '🚢 En mer' },
      au_relais:       { count: Number(parcelCounts.au_relais),       label: '📍 Au relais' },
    };

    // ── Délais moyens ───────────────────────────────────────────────────────
    const { rows: [delais] } = await db.query(`
      SELECT
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(shipped_at, NOW()) - created_at)) / 86400)
          FILTER (WHERE status NOT IN ('cancelled')))::int AS avg_preparation_jours,
        ROUND(AVG(EXTRACT(EPOCH FROM (collected_at - created_at)) / 86400)
          FILTER (WHERE status = 'collected' AND collected_at IS NOT NULL))::int AS avg_livraison_totale_jours
      FROM orders
    `);

    // ── Alertes consolidées ─────────────────────────────────────────────────
    const [cashAlert, anomAlert, stockAlert] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS c FROM orders
        WHERE payment_mode = 'cash_relais' AND payment_status = 'pending'
          AND created_at < NOW() - INTERVAL '12 hours'`),
      db.query(`SELECT COUNT(*)::int AS c FROM orders
        WHERE status NOT IN ('collected','cancelled') AND updated_at < NOW() - INTERVAL '7 days'`),
      db.query(`SELECT COUNT(*)::int AS c FROM products
        WHERE is_active = TRUE AND stock IS NOT NULL AND stock < 3`),
    ]);

    const result = {
      activite: {
        commandes_aujourd_hui: Number(activ.commandes_aujourd_hui),
        commandes_en_cours:    Number(activ.commandes_en_cours),
        commandes_bloquees:    Number(activ.commandes_bloquees),
        livrees_aujourd_hui:   Number(activ.livrees_aujourd_hui),
        livrees_30j:           Number(activ.livrees_30j),
      },
      sla: { ...sla, details: { late: lateCmds.slice(0, 10) } },
      logistique,
      delais: {
        avg_preparation_jours:      delais.avg_preparation_jours,
        avg_livraison_totale_jours: delais.avg_livraison_totale_jours,
      },
      alertes: {
        cash_pending: cashAlert.rows[0].c,
        anomalies:    anomAlert.rows[0].c,
        low_stock:    stockAlert.rows[0].c,
      },
    };
    setCache('ops', result);
    res.json(result);
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. GET /finance — KPIs financiers unifiés
//    Fusionne : ancien dashboard/sales + finance/summary + admin/margins
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/finance', async (req, res, next) => {
  try {
    const period = Math.max(1, Math.min(365, parseInt(req.query.period) || 30));
    const rates  = await getEurKmf();

    // ── CA + volumes ────────────────────────────────────────────────────────
    const { rows: [kpi] } = await db.query(`
      SELECT
        -- Période courante
        COALESCE(SUM(total_kmf) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1), 0)    AS ca_kmf,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND status != 'cancelled')  AS nb_commandes,
        COALESCE(AVG(total_kmf) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND status != 'cancelled'), 0) AS panier_moyen_kmf,
        -- Paiements
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND payment_mode = 'cash_relais' AND status != 'cancelled') AS nb_cash,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND payment_mode = 'stripe_eur' AND status != 'cancelled') AS nb_stripe,
        COALESCE(SUM(total_kmf) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND payment_mode = 'cash_relais' AND status != 'cancelled'), 0) AS ca_cash_kmf,
        COALESCE(SUM(total_eur) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND payment_mode = 'stripe_eur' AND status != 'cancelled'), 0)  AS ca_stripe_eur,
        -- Coûts & marges (colonnes renseignées après groupage)
        COALESCE(SUM(cost_transport_kmf + cost_douane_kmf) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0) AND status != 'cancelled'
        ), 0) AS cout_logistique_kmf,
        COALESCE(SUM(total_kmf - cost_transport_kmf - cost_douane_kmf) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0) AND status != 'cancelled'
        ), 0) AS marge_reelle_kmf,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0) AND status != 'cancelled') AS nb_avec_cost,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND cost_transport_kmf = 0 AND cost_douane_kmf = 0 AND status != 'cancelled') AS nb_sans_cost,
        -- Période précédente
        COALESCE(SUM(total_kmf) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $2 AND created_at < NOW() - INTERVAL '1 day' * $1), 0) AS ca_prev_kmf,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $2 AND created_at < NOW() - INTERVAL '1 day' * $1 AND status != 'cancelled') AS nb_prev,
        -- Statuts
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND status = 'collected') AS nb_livrees,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND status = 'cancelled') AS nb_annulees
      FROM orders
    `, [period, period * 2]);

    const ca       = Number(kpi.ca_kmf);
    const caPrev   = Number(kpi.ca_prev_kmf);
    const nbCmd    = Number(kpi.nb_commandes);
    const nbPrev   = Number(kpi.nb_prev);
    const marge    = Number(kpi.marge_reelle_kmf);
    const eur_kmf  = rates.eur_kmf;

    // ── Alertes vente à perte ───────────────────────────────────────────────
    const { rows: perteRows } = await db.query(`
      SELECT reference FROM orders
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0)
        AND total_kmf < (cost_transport_kmf + cost_douane_kmf)
        AND status != 'cancelled'
      LIMIT 10
    `, [period]);

    // ── Marge par catégorie ─────────────────────────────────────────────────
    const { rows: catRows } = await db.query(`
      SELECT p.category,
        COUNT(o.id) AS nb_commandes,
        COALESCE(SUM(o.total_kmf), 0) AS ca_kmf,
        COALESCE(SUM(o.total_kmf - o.cost_transport_kmf - o.cost_douane_kmf), 0) AS marge_kmf,
        ROUND(CASE WHEN SUM(o.total_kmf) > 0
          THEN 100.0 * SUM(o.total_kmf - o.cost_transport_kmf - o.cost_douane_kmf)::numeric / SUM(o.total_kmf)
          ELSE 0 END, 1) AS taux_marge_pct
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
      WHERE o.created_at >= NOW() - INTERVAL '1 day' * $1 AND o.status != 'cancelled'
      GROUP BY p.category ORDER BY ca_kmf DESC
    `, [period]);

    // ── Top 10 produits ─────────────────────────────────────────────────────
    const { rows: topProds } = await db.query(`
      SELECT p.name, p.category,
        SUM(oi.quantity) AS qty_vendue,
        SUM(oi.price_kmf * oi.quantity) AS revenue_kmf
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
      WHERE o.created_at >= NOW() - INTERVAL '1 day' * $1 AND o.status != 'cancelled'
      GROUP BY p.id, p.name, p.category
      ORDER BY revenue_kmf DESC LIMIT 10
    `, [period]);

    res.json({
      period,
      taux: rates,
      kpi: {
        ca_kmf:          Math.round(ca),
        ca_eur:          Math.round(ca / eur_kmf),
        nb_commandes:    nbCmd,
        nb_livrees:      Number(kpi.nb_livrees),
        nb_annulees:     Number(kpi.nb_annulees),
        panier_moyen_kmf: Math.round(Number(kpi.panier_moyen_kmf)),
        evolution: {
          ca_pct:  caPrev > 0 ? +((ca - caPrev) / caPrev * 100).toFixed(1) : null,
          cmd_pct: nbPrev > 0 ? +((nbCmd - nbPrev) / nbPrev * 100).toFixed(1) : null,
        },
      },
      paiements: {
        cash:  { count: Number(kpi.nb_cash),   total_kmf: Math.round(Number(kpi.ca_cash_kmf)) },
        stripe: { count: Number(kpi.nb_stripe), total_eur: +Number(kpi.ca_stripe_eur).toFixed(2) },
      },
      marges: {
        marge_reelle_kmf:    Math.round(marge),
        cout_logistique_kmf: Math.round(Number(kpi.cout_logistique_kmf)),
        taux_marge_pct:      ca > 0 && Number(kpi.nb_avec_cost) > 0 ? +(marge / ca * 100).toFixed(1) : null,
        nb_avec_cost:        Number(kpi.nb_avec_cost),
        nb_sans_cost:        Number(kpi.nb_sans_cost),
        alertes_perte:       perteRows.length > 0 ? { count: perteRows.length, refs: perteRows.map(r => r.reference) } : null,
      },
      par_categorie: catRows.map(r => ({
        categorie:    r.category,
        nb_commandes: Number(r.nb_commandes),
        ca_kmf:       Math.round(Number(r.ca_kmf)),
        marge_kmf:    Math.round(Number(r.marge_kmf)),
        taux_marge:   +Number(r.taux_marge_pct),
      })),
      top_produits: topProds.map(p => ({
        nom:       p.name,
        categorie: p.category,
        qty:       Number(p.qty_vendue),
        ca_kmf:    Math.round(Number(p.revenue_kmf)),
      })),
    });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET /pilotage — Vue stratégique coûts & marges (ex-pilotage.js)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/pilotage', async (req, res, next) => {
  try {
    const mois = req.query.mois || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mois)) {
      return res.status(400).json({ error: 'Format mois invalide (YYYY-MM attendu)' });
    }

    const cacheKey = 'pilotage_' + mois;
    const hit = cached(cacheKey);
    if (hit) return res.json(hit);

    const [annee, moisNum] = mois.split('-').map(Number);
    const debutMois = `${mois}-01`;
    const finMois   = new Date(annee, moisNum, 1).toISOString().split('T')[0];
    const rates     = await getEurKmf();

    // ── Volume & CA ─────────────────────────────────────────────────────────
    const { rows: [vol] } = await db.query(`
      SELECT
        COUNT(*) AS total_commandes,
        COUNT(*) FILTER (WHERE status = 'collected')  AS livrees,
        COUNT(*) FILTER (WHERE status = 'cancelled')  AS annulees,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled')) AS en_cours,
        COALESCE(SUM(total_kmf) FILTER (WHERE status != 'cancelled'), 0) AS ca_kmf,
        COALESCE(SUM(total_eur) FILTER (WHERE status != 'cancelled'), 0) AS ca_eur,
        COALESCE(SUM(total_kmf) FILTER (WHERE payment_mode = 'cash_relais' AND status != 'cancelled'), 0) AS ca_cash_kmf,
        COALESCE(SUM(total_kmf) FILTER (WHERE payment_mode = 'stripe_eur' AND status != 'cancelled'), 0) AS ca_stripe_kmf
      FROM orders WHERE created_at >= $1 AND created_at < $2
    `, [debutMois, finMois]);

    // ── CA par catégorie ────────────────────────────────────────────────────
    const { rows: catRows } = await db.query(`
      SELECT p.category, COUNT(oi.id) AS nb_articles, COUNT(DISTINCT oi.order_id) AS nb_commandes,
        COALESCE(SUM(oi.price_kmf * oi.quantity), 0) AS ca_kmf
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN orders o   ON o.id = oi.order_id
      WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status != 'cancelled'
      GROUP BY p.category ORDER BY nb_commandes DESC
    `, [debutMois, finMois]);

    // ── Taux douane effectif (depuis customs_effective_rates — ADR-001) ─────
    // Source de vérité = vue créée par migration 034 qui agrège les envois
    // customs_shipments actifs sur 30 / 90 / 365 jours.
    // Fallback en cascade : 30j → 90j → 365j → finance_config.customs_rate_default_pct
    let douaneEffectif = null;
    let douaneSource = null;
    try {
      const { rows } = await db.query(
        `SELECT period, rate_pct, nb_shipments
           FROM customs_effective_rates
          WHERE rate_pct > 0
          ORDER BY CASE period
                     WHEN 'last_30d'  THEN 1
                     WHEN 'last_90d'  THEN 2
                     WHEN 'last_365d' THEN 3
                   END
          LIMIT 1`
      );
      if (rows[0]?.rate_pct != null) {
        douaneEffectif = parseFloat(rows[0].rate_pct);
        douaneSource = rows[0].period;  // 'last_30d' | 'last_90d' | 'last_365d'
      }
    } catch { /* vue pas encore disponible — migration 034 non passée */ }

    // ── Pipeline du mois ────────────────────────────────────────────────────
    const { rows: pipelineRows } = await db.query(`
      SELECT status, COUNT(*) AS nb FROM orders WHERE status != 'cancelled' GROUP BY status ORDER BY nb DESC
    `);

    // ── Taux de change historique ───────────────────────────────────────────
    const { rows: ratesHistory } = await db.query(
      'SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC LIMIT 6'
    );

    const caKmf = parseFloat(vol.ca_kmf);
    // Variabilisé : priorité customs_effective_rates > finance_config > fallback
    const customsDefault = await getEcoVar('customs_rate_default_pct', 42); // pct
    const TAUX_TERRAIN = douaneEffectif ? douaneEffectif / 100 : customsDefault / 100;
    const hubCostAed = await getEcoVar('hub_monthly_cost_aed', 7000);
    const hubMensuelKmf = hubCostAed * rates.aed_kmf;

    const result = {
      periode: mois,
      genere_le: new Date().toISOString(),
      taux: rates,
      taux_history: ratesHistory,
      volume: {
        total: parseInt(vol.total_commandes), livrees: parseInt(vol.livrees),
        annulees: parseInt(vol.annulees), en_cours: parseInt(vol.en_cours),
      },
      ca: {
        total_kmf: Math.round(caKmf), total_eur: Math.round(parseFloat(vol.ca_eur)),
        cash_kmf: Math.round(parseFloat(vol.ca_cash_kmf)), stripe_kmf: Math.round(parseFloat(vol.ca_stripe_kmf)),
      },
      categories: catRows.map(r => ({
        categorie: r.category, nb_commandes: parseInt(r.nb_commandes),
        nb_articles: parseInt(r.nb_articles), ca_kmf: Math.round(parseFloat(r.ca_kmf)),
        pct_ca: caKmf > 0 ? +(parseFloat(r.ca_kmf) / caKmf * 100).toFixed(1) : 0,
      })),
      couts: {
        taux_terrain_pct: TAUX_TERRAIN * 100,
        source_taux: douaneSource || 'finance_config_fallback',
        hub_fixe_mensuel_kmf: Math.round(hubMensuelKmf),
      },
      pipeline: pipelineRows.map(r => ({ statut: r.status, nb: parseInt(r.nb) })),
    };
    setCache(cacheKey, result);
    res.json(result);
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GET /pipeline — Kanban commandes
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/pipeline', async (req, res, next) => {
  try {
    const hit = cached('pipeline');
    if (hit) return res.json(hit);

    const { rows } = await db.query(`
      SELECT o.id, o.reference, o.status, o.total_kmf,
        o.payment_mode, o.payment_status,
        o.created_at, o.ordered_at, o.shipped_at, o.available_at, o.collected_at, o.cancelled_at, o.updated_at,
        u.full_name AS client_name, u.phone AS client_phone,
        rc.full_name AS recipient_name, rc.phone AS recipient_phone,
        r.name AS relais_name,
        (SELECT p.name FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = o.id ORDER BY oi.created_at ASC LIMIT 1) AS product_name,
        (SELECT p.image_url FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = o.id ORDER BY oi.created_at ASC LIMIT 1) AS product_image_url,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id)::int AS items_count,
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS age_jours,
        EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 86400 AS inactif_jours
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      LEFT JOIN relais r ON r.id = o.relais_id
      ORDER BY o.created_at DESC
    `);

    const STAGES = ['confirmed','ordered','preparation','shipped','in_transit','available','collected','cancelled','refunded'];
    const pipeline = {};
    for (const s of STAGES) pipeline[s] = { count: 0, orders: [] };

    let active = 0;
    for (const order of rows) {
      if (pipeline[order.status]) {
        pipeline[order.status].count++;
        pipeline[order.status].orders.push(order);
      }
      if (!['collected','cancelled','refunded'].includes(order.status)) active++;
    }

    const result = { total: rows.length, active, pipeline };
    setCache('pipeline', result);
    res.json(result);
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GET /retards — Clients en retard + compensations
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/retards', async (req, res, next) => {
  try {
    const { niveau } = req.query;
    const cfg = await loadDashConfig();

    const { rows } = await db.query(`
      SELECT o.id, o.reference, o.status,
        COALESCE(p.recipient_name, u.full_name, rc.full_name) AS client_nom, COALESCE(p.recipient_phone, u.phone, rc.phone) AS client_phone,
        u.email AS client_email,
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS age_jours
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      WHERE o.status NOT IN ('collected','cancelled')
        AND EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 >= $1
      Order by age_jours DESC LIMIT 200
    `, [cfg.DELAY_PREVENTIF]);

    const parNiveau = {
      remboursement_possible:     { count: 0, label: 'Remboursement possible (8 sem+)' },
      remise_10pct_prochaine_cmd: { count: 0, label: 'Remise −10% prochaine commande' },
      avoir_5pct:                 { count: 0, label: 'Avoir 5% offert' },
      contact_preventif:          { count: 0, label: 'Contact préventif' },
    };

    const clients = rows.map(o => {
      const jours = Number(o.age_jours);
      let niv, comp, sms;
      if (jours >= cfg.DELAY_REMBOURSEMENT) {
        niv = 'remboursement_possible'; comp = niv;
        sms = `Bonjour ${o.client_nom || 'cher client'}, votre commande ${o.reference} accuse un retard important. Nous vous contactons pour trouver une solution. Komerce`;
      } else if (jours >= cfg.DELAY_REMISE) {
        niv = 'remise_10pct_prochaine_cmd'; comp = niv;
        sms = `Komerce : Nous nous excusons pour le délai sur ${o.reference}. En compensation, bénéficiez de −10% sur votre prochaine commande.`;
      } else if (jours >= cfg.DELAY_AVOIR) {
        niv = 'avoir_5pct'; comp = niv;
        sms = `Komerce : Votre commande ${o.reference} prend plus de temps que prévu. Nous vous offrons un avoir de 5%.`;
      } else {
        niv = 'contact_preventif'; comp = niv;
        sms = `Komerce : Votre commande ${o.reference} est en cours de traitement. Nous vous tenons informé dès que votre colis est expédié.`;
      }
      parNiveau[niv].count++;
      return {
        reference: o.reference, status: o.status,
        client_nom: o.client_nom, client_phone: o.client_phone, client_email: o.client_email,
        jours_retard: Math.round(jours), compensation: comp, sms_suggere: sms, _niv: niv,
      };
    }).filter(o => !niveau || o._niv === niveau).map(({ _niv, ...rest }) => rest);

    res.json({ total: clients.length, par_niveau: parNiveau, clients });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GET /forecast — Projections CA/marge
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/forecast', async (req, res, next) => {
  try {
    const { target_date, ref_period = 30 } = req.query;
    if (!target_date) return res.status(400).json({ error: 'target_date obligatoire (YYYY-MM-DD)' });

    const targetDt = new Date(target_date);
    const today    = new Date();
    if (isNaN(targetDt.getTime()) || targetDt <= today) {
      return res.status(400).json({ error: 'target_date doit être dans le futur' });
    }

    const daysRemaining = Math.ceil((targetDt - today) / 86400000);
    const refPeriod     = Math.max(1, Math.min(365, parseInt(ref_period)));

    const { rows: statsRows } = await db.query(`
      SELECT created_at::date AS jour, SUM(total_kmf) AS ca_jour
      FROM orders WHERE status != 'cancelled' AND created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY 1 ORDER BY 1
    `, [refPeriod]);

    const dailyCAs = statsRows.map(r => Number(r.ca_jour));
    const nbDays   = dailyCAs.length || 1;
    const avgCA    = dailyCAs.reduce((s, v) => s + v, 0) / nbDays;
    const stddev   = Math.sqrt(dailyCAs.reduce((s, v) => s + Math.pow(v - avgCA, 2), 0) / nbDays);

    const { rows: [realise] } = await db.query(`
      SELECT COALESCE(SUM(total_kmf), 0) AS ca_kmf
      FROM orders WHERE status != 'cancelled' AND created_at >= DATE_TRUNC('month', NOW())
    `);
    const caRealise = Number(realise.ca_kmf);

    res.json({
      target_date, days_remaining: daysRemaining,
      realise_kmf: Math.round(caRealise),
      modele: { ref_period_jours: refPeriod, avg_ca_jour: Math.round(avgCA), stddev: Math.round(stddev) },
      projection: {
        pessimiste: Math.round(caRealise + daysRemaining * Math.max(0, avgCA - stddev)),
        attendu:    Math.round(caRealise + daysRemaining * avgCA),
        optimiste:  Math.round(caRealise + daysRemaining * (avgCA + stddev)),
      },
    });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. GET /clients — Analyse comportement clients (v2)
//
// IDENTITÉ CLIENT : on regroupe par (phone, name) en COALESCE des sources :
//   - users (si user_id rempli sur la commande)
//   - recipients (si recipient_id rempli)
// Cette stratégie est nécessaire car beaucoup de commandes n'ont pas de user_id
// (clients invités sans compte).
//
// SEGMENTATION:
//   - new       : 1 commande, < 30j depuis première commande
//   - recurrent : ≥ 2 commandes, dernière < 90j
//   - vip       : LTV ≥ seuil_vip (default 200 000 KMF) ou ≥ 5 commandes
//   - at_risk   : ≥ 2 commandes ANCIENNES, silencieux > 60j (perdu potentiel)
//   - dormant   : silencieux > 180j (probablement perdu)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/clients', async (req, res, next) => {
  try {
    const top   = Math.min(50, Math.max(1, parseInt(req.query.top) || 20));
    const debut = req.query.debut || '2024-01-01';
    const fin   = req.query.fin   || new Date().toISOString().split('T')[0];
    const finExcl = new Date(new Date(fin).getTime() + 86400000).toISOString().split('T')[0];
    const seuilVipKmf = parseInt(req.query.vip_threshold || '200000');

    const cacheKey = `clients_v2_${debut}_${fin}_${top}_${seuilVipKmf}`;
    const hit = cached(cacheKey);
    if (hit) return res.json(hit);

    // Sous-requête commune : identifier le client par (phone, name) en COALESCE
    // Si user_id présent → users.phone/full_name ; sinon recipients.phone/full_name
    const clientIdentitySql = `
      SELECT
        o.id              AS order_id,
        o.user_id,
        o.recipient_id,
        o.relais_id,
        o.total_kmf,
        o.status,
        o.created_at,
        o.payment_mode,
        COALESCE(u.phone, r.phone)         AS client_phone,
        COALESCE(u.full_name, r.full_name) AS client_name
      FROM orders o
      LEFT JOIN users u      ON u.id = o.user_id
      LEFT JOIN recipients r ON r.id = o.recipient_id
    `;

    const [kpiRes, topClientsRes, topProdsRes, relaisRes, evoRes,
           segmentationRes, atRiskRes, vipRes] = await Promise.all([

      // ── KPI globaux ──
      db.query(`
        WITH oc AS (${clientIdentitySql} WHERE o.created_at >= $1 AND o.created_at < $2)
        SELECT
          COUNT(DISTINCT (oc.client_phone, oc.client_name)) FILTER (
            WHERE oc.client_phone IS NOT NULL
          ) AS nb_clients,
          COUNT(DISTINCT oc.order_id) FILTER (WHERE oc.status NOT IN ('cancelled','refunded')) AS commandes_valides,
          COALESCE(SUM(oc.total_kmf) FILTER (WHERE oc.status NOT IN ('cancelled','refunded')), 0) AS ca_kmf,
          COALESCE(AVG(oc.total_kmf) FILTER (WHERE oc.status NOT IN ('cancelled','refunded')), 0) AS panier_moyen,
          COUNT(DISTINCT (oc.client_phone, oc.client_name)) FILTER (
            WHERE oc.client_phone IN (
              SELECT client_phone FROM (${clientIdentitySql}) inner_oc
              GROUP BY client_phone, client_name
              HAVING COUNT(*) >= 2
            )
          ) AS clients_recurrents
        FROM oc
      `, [debut, finExcl]),

      // ── Top clients par CA (via clé phone+name) ──
      db.query(`
        WITH oc AS (${clientIdentitySql})
        SELECT
          oc.client_name AS name,
          oc.client_phone AS phone,
          COUNT(*) AS nb_commandes,
          COALESCE(SUM(oc.total_kmf) FILTER (WHERE oc.status NOT IN ('cancelled','refunded')), 0) AS ca_kmf,
          MAX(oc.created_at) AS derniere_commande,
          MIN(oc.created_at) AS premiere_commande
        FROM oc
        WHERE oc.created_at >= $1 AND oc.created_at < $2
          AND oc.client_phone IS NOT NULL
        GROUP BY oc.client_phone, oc.client_name
        ORDER BY ca_kmf DESC LIMIT $3
      `, [debut, finExcl, top]),

      // ── Top produits ──
      db.query(`
        SELECT p.name, p.category, SUM(oi.quantity) AS qty,
          COUNT(DISTINCT oi.order_id) AS nb_commandes,
          COALESCE(SUM(oi.price_kmf * oi.quantity), 0) AS ca_kmf
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status NOT IN ('cancelled','refunded')
        GROUP BY p.id, p.name, p.category ORDER BY qty DESC LIMIT $3
      `, [debut, finExcl, top]),

      // ── Par relais ──
      db.query(`
        SELECT r.name AS relais, r.island,
          COUNT(DISTINCT o.id) AS nb_commandes,
          COALESCE(SUM(o.total_kmf) FILTER (WHERE o.status NOT IN ('cancelled','refunded')), 0) AS ca_kmf,
          COUNT(*) FILTER (WHERE o.status = 'collected') AS livrees
        FROM orders o JOIN relais r ON r.id = o.relais_id
        WHERE o.created_at >= $1 AND o.created_at < $2
        GROUP BY r.id, r.name, r.island ORDER BY ca_kmf DESC
      `, [debut, finExcl]),

      // ── Évolution mensuelle ──
      db.query(`
        WITH oc AS (${clientIdentitySql})
        SELECT TO_CHAR(DATE_TRUNC('month', oc.created_at), 'YYYY-MM') AS mois,
          COUNT(DISTINCT oc.order_id) AS nb_commandes,
          COUNT(DISTINCT (oc.client_phone, oc.client_name)) FILTER (WHERE oc.client_phone IS NOT NULL) AS nb_clients,
          COALESCE(SUM(oc.total_kmf) FILTER (WHERE oc.status NOT IN ('cancelled','refunded')), 0) AS ca_kmf
        FROM oc
        WHERE oc.created_at >= $1 AND oc.created_at < $2
        GROUP BY 1 ORDER BY 1 ASC
      `, [debut, finExcl]),

      // ── Segmentation des clients (sur TOUTE l'histoire, pas filtré par période) ──
      // Pour avoir une photo réaliste : "qui sont mes clients en ce moment ?"
      db.query(`
        WITH oc AS (${clientIdentitySql} WHERE o.status NOT IN ('cancelled','refunded')),
        client_agg AS (
          SELECT
            client_phone, client_name,
            COUNT(*) AS nb_orders,
            SUM(total_kmf) AS ltv_kmf,
            MIN(created_at) AS first_order,
            MAX(created_at) AS last_order,
            EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS days_since_last
          FROM oc
          WHERE client_phone IS NOT NULL
          GROUP BY client_phone, client_name
        )
        SELECT
          COUNT(*) FILTER (WHERE nb_orders = 1 AND days_since_last <= 30)              AS nb_new,
          COUNT(*) FILTER (WHERE nb_orders >= 2 AND days_since_last <= 90)             AS nb_recurrent,
          COUNT(*) FILTER (WHERE (ltv_kmf >= $1 OR nb_orders >= 5) AND days_since_last <= 180) AS nb_vip,
          COUNT(*) FILTER (WHERE nb_orders >= 2 AND days_since_last > 60 AND days_since_last <= 180) AS nb_at_risk,
          COUNT(*) FILTER (WHERE days_since_last > 180)                                AS nb_dormant,
          COUNT(*)                                                                      AS nb_total
        FROM client_agg
      `, [seuilVipKmf]),

      // ── Clients à risque (silencieux 60-180j ET ≥2 commandes historiques) ──
      // Le pire scénario : un VIP qui ne commande plus
      db.query(`
        WITH oc AS (${clientIdentitySql} WHERE o.status NOT IN ('cancelled','refunded'))
        SELECT
          client_phone AS phone,
          client_name AS name,
          COUNT(*) AS nb_commandes,
          SUM(total_kmf) AS ltv_kmf,
          MAX(created_at) AS derniere_commande,
          EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS jours_silence
        FROM oc
        WHERE client_phone IS NOT NULL
        GROUP BY client_phone, client_name
        HAVING COUNT(*) >= 2
           AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int BETWEEN 60 AND 180
        ORDER BY ltv_kmf DESC
        LIMIT 30
      `),

      // ── VIP actifs (LTV >= seuil OU ≥5 commandes, et actif <= 180j) ──
      db.query(`
        WITH oc AS (${clientIdentitySql} WHERE o.status NOT IN ('cancelled','refunded'))
        SELECT
          client_phone AS phone,
          client_name AS name,
          COUNT(*) AS nb_commandes,
          SUM(total_kmf) AS ltv_kmf,
          MAX(created_at) AS derniere_commande,
          EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS jours_silence
        FROM oc
        WHERE client_phone IS NOT NULL
        GROUP BY client_phone, client_name
        HAVING (SUM(total_kmf) >= $1 OR COUNT(*) >= 5)
           AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int <= 180
        ORDER BY ltv_kmf DESC
        LIMIT 20
      `, [seuilVipKmf]),
    ]);

    const kpi = kpiRes.rows[0];
    const nbClients = parseInt(kpi.nb_clients);
    const seg = segmentationRes.rows[0];

    const result = {
      periode: { debut, fin, vip_threshold_kmf: seuilVipKmf },
      kpi: {
        nb_clients:         nbClients,
        commandes_valides:  parseInt(kpi.commandes_valides),
        ca_total_kmf:       Math.round(parseFloat(kpi.ca_kmf)),
        panier_moyen_kmf:   Math.round(parseFloat(kpi.panier_moyen)),
        clients_recurrents: parseInt(kpi.clients_recurrents),
        taux_recurrence_pct: nbClients > 0 ? +(parseInt(kpi.clients_recurrents) / nbClients * 100).toFixed(1) : 0,
      },
      // NEW : segmentation globale (photo actuelle)
      segments: {
        nb_total:     parseInt(seg.nb_total),
        new:          parseInt(seg.nb_new),
        recurrent:    parseInt(seg.nb_recurrent),
        vip:          parseInt(seg.nb_vip),
        at_risk:      parseInt(seg.nb_at_risk),
        dormant:      parseInt(seg.nb_dormant),
      },
      // NEW : clients à risque (le plus important — tes "perdus en cours")
      at_risk_clients: atRiskRes.rows.map(c => ({
        name: c.name, phone: c.phone,
        nb_commandes: parseInt(c.nb_commandes),
        ltv_kmf: Math.round(parseFloat(c.ltv_kmf)),
        derniere_commande: c.derniere_commande,
        jours_silence: parseInt(c.jours_silence),
      })),
      // NEW : VIP actifs
      vip_clients: vipRes.rows.map(c => ({
        name: c.name, phone: c.phone,
        nb_commandes: parseInt(c.nb_commandes),
        ltv_kmf: Math.round(parseFloat(c.ltv_kmf)),
        derniere_commande: c.derniere_commande,
        jours_silence: parseInt(c.jours_silence),
      })),
      top_clients: topClientsRes.rows.map(c => ({
        name: c.name, phone: c.phone,
        nb_commandes: parseInt(c.nb_commandes),
        ca_kmf: Math.round(parseFloat(c.ca_kmf)),
        derniere_commande: c.derniere_commande,
        premiere_commande: c.premiere_commande,
      })),
      top_produits: topProdsRes.rows.map(p => ({
        name: p.name, categorie: p.category, qty: parseInt(p.qty),
        nb_commandes: parseInt(p.nb_commandes), ca_kmf: Math.round(parseFloat(p.ca_kmf)),
      })),
      par_relais: relaisRes.rows.map(r => ({
        relais: r.relais, ile: r.island, nb_commandes: parseInt(r.nb_commandes),
        ca_kmf: Math.round(parseFloat(r.ca_kmf)), livrees: parseInt(r.livrees),
      })),
      evolution: evoRes.rows,
    };
    setCache(cacheKey, result);
    res.json(result);
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7b. GET /clients/list — Liste paginée + recherche + filtres
// Query params: page, page_size, search, segment, island
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/clients/list', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(req.query.page_size) || 25));
    const offset = (page - 1) * pageSize;
    const search = (req.query.search || '').trim();
    const segment = req.query.segment || 'all';  // all | new | recurrent | vip | at_risk | dormant
    const island = req.query.island || null;
    const seuilVipKmf = parseInt(req.query.vip_threshold || '200000');

    // ── Construction dynamique des paramètres SQL ──
    // FIX 25/04/2026 : params démarrait avec [seuilVipKmf] = $1 même si aucune
    // clause ne l'utilisait, ce qui donnait l'erreur Postgres :
    //   "bind message supplies 1 parameters, but prepared statement requires 0"
    // Solution : params commence VIDE, on ajoute uniquement les paramètres
    // effectivement référencés par les clauses actives.
    const havingClauses = [];
    const params = [];

    // Filtre search (LIKE sur name + phone)
    let searchClauseSql = '';
    if (search) {
      params.push('%' + search.toLowerCase() + '%');
      const idx = params.length;
      searchClauseSql = `(LOWER(client_name) LIKE $${idx} OR LOWER(client_phone) LIKE $${idx})`;
      havingClauses.push(searchClauseSql);
    }

    // Filtre segment
    if (segment === 'new') {
      havingClauses.push(`COUNT(*) = 1 AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int <= 30`);
    } else if (segment === 'recurrent') {
      havingClauses.push(`COUNT(*) >= 2 AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int <= 90`);
    } else if (segment === 'vip') {
      // VIP = LTV >= seuil OU >= 5 commandes, et actif <= 180j
      params.push(seuilVipKmf);
      const idx = params.length;
      havingClauses.push(`(SUM(total_kmf) >= $${idx} OR COUNT(*) >= 5) AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int <= 180`);
    } else if (segment === 'at_risk') {
      havingClauses.push(`COUNT(*) >= 2 AND EXTRACT(DAY FROM NOW() - MAX(created_at))::int BETWEEN 60 AND 180`);
    } else if (segment === 'dormant') {
      havingClauses.push(`EXTRACT(DAY FROM NOW() - MAX(created_at))::int > 180`);
    }

    const havingSql = havingClauses.length ? 'HAVING ' + havingClauses.join(' AND ') : '';

    // Filtre island
    let islandClauseSql = '';
    if (island) {
      params.push(island);
      const idx = params.length;
      islandClauseSql = `AND rl.island = $${idx}`;
    }

    const sql = `
      WITH oc AS (
        SELECT
          o.id AS order_id, o.total_kmf, o.status, o.created_at, o.relais_id,
          COALESCE(u.phone, r.phone) AS client_phone,
          COALESCE(u.full_name, r.full_name) AS client_name
        FROM orders o
        LEFT JOIN users u      ON u.id = o.user_id
        LEFT JOIN recipients r ON r.id = o.recipient_id
        LEFT JOIN relais rl    ON rl.id = o.relais_id
        WHERE o.status NOT IN ('cancelled','refunded')
          AND COALESCE(u.phone, r.phone) IS NOT NULL
          ${islandClauseSql}
      )
      SELECT
        client_phone AS phone,
        client_name AS name,
        COUNT(*) AS nb_commandes,
        SUM(total_kmf) AS ltv_kmf,
        AVG(total_kmf) AS panier_moyen_kmf,
        MIN(created_at) AS premiere_commande,
        MAX(created_at) AS derniere_commande,
        EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS jours_silence
      FROM oc
      GROUP BY client_phone, client_name
      ${havingSql}
      ORDER BY ltv_kmf DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    // Compter le total
    const countSql = `
      WITH oc AS (
        SELECT
          o.id AS order_id, o.total_kmf, o.status, o.created_at,
          COALESCE(u.phone, r.phone) AS client_phone,
          COALESCE(u.full_name, r.full_name) AS client_name
        FROM orders o
        LEFT JOIN users u      ON u.id = o.user_id
        LEFT JOIN recipients r ON r.id = o.recipient_id
        LEFT JOIN relais rl    ON rl.id = o.relais_id
        WHERE o.status NOT IN ('cancelled','refunded')
          AND COALESCE(u.phone, r.phone) IS NOT NULL
          ${islandClauseSql}
      ),
      grouped AS (
        SELECT client_phone, client_name, COUNT(*) AS cnt, SUM(total_kmf) AS ltv, MAX(created_at) AS last_o
        FROM oc GROUP BY client_phone, client_name
        ${havingSql}
      )
      SELECT COUNT(*)::int AS total FROM grouped
    `;

    const [listRes, countRes] = await Promise.all([
      db.query(sql, params),
      db.query(countSql, params),
    ]);

    res.json({
      page, page_size: pageSize,
      total: countRes.rows[0].total,
      total_pages: Math.ceil(countRes.rows[0].total / pageSize),
      filters: { search, segment, island, vip_threshold_kmf: seuilVipKmf },
      clients: listRes.rows.map(c => ({
        name: c.name, phone: c.phone,
        nb_commandes: parseInt(c.nb_commandes),
        ltv_kmf: Math.round(parseFloat(c.ltv_kmf)),
        panier_moyen_kmf: Math.round(parseFloat(c.panier_moyen_kmf)),
        premiere_commande: c.premiere_commande,
        derniere_commande: c.derniere_commande,
        jours_silence: parseInt(c.jours_silence),
      })),
    });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7c. GET /clients/detail — Fiche d'un client par téléphone
// Query: ?phone=XXX (obligatoire)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/clients/detail', async (req, res, next) => {
  try {
    const phone = (req.query.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone parameter required' });

    const [profileRes, ordersRes, productsRes] = await Promise.all([
      // Profil agrégé
      db.query(`
        WITH oc AS (
          SELECT
            o.id, o.total_kmf, o.status, o.created_at, o.payment_mode, o.relais_id,
            COALESCE(u.phone, r.phone) AS client_phone,
            COALESCE(u.full_name, r.full_name) AS client_name,
            u.email AS client_email,
            u.country AS country
          FROM orders o
          LEFT JOIN users u      ON u.id = o.user_id
          LEFT JOIN recipients r ON r.id = o.recipient_id
        )
        SELECT
          MAX(client_name) AS name,
          client_phone AS phone,
          MAX(client_email) AS email,
          MAX(country) AS country,
          COUNT(*) AS nb_orders_total,
          COUNT(*) FILTER (WHERE status NOT IN ('cancelled','refunded')) AS nb_orders_valid,
          COUNT(*) FILTER (WHERE status IN ('cancelled','refunded')) AS nb_orders_cancelled,
          COALESCE(SUM(total_kmf) FILTER (WHERE status NOT IN ('cancelled','refunded')), 0) AS ltv_kmf,
          COALESCE(AVG(total_kmf) FILTER (WHERE status NOT IN ('cancelled','refunded')), 0) AS panier_moyen_kmf,
          MIN(created_at) AS premiere_commande,
          MAX(created_at) AS derniere_commande,
          EXTRACT(DAY FROM NOW() - MAX(created_at))::int AS jours_silence
        FROM oc
        WHERE client_phone = $1
        GROUP BY client_phone
      `, [phone]),

      // Liste des commandes
      db.query(`
        SELECT
          o.id, o.reference, o.total_kmf, o.status, o.payment_mode,
          o.created_at, o.collected_at, o.cancelled_at,
          rl.name AS relais_name, rl.island
        FROM orders o
        LEFT JOIN users u      ON u.id = o.user_id
        LEFT JOIN recipients r ON r.id = o.recipient_id
        LEFT JOIN relais rl    ON rl.id = o.relais_id
        WHERE COALESCE(u.phone, r.phone) = $1
        ORDER BY o.created_at DESC
        LIMIT 100
      `, [phone]),

      // Top produits du client
      db.query(`
        SELECT p.name, p.category,
          SUM(oi.quantity) AS qty,
          COALESCE(SUM(oi.price_kmf * oi.quantity), 0) AS total_kmf,
          COUNT(DISTINCT oi.order_id) AS nb_orders
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN users u      ON u.id = o.user_id
        LEFT JOIN recipients r ON r.id = o.recipient_id
        WHERE COALESCE(u.phone, r.phone) = $1
          AND o.status NOT IN ('cancelled','refunded')
        GROUP BY p.id, p.name, p.category
        ORDER BY qty DESC
        LIMIT 20
      `, [phone]),
    ]);

    if (!profileRes.rows.length) {
      return res.status(404).json({ error: 'Client not found', phone });
    }

    const p = profileRes.rows[0];
    res.json({
      profile: {
        name: p.name,
        phone: p.phone,
        email: p.email,
        country: p.country,
        nb_orders_total: parseInt(p.nb_orders_total),
        nb_orders_valid: parseInt(p.nb_orders_valid),
        nb_orders_cancelled: parseInt(p.nb_orders_cancelled),
        ltv_kmf: Math.round(parseFloat(p.ltv_kmf)),
        panier_moyen_kmf: Math.round(parseFloat(p.panier_moyen_kmf)),
        premiere_commande: p.premiere_commande,
        derniere_commande: p.derniere_commande,
        jours_silence: parseInt(p.jours_silence),
      },
      orders: ordersRes.rows.map(o => ({
        id: o.id,
        reference: o.reference,
        total_kmf: o.total_kmf,
        status: o.status,
        payment_mode: o.payment_mode,
        created_at: o.created_at,
        collected_at: o.collected_at,
        cancelled_at: o.cancelled_at,
        relais: o.relais_name,
        ile: o.island,
      })),
      top_products: productsRes.rows.map(p => ({
        name: p.name, categorie: p.category,
        qty: parseInt(p.qty),
        total_kmf: Math.round(parseFloat(p.total_kmf)),
        nb_orders: parseInt(p.nb_orders),
      })),
    });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. GET /history — Historique mensuel (graphiques)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/history', async (req, res, next) => {
  try {
    const nbMois = Math.min(24, Math.max(1, parseInt(req.query.mois) || 6));
    const rates  = await getEurKmf();

    const { rows } = await db.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS mois,
        COUNT(*) AS total_commandes,
        COUNT(*) FILTER (WHERE status = 'collected') AS livrees,
        COALESCE(SUM(total_kmf) FILTER (WHERE status != 'cancelled'), 0) AS ca_kmf,
        COALESCE(SUM(total_eur) FILTER (WHERE status != 'cancelled'), 0) AS ca_eur
      FROM orders WHERE created_at >= NOW() - ($1 || ' months')::INTERVAL
      GROUP BY 1 ORDER BY 1 ASC
    `, [nbMois]);

    res.json({
      nb_mois: nbMois, taux: rates,
      history: rows.map(r => ({
        mois: r.mois,
        total_commandes: parseInt(r.total_commandes),
        livrees: parseInt(r.livrees),
        ca_kmf: Math.round(parseFloat(r.ca_kmf)),
        ca_eur: Math.round(parseFloat(r.ca_eur)),
      })),
    });
  } catch(err) { next(err); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// 9. GET /hub-dubai — Operations Hub Dubai — COLIS-CENTRIC
//    Le hub manipule des COLIS, pas des commandes.
//    3 zones : commandes à optimiser → colis à emballer → colis à expédier
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/hub-dubai', async (req, res, next) => {
  try {
    const hit = cached('hub-dubai');
    if (hit) return res.json(hit);

    // 1. Commandes sans colis (en attente d'optimisation)
    const { rows: ordersToOptimize } = await db.query(`
      SELECT o.id, o.reference, o.status, o.total_kmf, o.created_at,
        u.full_name AS client_nom,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id)::int AS nb_articles,
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS jours
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.status IN ('confirmed', 'ordered')
        AND NOT EXISTS (SELECT 1 FROM parcels p2 WHERE p2.order_id = o.id AND p2.status != 'cancelled')
      ORDER BY o.created_at ASC
    `);

    // 2. Colis actifs au hub (draft, preparation, shipped)
    const { rows: parcels } = await db.query(`
      SELECT p.id, p.reference, p.status, p.type, p.weight_kg, p.items_count,
        p.created_at, p.external_code, p.seal_code,
        o.id AS order_id, o.reference AS order_reference, o.total_kmf AS order_total_kmf,
        u.full_name AS client_nom,
        EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400 AS jours
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE p.status IN ('draft', 'preparation', 'shipped')
      ORDER BY p.created_at ASC
    `);

    // 3. Contenu des colis (parcel_items)
    const parcelIds = parcels.map(p => p.id);
    const itemsMap = {};
    if (parcelIds.length > 0) {
      const { rows: items } = await db.query(`
        SELECT pi.parcel_id, pr.name AS nom, pi.quantity AS quantite,
          oi.price_kmf AS prix_kmf, pr.stock,
          CASE
            WHEN pr.is_active = FALSE THEN 'annule'
            WHEN pr.stock IS NOT NULL AND pr.stock <= 0 THEN 'hors_stock'
            WHEN pr.stock IS NOT NULL AND pr.stock > 0 THEN 'complet'
            ELSE 'en_attente'
          END AS stock_status
        FROM parcel_items pi
        JOIN order_items oi ON oi.id = pi.order_item_id
        JOIN products pr ON pr.id = oi.product_id
        WHERE pi.parcel_id = ANY($1)
      `, [parcelIds]);
      for (const item of items) {
        if (!itemsMap[item.parcel_id]) itemsMap[item.parcel_id] = [];
        itemsMap[item.parcel_id].push({
          nom: item.nom,
          quantite: Number(item.quantite),
          prix_kmf: Number(item.prix_kmf),
          stock_status: item.stock_status,
        });
      }
    }

    function toHubParcel(p) {
      const jours = Math.round(Number(p.jours));
      return {
        id: p.id,
        reference: p.reference,
        status: p.status,
        type: p.type,
        weight_kg: p.weight_kg ? Number(p.weight_kg) : null,
        items_count: Number(p.items_count || 0),
        external_code: p.external_code,
        seal_code: p.seal_code,
        order_id: p.order_id,
        order_reference: p.order_reference,
        order_total_kmf: Number(p.order_total_kmf),
        client_nom: p.client_nom || 'Client',
        produits: itemsMap[p.id] || [],
        date_creation: p.created_at,
        jours,
        priorite: jours > 7 ? 'urgente' : 'normale',
      };
    }

    const result = {
      a_optimiser: ordersToOptimize.map(o => ({
        id: o.id,
        reference: o.reference,
        status: o.status,
        total_kmf: Number(o.total_kmf),
        client_nom: o.client_nom || 'Client',
        nb_articles: Number(o.nb_articles),
        date_commande: o.created_at,
        jours: Math.round(Number(o.jours)),
      })),
      a_emballer: parcels.filter(p => ['draft', 'preparation'].includes(p.status)).map(toHubParcel),
      a_expedier: parcels.filter(p => p.status === 'shipped').map(toHubParcel),
      kpi: {
        a_optimiser: ordersToOptimize.length,
        a_emballer: parcels.filter(p => ['draft', 'preparation'].includes(p.status)).length,
        a_expedier: parcels.filter(p => p.status === 'shipped').length,
        total_poids_kg: Math.round(parcels.reduce((s, p) => s + (p.weight_kg ? Number(p.weight_kg) : 0), 0) * 10) / 10,
      },
    };

    setCache('hub-dubai', result);
    res.json(result);
  } catch(err) { next(err); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// 10. GET /relais — Operations Relais — COLIS-CENTRIC
//     Le relais reçoit et remet des COLIS, pas des commandes.
//     2 zones : colis en transit → colis à remettre
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/relais', async (req, res, next) => {
  try {
    const hit = cached('relais');
    if (hit) return res.json(hit);

    // Colis au stade relais
    const { rows: parcels } = await db.query(`
      SELECT p.id, p.reference, p.status, p.type, p.weight_kg,
        p.external_code, p.seal_code, p.pickup_code, p.items_count,
        p.created_at, p.updated_at,
        o.id AS order_id, o.reference AS order_reference,
        o.total_kmf AS order_total_kmf,
        o.payment_mode, o.payment_status,
        COALESCE(p.recipient_name, u.full_name, rc.full_name) AS client_nom, COALESCE(p.recipient_phone, u.phone, rc.phone) AS client_phone,
        r.name AS relais_nom, r.island AS ile,
        COALESCE(EXTRACT(EPOCH FROM (NOW() - COALESCE(p.updated_at, p.created_at))) / 3600, 0) AS heures_attente
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE p.status IN ('in_transit', 'available')
      ORDER BY p.updated_at ASC NULLS LAST, p.created_at ASC
    `);

    // Contenu des colis
    const parcelIds = parcels.map(p => p.id);
    const itemsMap = {};
    if (parcelIds.length > 0) {
      const { rows: items } = await db.query(`
        SELECT pi.parcel_id, pr.name AS nom, pi.quantity AS quantite,
          oi.price_kmf AS prix_kmf
        FROM parcel_items pi
        JOIN order_items oi ON oi.id = pi.order_item_id
        JOIN products pr ON pr.id = oi.product_id
        WHERE pi.parcel_id = ANY($1)
      `, [parcelIds]);
      for (const item of items) {
        if (!itemsMap[item.parcel_id]) itemsMap[item.parcel_id] = [];
        itemsMap[item.parcel_id].push({
          nom: item.nom,
          quantite: Number(item.quantite),
          prix_kmf: Number(item.prix_kmf),
        });
      }
    }

    function toRelaisParcel(p) {
      const heures = Math.round(Number(p.heures_attente));
      return {
        id: p.id,
        reference: p.reference,
        status: p.status,
        type: p.type,
        weight_kg: p.weight_kg ? Number(p.weight_kg) : null,
        external_code: p.external_code,
        seal_code: p.seal_code,
        pickup_code: p.pickup_code,
        items_count: Number(p.items_count || 0),
        order_id: p.order_id,
        order_reference: p.order_reference,
        order_total_kmf: Number(p.order_total_kmf),
        client_nom: p.client_nom || 'Client',
        client_phone: p.client_phone || '',
        produits: itemsMap[p.id] || [],
        payment_mode: p.payment_mode === 'stripe_eur' ? 'stripe' : 'cash_relais',
        payment_status: p.payment_status === 'paid' ? 'paid' : 'pending',
        relais_nom: p.relais_nom || 'Relais inconnu',
        ile: p.ile || 'Comores',
        heures_attente: heures,
        priorite: heures > 120 ? 'urgente' : 'normale',
      };
    }

    const result = {
      en_transit: parcels.filter(p => p.status === 'in_transit').map(toRelaisParcel),
      a_remettre: parcels.filter(p => p.status === 'available').map(toRelaisParcel),
      kpi: {
        en_transit: parcels.filter(p => p.status === 'in_transit').length,
        a_remettre: parcels.filter(p => p.status === 'available').length,
        cash_pending: parcels.filter(p => p.status === 'available' && p.payment_mode === 'cash_relais' && p.payment_status !== 'paid').length,
      },
    };

    setCache('relais', result);
    res.json(result);
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. GET /annulations-parcels — KPIs Annulations & Expéditions Partielles
//     Phase 5.2 — Indicateurs annulations/partielles dans vues Ops/Finance
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/annulations-parcels', async (req, res, next) => {
  try {
    const hit = cached('annulations-parcels');
    if (hit) return res.json(hit);

    const period = Math.max(1, Math.min(365, parseInt(req.query.period) || 30));

    // ── Annulations ─────────────────────────────────────────────────────────
    const { rows: [annulKpi] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'cancelled'
          AND created_at >= NOW() - INTERVAL '1 day' * $1)                  AS nb_annulees,
        COUNT(*) FILTER (WHERE status != 'cancelled'
          AND created_at >= NOW() - INTERVAL '1 day' * $1)                  AS nb_actives,
        COUNT(*) FILTER (WHERE status = 'cancelled'
          AND cancelled_at >= NOW() - INTERVAL '7 days')                    AS annulees_7j,
        COUNT(*) FILTER (WHERE status = 'cancelled'
          AND cancelled_at >= NOW() - INTERVAL '30 days')                   AS annulees_30j,
        COUNT(*) FILTER (WHERE status = 'refunded'
          AND created_at >= NOW() - INTERVAL '1 day' * $1)                  AS nb_refunded
      FROM orders
    `, [period]);

    const nbAnnulees = Number(annulKpi.nb_annulees);
    const nbActives  = Number(annulKpi.nb_actives);
    const total      = nbAnnulees + nbActives;
    const tauxAnnulation = total > 0 ? +(nbAnnulees / total * 100).toFixed(1) : 0;

    // ── Remboursements ──────────────────────────────────────────────────────
    const { rows: [remb] } = await db.query(`
      SELECT
        COALESCE(SUM(amount_kmf), 0)                                           AS total_kmf,
        COALESCE(SUM(amount_eur), 0)                                           AS total_eur,
        COALESCE(SUM(amount_kmf) FILTER (WHERE refund_method = 'stripe'), 0)   AS stripe_kmf,
        COALESCE(SUM(amount_eur) FILTER (WHERE refund_method = 'stripe'), 0)   AS stripe_eur,
        COALESCE(SUM(amount_kmf) FILTER (WHERE refund_method = 'store_credit'), 0) AS credit_kmf,
        COUNT(*)                                                               AS nb_refunds,
        COUNT(*) FILTER (WHERE refund_method = 'stripe')                       AS nb_stripe,
        COUNT(*) FILTER (WHERE refund_method = 'store_credit')                 AS nb_credit
      FROM refunds
      WHERE completed_at >= NOW() - INTERVAL '1 day' * $1
    `, [period]);

    // ── Crédits boutique actifs ─────────────────────────────────────────────
    const { rows: [credits] } = await db.query(`
      SELECT
        COALESCE(SUM(remaining_kmf), 0) AS total_actif_kmf,
        COUNT(*)                        AS nb_credits_actifs
      FROM store_credits
      WHERE remaining_kmf > 0 AND (expires_at IS NULL OR expires_at > NOW())
    `);

    // ── Raisons d'annulation ────────────────────────────────────────────────
    const { rows: raisonsRows } = await db.query(`
      SELECT COALESCE(cancel_reason, 'Non spécifiée') AS raison, COUNT(*) AS nb
      FROM orders
      WHERE status = 'cancelled' AND cancelled_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY cancel_reason ORDER BY nb DESC LIMIT 5
    `, [period]);

    // ── Annulations récentes ────────────────────────────────────────────────
    const { rows: recentCancel } = await db.query(`
      SELECT o.reference, o.total_kmf, o.cancelled_at, o.cancel_reason,
        o.payment_mode,
        r.amount_kmf AS refund_kmf, r.refund_method
      FROM orders o
      LEFT JOIN refunds r ON r.order_id = o.id AND r.status = 'completed'
      WHERE o.status = 'cancelled'
      ORDER BY o.cancelled_at DESC NULLS LAST
      LIMIT 10
    `);

    // ── Expéditions partielles (Parcels) ────────────────────────────────────
    const { rows: [parcelKpi] } = await db.query(`
      SELECT
        COUNT(*)                                                                   AS total_parcels,
        COUNT(*) FILTER (WHERE type = 'partial')                                   AS nb_partial,
        COUNT(*) FILTER (WHERE type = 'backorder')                                 AS nb_backorder,
        COUNT(*) FILTER (WHERE status NOT IN ('collected', 'cancelled'))            AS en_cours,
        COUNT(*) FILTER (WHERE type = 'backorder'
                           AND status NOT IN ('collected', 'cancelled'))            AS backorder_actifs,
        COUNT(*) FILTER (WHERE status = 'collected')                               AS collected,
        COUNT(*) FILTER (WHERE status = 'cancelled')                               AS cancelled
      FROM parcels
    `);

    const totalParcels   = Number(parcelKpi.total_parcels);
    const parcelCollected = Number(parcelKpi.collected);
    const tauxCompletion = totalParcels > 0
      ? +((parcelCollected / totalParcels) * 100).toFixed(1) : 0;

    // ── Colis par statut ────────────────────────────────────────────────────
    const { rows: parcelStatuts } = await db.query(`
      SELECT status, type, COUNT(*) AS nb
      FROM parcels WHERE status != 'cancelled'
      GROUP BY status, type ORDER BY nb DESC
    `);

    // ── Colis récents ───────────────────────────────────────────────────────
    const { rows: recentParcels } = await db.query(`
      SELECT p.reference, p.type, p.status, p.created_at,
        o.reference AS order_reference,
        (SELECT COUNT(*) FROM parcel_items WHERE parcel_id = p.id) AS nb_items
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      ORDER BY p.created_at DESC LIMIT 10
    `);

    // ── Commandes avec expéditions partielles ───────────────────────────────
    const { rows: [partialOrders] } = await db.query(`
      SELECT COUNT(DISTINCT order_id) AS nb FROM parcels WHERE type = 'partial'
    `);

    const result = {
      period,
      annulations: {
        total:    nbAnnulees,
        refunded: Number(annulKpi.nb_refunded),
        taux_pct: tauxAnnulation,
        par_periode: {
          '7j':  Number(annulKpi.annulees_7j),
          '30j': Number(annulKpi.annulees_30j),
        },
        remboursements: {
          total_kmf: Math.round(Number(remb.total_kmf)),
          total_eur: +Number(remb.total_eur).toFixed(2),
          stripe: {
            count: Number(remb.nb_stripe),
            kmf:   Math.round(Number(remb.stripe_kmf)),
            eur:   +Number(remb.stripe_eur).toFixed(2),
          },
          credit_boutique: {
            count: Number(remb.nb_credit),
            kmf:   Math.round(Number(remb.credit_kmf)),
          },
        },
        credits_actifs: {
          total_kmf: Math.round(Number(credits.total_actif_kmf)),
          nb:        Number(credits.nb_credits_actifs),
        },
        raisons: raisonsRows.map(r => ({
          raison: r.raison,
          count:  Number(r.nb),
        })),
        recentes: recentCancel.map(o => ({
          reference:     o.reference,
          total_kmf:     Number(o.total_kmf),
          cancelled_at:  o.cancelled_at,
          reason:        o.cancel_reason,
          payment_mode:  o.payment_mode,
          refund_kmf:    o.refund_kmf ? Number(o.refund_kmf) : null,
          refund_method: o.refund_method,
        })),
      },
      parcels: {
        total:               totalParcels,
        partial:             Number(parcelKpi.nb_partial),
        backorder:           Number(parcelKpi.nb_backorder),
        en_cours:            Number(parcelKpi.en_cours),
        backorder_actifs:    Number(parcelKpi.backorder_actifs),
        taux_completion_pct: tauxCompletion,
        par_statut: parcelStatuts.reduce((acc, r) => {
          acc[`${r.type}_${r.status}`] = Number(r.nb);
          return acc;
        }, {}),
        nb_orders_with_parcels: Number(partialOrders.nb),
        recents: recentParcels.map(p => ({
          reference:       p.reference,
          type:            p.type,
          status:          p.status,
          order_reference: p.order_reference,
          nb_items:        Number(p.nb_items),
          created_at:      p.created_at,
        })),
      },
    };

    setCache('annulations-parcels', result);
    res.json(result);
  } catch(err) { next(err); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// 12. GET /global — Vue globale unifiée (CT Global view)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/global', async (req, res, next) => {
  try {
    const hit = cached('global');
    if (hit) return res.json(hit);

    const { rows: [kpi] } = await db.query(`
      SELECT
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled'))::int AS active_orders,
        COUNT(*) FILTER (WHERE status = 'collected')::int AS completed_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders,
        COALESCE(SUM(total_kmf) FILTER (WHERE status != 'cancelled'), 0) AS ca_total_kmf,
        COALESCE(AVG(total_kmf) FILTER (WHERE status != 'cancelled'), 0) AS avg_basket_kmf,
        COUNT(DISTINCT user_id)::int AS nb_clients
      FROM orders
    `);

    const { rows: funnelRows } = await db.query(`
      SELECT status, COUNT(*)::int AS count
      FROM orders WHERE status != 'cancelled'
      GROUP BY status ORDER BY
        CASE status
          WHEN 'confirmed' THEN 1 WHEN 'ordered' THEN 2 WHEN 'preparation' THEN 3
          WHEN 'shipped' THEN 4 WHEN 'in_transit' THEN 5 WHEN 'available' THEN 6
          WHEN 'collected' THEN 7 ELSE 8
        END
    `);
    const funnel = {};
    for (const r of funnelRows) funnel[r.status] = r.count;

    const { rows: [parcelKpi] } = await db.query(`
      SELECT
        COUNT(*)::int AS total_parcels,
        COUNT(*) FILTER (WHERE status = 'shipped')::int AS shipped,
        COUNT(*) FILTER (WHERE status = 'in_transit')::int AS in_transit,
        COUNT(*) FILTER (WHERE status = 'available')::int AS at_relay,
        COUNT(*) FILTER (WHERE status = 'collected')::int AS collected
      FROM parcels
    `);

    let incidentCount = 0;
    try {
      const { rows: [ic] } = await db.query("SELECT COUNT(*)::int AS c FROM incidents WHERE status != 'resolved'");
      incidentCount = ic.c;
    } catch (_) {}

    let scanCount = 0;
    try {
      const { rows: [sc] } = await db.query("SELECT COUNT(*)::int AS c FROM scan_events");
      scanCount = sc.c;
    } catch (_) {}

    let invoiceCount = 0;
    try {
      const { rows: [inv] } = await db.query("SELECT COUNT(*)::int AS c FROM invoices");
      invoiceCount = inv.c;
    } catch (_) {}

    const { rows: recentOrders } = await db.query(`
      SELECT o.reference, o.status, o.total_kmf, o.payment_mode, o.created_at,
        COALESCE(u.full_name, 'Client') AS customer_name,
        r.name AS relais_name, r.island
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      ORDER BY o.created_at DESC LIMIT 10
    `);

    const result = {
      kpi: {
        total_orders: Number(kpi.total_orders),
        active_orders: Number(kpi.active_orders),
        completed_orders: Number(kpi.completed_orders),
        cancelled_orders: Number(kpi.cancelled_orders),
        ca_total_kmf: Math.round(Number(kpi.ca_total_kmf)),
        avg_basket_kmf: Math.round(Number(kpi.avg_basket_kmf)),
        nb_clients: Number(kpi.nb_clients),
      },
      funnel,
      parcels: {
        total: Number(parcelKpi.total_parcels),
        shipped: Number(parcelKpi.shipped),
        in_transit: Number(parcelKpi.in_transit),
        at_relay: Number(parcelKpi.at_relay),
        collected: Number(parcelKpi.collected),
      },
      incidents: incidentCount,
      scan_events: scanCount,
      invoices: invoiceCount,
      recent_orders: recentOrders.map(o => ({
        reference: o.reference,
        status: o.status,
        total_kmf: Number(o.total_kmf),
        payment_mode: o.payment_mode,
        customer_name: o.customer_name,
        relais_name: o.relais_name,
        island: o.island,
        created_at: o.created_at,
      })),
    };

    setCache('global', result);
    res.json(result);
  } catch(err) { next(err); }
});

// Alias: /hub → /hub-dubai (frontend compatibility)
router.get('/hub', (req, res, next) => {
  req.url = '/hub-dubai';
  router.handle(req, res, next);
});

// ═══════════════════════════════════════════════════════════════════
// Alias /stats → /global avec mapping pour compat pilotage
// (ct-views-pilotage.js attend des noms de champs spécifiques)
// ═══════════════════════════════════════════════════════════════════
router.get('/stats', async (req, res, next) => {
  try {
    const hit = cached('global');
    let g = hit;
    if (!g) {
      // On reproduit la logique de /global pour les KPIs essentiels
      const { rows: [kpi] } = await db.query(`
        SELECT
          COUNT(*)::int AS total_orders,
          COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled'))::int AS active_orders,
          COUNT(*) FILTER (WHERE status = 'collected')::int AS completed_orders,
          COALESCE(SUM(total_kmf) FILTER (WHERE status != 'cancelled'), 0) AS ca_total_kmf,
          COALESCE(AVG(total_kmf) FILTER (WHERE status != 'cancelled'), 0) AS avg_basket_kmf,
          COUNT(DISTINCT user_id)::int AS nb_clients
        FROM orders
      `);
      g = { kpi: {
        total_orders: Number(kpi.total_orders),
        active_orders: Number(kpi.active_orders),
        completed_orders: Number(kpi.completed_orders),
        ca_total_kmf: Math.round(Number(kpi.ca_total_kmf)),
        avg_basket_kmf: Math.round(Number(kpi.avg_basket_kmf)),
        nb_clients: Number(kpi.nb_clients),
      } };
    }
    // Mapping vers les champs attendus par ct-views-pilotage.js
    res.json({
      // Format attendu par pilotage (alias)
      panier_moyen_kmf: g.kpi.avg_basket_kmf,
      avgBasket: g.kpi.avg_basket_kmf,
      nb_clients: g.kpi.nb_clients,
      total_orders: g.kpi.total_orders,
      active_orders: g.kpi.active_orders,
      completed_orders: g.kpi.completed_orders,
      ca_total_kmf: g.kpi.ca_total_kmf,
      // Format /global complet pour réutilisation
      kpi: g.kpi,
    });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════
// Alias racine /api/admin/radar → redirige vers le bon endpoint
// (mais c'est admin-radar.js qui gère, pas ce fichier)
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// 11. GET /payments — Suivi des paiements Cash relais + Stripe
// ═══════════════════════════════════════════════════════════════════════════════
// Indicateur temps-réel du statut de paiement des commandes.
//
// Cash relais :
//   · pending       = commandes non encore confirmées par l'agent relais
//   · overdue_12h   = pending depuis > 12h → rappel client à planifier
//   · overdue_36h   = pending depuis > 36h → annulation à déclencher
//
// Stripe :
//   · pending       = PaymentIntent créé, paiement pas encore confirmé
//   · failed        = paiement échoué (stripe webhook payment_intent.payment_failed)
//
// summary.alert_count = nb d'actions requises (overdue_36h + stripe_failed)
//
// Query params : ?period=30  → fenêtre historique pour les stats paid/failed (défaut: 30j)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/payments', async (req, res, next) => {
  try {
    const cfg    = await loadDashConfig();
    const period = Math.max(1, Math.min(365, parseInt(req.query.period) || 30));
    const rates  = await getEurKmf();

    // ── Agrégats globaux ─────────────────────────────────────────────────────
    // pending : pas de filtre de période (on veut TOUS les pending actifs)
    // paid/failed : limités à la fenêtre `period`
    const { rows: [agg] } = await db.query(`
      SELECT
        -- Cash relais — pending (tous actifs)
        COUNT(*) FILTER (
          WHERE payment_mode = 'cash_relais'
            AND payment_status = 'pending'
            AND status NOT IN ('cancelled')
        ) AS cash_pending_count,
        COALESCE(SUM(total_kmf) FILTER (
          WHERE payment_mode = 'cash_relais'
            AND payment_status = 'pending'
            AND status NOT IN ('cancelled')
        ), 0) AS cash_pending_kmf,

        -- Cash relais — retards
        COUNT(*) FILTER (
          WHERE payment_mode = 'cash_relais'
            AND payment_status = 'pending'
            AND status NOT IN ('cancelled')
            AND created_at <= NOW() - INTERVAL '12 hours'
        ) AS cash_overdue_12h,
        COUNT(*) FILTER (
          WHERE payment_mode = 'cash_relais'
            AND payment_status = 'pending'
            AND status NOT IN ('cancelled')
            AND created_at <= NOW() - INTERVAL '36 hours'
        ) AS cash_overdue_36h,

        -- Cash relais — confirmés sur la période
        COUNT(*) FILTER (
          WHERE payment_mode = 'cash_relais'
            AND payment_status = 'paid'
            AND created_at >= NOW() - INTERVAL '1 day' * $1
        ) AS cash_paid_count,
        COALESCE(SUM(total_kmf) FILTER (
          WHERE payment_mode = 'cash_relais'
            AND payment_status = 'paid'
            AND created_at >= NOW() - INTERVAL '1 day' * $1
        ), 0) AS cash_paid_kmf,

        -- Stripe — pending (tous actifs)
        COUNT(*) FILTER (
          WHERE payment_mode = 'stripe_eur'
            AND payment_status = 'pending'
            AND status NOT IN ('cancelled')
        ) AS stripe_pending_count,
        COALESCE(SUM(total_eur) FILTER (
          WHERE payment_mode = 'stripe_eur'
            AND payment_status = 'pending'
            AND status NOT IN ('cancelled')
        ), 0) AS stripe_pending_eur,

        -- Stripe — payés sur la période
        COUNT(*) FILTER (
          WHERE payment_mode = 'stripe_eur'
            AND payment_status = 'paid'
            AND created_at >= NOW() - INTERVAL '1 day' * $1
        ) AS stripe_paid_count,
        COALESCE(SUM(total_eur) FILTER (
          WHERE payment_mode = 'stripe_eur'
            AND payment_status = 'paid'
            AND created_at >= NOW() - INTERVAL '1 day' * $1
        ), 0) AS stripe_paid_eur,

        -- Stripe — échoués sur la période
        COUNT(*) FILTER (
          WHERE payment_mode = 'stripe_eur'
            AND payment_status = 'failed'
            AND created_at >= NOW() - INTERVAL '1 day' * $1
        ) AS stripe_failed_count,
        COALESCE(SUM(total_eur) FILTER (
          WHERE payment_mode = 'stripe_eur'
            AND payment_status = 'failed'
            AND created_at >= NOW() - INTERVAL '1 day' * $1
        ), 0) AS stripe_failed_eur

      FROM orders
    `, [period]);

    // ── Liste commandes en attente de paiement (cash + stripe, max 40) ───────
    const { rows: pendingOrders } = await db.query(`
      SELECT
        o.id,
        o.reference,
        o.payment_mode,
        o.payment_status,
        o.status         AS order_status,
        o.total_kmf,
        o.total_eur,
        o.cash_ref_code,
        o.created_at,
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 3600.0 AS age_hours,
        u.full_name  AS client_name,
        u.phone      AS client_phone,
        r.name       AS relais_name
      FROM orders o
      LEFT JOIN users  u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.payment_status = 'pending'
        AND o.status NOT IN ('cancelled')
      ORDER BY o.created_at ASC
      LIMIT 40
    `);

    // ── Stripe failed récents (détails pour action) ───────────────────────────
    // Inclus aussi dans reconciliation.stripe_failed_active
    const { rows: failedOrders } = await db.query(`
      SELECT
        o.reference,
        o.stripe_payment_id,
        o.total_eur,
        o.created_at,
        u.full_name  AS client_name,
        u.phone      AS client_phone
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.payment_mode   = 'stripe_eur'
        AND o.payment_status = 'failed'
        AND o.created_at    >= NOW() - INTERVAL '1 day' * $1
      ORDER BY o.created_at DESC
      LIMIT 10
    `, [period]);

    // ══════════════════════════════════════════════════════════════════════════
    // RÉCONCILIATION : Vendu / Commandé / Sourcé vs Encaissé
    // Détecte les écarts entre ce qui est engagé et ce qui est effectivement payé
    // ══════════════════════════════════════════════════════════════════════════

    // GAP 1 — Livré sans encaissé
    // Commandes disponibles ou récupérées mais paiement non confirmé.
    // C'est la divergence la plus critique : marchandise partie, argent non reçu.
    const { rows: deliveredUnpaid } = await db.query(`
      SELECT
        o.reference,
        o.payment_mode,
        o.payment_status,
        o.status        AS order_status,
        o.total_kmf,
        o.total_eur,
        o.created_at,
        u.full_name     AS client_name,
        u.phone         AS client_phone,
        r.name          AS relais_name
      FROM orders o
      LEFT JOIN users  u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.status          IN ('available', 'collected')
        AND o.payment_status  != 'paid'
        AND o.status          != 'cancelled'
      ORDER BY o.created_at ASC
    `);

    // GAP 2 — Sourcé sans payé
    // Des colis sont en cours de traitement (preparation/shipped/in_transit/arrived/available)
    // pour des commandes dont le paiement n'est pas encore confirmé.
    // Exposition financière : l'achat a été engagé mais l'encaissement n'est pas garanti.
    const { rows: sourcedUnpaid } = await db.query(`
      SELECT
        o.reference,
        o.payment_mode,
        o.payment_status,
        o.total_kmf,
        o.total_eur,
        o.cost_real_kmf,
        o.created_at,
        COUNT(p.id)             AS nb_parcels_actifs,
        ARRAY_AGG(p.status)     AS parcel_statuses,
        u.full_name             AS client_name,
        u.phone                 AS client_phone
      FROM orders o
      JOIN parcels p  ON p.order_id = o.id
                     AND p.status NOT IN ('draft', 'cancelled')
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.payment_status = 'pending'
        AND o.status NOT IN ('cancelled')
      GROUP BY o.id, u.full_name, u.phone
      ORDER BY o.created_at ASC
    `);

    // GAP 3a — Stripe : payé sans stripe_payment_id (incohérence comptable)
    // Le flag payment_status = 'paid' a été posé mais aucun PaymentIntent tracé.
    const { rows: stripeNoproof } = await db.query(`
      SELECT o.reference, o.total_eur, o.total_kmf, o.created_at,
             u.full_name AS client_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.payment_mode   = 'stripe_eur'
        AND o.payment_status = 'paid'
        AND (o.stripe_payment_id IS NULL OR o.stripe_payment_id = '')
      ORDER BY o.created_at DESC
    `);

    // GAP 3b — Cash : payé sans cash_paid_at (traçabilité manquante)
    // L'agent a confirmé le paiement mais l'horodatage de réception n'a pas été enregistré.
    const { rows: cashNoproof } = await db.query(`
      SELECT o.reference, o.total_kmf, o.created_at,
             o.cash_ref_code,
             u.full_name AS client_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.payment_mode   = 'cash_relais'
        AND o.payment_status = 'paid'
        AND o.cash_paid_at   IS NULL
      ORDER BY o.created_at DESC
    `);

    // GAP 4 — Écart global commandé vs encaissé
    // Vision macro : argent théorique engagé vs argent réellement rentré en caisse.
    const { rows: [ecart] } = await db.query(`
      SELECT
        -- Commandé = toutes commandes non annulées
        COALESCE(SUM(total_kmf) FILTER (
          WHERE status != 'cancelled'
        ), 0) AS total_commande_kmf,

        -- Encaissé = paiements confirmés
        COALESCE(SUM(total_kmf) FILTER (
          WHERE payment_status = 'paid'
        ), 0) AS total_encaisse_kmf,

        -- Sourcé = coût réel des commandes non annulées avec colis engagés
        COALESCE(SUM(cost_real_kmf) FILTER (
          WHERE cost_real_kmf IS NOT NULL
            AND status NOT IN ('cancelled')
        ), 0) AS total_source_kmf,

        -- Écart brut non encaissé (commandé - encaissé, sur non-annulé)
        COALESCE(SUM(total_kmf) FILTER (
          WHERE payment_status != 'paid'
            AND status NOT IN ('cancelled')
        ), 0) AS gap_non_encaisse_kmf

      FROM orders
    `);

    // ══════════════════════════════════════════════════════════════════════════
    // ANTI-FRAUDE RELAIS CASH
    // Détecte les comportements suspects des agents relais sur les paiements cash
    // ══════════════════════════════════════════════════════════════════════════

    // FRAUDE 1 — Collected sans reverse (critique)
    // Le relais a remis la marchandise au client mais l'argent n'est pas rentré.
    // C'est le signal le plus fort : la livraison est confirmée, le paiement non.
    const { rows: fraudCollectedUnpaid } = await db.query(`
      SELECT
        o.id,
        o.reference,
        o.total_kmf,
        o.cash_ref_code,
        o.collected_at,
        o.available_at,
        o.payment_status,
        EXTRACT(EPOCH FROM (NOW() - o.collected_at)) / 3600  AS heures_depuis_collected,
        u.full_name   AS client_name,
        u.phone       AS client_phone,
        r.id          AS relais_id,
        r.name        AS relais_name,
        r.agent_name,
        r.phone       AS relais_phone,
        r.island
      FROM orders o
      LEFT JOIN users  u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.payment_mode   = 'cash_relais'
        AND o.status         = 'collected'
        AND o.payment_status != 'paid'
        AND o.collected_at   IS NOT NULL
      ORDER BY o.collected_at ASC
    `);

    // FRAUDE 2 — Délai de reverse anormal (> 3 jours entre collected et cash_paid_at)
    // Le reverse a bien eu lieu mais avec un délai suspect.
    // Seuil paramétrable : 3 jours = warning, 7 jours = critique.
    const { rows: fraudDelayedReverse } = await db.query(`
      SELECT
        o.reference,
        o.total_kmf,
        o.cash_ref_code,
        o.collected_at,
        o.cash_paid_at,
        EXTRACT(DAY FROM (o.cash_paid_at - o.collected_at))  AS jours_delai_reverse,
        r.id          AS relais_id,
        r.name        AS relais_name,
        r.agent_name,
        r.phone       AS relais_phone,
        r.island,
        u.full_name   AS client_name
      FROM orders o
      LEFT JOIN users  u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.payment_mode   = 'cash_relais'
        AND o.payment_status = 'paid'
        AND o.collected_at   IS NOT NULL
        AND o.cash_paid_at   IS NOT NULL
        AND (o.cash_paid_at - o.collected_at) > INTERVAL '3 days'
      ORDER BY (o.cash_paid_at - o.collected_at) DESC
    `);

    // FRAUDE 3 — Colis bloqué au relais depuis > 14 jours (rétention)
    // La marchandise est disponible depuis trop longtemps.
    // Peut indiquer que le relais retient les colis (pour accumuler du cash).
    const { rows: fraudStaleParcels } = await db.query(`
      SELECT
        o.reference,
        o.total_kmf,
        o.cash_ref_code,
        o.available_at,
        EXTRACT(DAY FROM (NOW() - o.available_at))  AS jours_au_relais,
        r.id          AS relais_id,
        r.name        AS relais_name,
        r.agent_name,
        r.phone       AS relais_phone,
        r.island,
        u.full_name   AS client_name,
        u.phone       AS client_phone
      FROM orders o
      LEFT JOIN users  u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.payment_mode = 'cash_relais'
        AND o.status       = 'available'
        AND o.available_at < NOW() - INTERVAL '14 days'
      ORDER BY o.available_at ASC
    `);

    // SCORE PAR RELAIS — agrégation de toutes les anomalies détectées
    // risk_score = (collected_unpaid × 3) + (delayed_reverse × 2) + (stale_parcels × 1)
    // risk_level : critical ≥ 6 | warning ≥ 2 | ok < 2
    const relaisRiskMap = {};

    const addRelaisAnomaly = (row, type, weight) => {
      if (!row.relais_id) return;
      const key = row.relais_id;
      if (!relaisRiskMap[key]) {
        relaisRiskMap[key] = {
          relais_id:    row.relais_id,
          relais_name:  row.relais_name,
          agent_name:   row.agent_name,
          relais_phone: row.relais_phone,
          island:       row.island,
          risk_score:   0,
          collected_unpaid_count:  0,
          delayed_reverse_count:   0,
          stale_parcels_count:     0,
          total_kmf_at_risk:       0,
        };
      }
      relaisRiskMap[key].risk_score         += weight;
      relaisRiskMap[key][type + '_count']   += 1;
      relaisRiskMap[key].total_kmf_at_risk  += Math.round(Number(row.total_kmf || 0));
    };

    fraudCollectedUnpaid.forEach(r => addRelaisAnomaly(r, 'collected_unpaid',  3));
    fraudDelayedReverse.forEach(r  => addRelaisAnomaly(r, 'delayed_reverse',   2));
    fraudStaleParcels.forEach(r    => addRelaisAnomaly(r, 'stale_parcels',     1));

    const relaisRiskList = Object.values(relaisRiskMap)
      .map(r => ({
        ...r,
        risk_level: r.risk_score >= 6 ? 'critical' : r.risk_score >= 2 ? 'warning' : 'ok',
      }))
      .sort((a, b) => b.risk_score - a.risk_score);

    // ── Calculs résumé ────────────────────────────────────────────────────────
    const cashPendingKmf   = Math.round(Number(agg.cash_pending_kmf));
    const stripePendingEur = +Number(agg.stripe_pending_eur).toFixed(2);
    const totalPendingKmf  = cashPendingKmf + Math.round(stripePendingEur * rates.eur_kmf);

    // alert_count inclut maintenant les anomalies de réconciliation critiques
    const reconciAlerts = deliveredUnpaid.length + stripeNoproof.length;
    const alertCount    = Number(agg.cash_overdue_36h) + Number(agg.stripe_failed_count) + reconciAlerts;

    res.json({
      period,
      taux: rates,

      cash: {
        pending: {
          count:     Number(agg.cash_pending_count),
          total_kmf: cashPendingKmf,
        },
        paid: {
          count:     Number(agg.cash_paid_count),
          total_kmf: Math.round(Number(agg.cash_paid_kmf)),
        },
        // Rappel H+12 : à notifier (info)
        overdue_12h: Number(agg.cash_overdue_12h),
        // Rappel H+36 : à annuler (alerte critique)
        overdue_36h: Number(agg.cash_overdue_36h),
      },

      stripe: {
        pending: {
          count:     Number(agg.stripe_pending_count),
          total_eur: stripePendingEur,
        },
        paid: {
          count:     Number(agg.stripe_paid_count),
          total_eur: +Number(agg.stripe_paid_eur).toFixed(2),
        },
        failed: {
          count:     Number(agg.stripe_failed_count),
          total_eur: +Number(agg.stripe_failed_eur).toFixed(2),
          orders: failedOrders.map(f => ({
            reference:         f.reference,
            stripe_payment_id: f.stripe_payment_id,
            total_eur:         +Number(f.total_eur).toFixed(2),
            client:            f.client_name,
            phone:             f.client_phone,
            created_at:        f.created_at,
          })),
        },
      },

      // ── Résumé : chiffre clé pour le widget dashboard ──────────────────────
      summary: {
        // Argent bloqué en attente de paiement (toutes modes confondus)
        total_pending_kmf: totalPendingKmf,
        // Nombre d'actions requises (annulation + stripe failed)
        alert_count:       alertCount,
        needs_action:      alertCount > 0,
      },

      // ── Réconciliation : Vendu / Commandé / Sourcé vs Encaissé ───────────
      reconciliation: {

        // Vue macro — écarts globaux en KMF
        ecart_global: {
          total_commande_kmf:    Math.round(Number(ecart.total_commande_kmf)),
          total_encaisse_kmf:    Math.round(Number(ecart.total_encaisse_kmf)),
          total_source_kmf:      Math.round(Number(ecart.total_source_kmf)),
          gap_non_encaisse_kmf:  Math.round(Number(ecart.gap_non_encaisse_kmf)),
          // Alerte si argent non encaissé > 0
          has_gap:               Number(ecart.gap_non_encaisse_kmf) > 0,
        },

        // GAP 1 — Livré sans encaissé (critique)
        // Marchandise partie, argent non reçu
        delivered_unpaid: {
          count:  deliveredUnpaid.length,
          total_kmf: Math.round(deliveredUnpaid.reduce((s, o) => s + Number(o.total_kmf), 0)),
          orders: deliveredUnpaid.map(o => ({
            reference:    o.reference,
            mode:         o.payment_mode === 'cash_relais' ? 'cash' : 'stripe',
            order_status: o.order_status,
            payment_status: o.payment_status,
            total_kmf:    Math.round(Number(o.total_kmf)),
            total_eur:    o.total_eur ? +Number(o.total_eur).toFixed(2) : null,
            client:       o.client_name,
            phone:        o.client_phone,
            relais:       o.relais_name,
            created_at:   o.created_at,
          })),
        },

        // GAP 2 — Sourcé sans payé (exposition financière)
        // Colis engagés pour commandes dont le paiement n'est pas confirmé
        sourced_unpaid: {
          count:  sourcedUnpaid.length,
          total_kmf: Math.round(sourcedUnpaid.reduce((s, o) => s + Number(o.total_kmf || 0), 0)),
          cost_source_kmf: Math.round(sourcedUnpaid.reduce((s, o) => s + Number(o.cost_real_kmf || 0), 0)),
          orders: sourcedUnpaid.map(o => ({
            reference:       o.reference,
            mode:            o.payment_mode === 'cash_relais' ? 'cash' : 'stripe',
            payment_status:  o.payment_status,
            total_kmf:       Math.round(Number(o.total_kmf || 0)),
            cost_real_kmf:   o.cost_real_kmf ? Math.round(Number(o.cost_real_kmf)) : null,
            nb_parcels:      Number(o.nb_parcels_actifs),
            parcel_statuses: o.parcel_statuses,
            client:          o.client_name,
            phone:           o.client_phone,
            created_at:      o.created_at,
          })),
        },

        // GAP 3 — Payé sans preuve (incohérence comptable)
        paid_no_proof: {
          stripe_no_payment_id: {
            count:  stripeNoproof.length,
            orders: stripeNoproof.map(o => ({
              reference:  o.reference,
              total_eur:  +Number(o.total_eur).toFixed(2),
              total_kmf:  Math.round(Number(o.total_kmf)),
              client:     o.client_name,
              created_at: o.created_at,
            })),
          },
          cash_no_timestamp: {
            count:  cashNoproof.length,
            orders: cashNoproof.map(o => ({
              reference:     o.reference,
              cash_ref_code: o.cash_ref_code,
              total_kmf:     Math.round(Number(o.total_kmf)),
              client:        o.client_name,
              created_at:    o.created_at,
            })),
          },
        },

        // Niveau d'alerte réconciliation : ok | warning | critical
        // critical → marchandise livrée non payée ou paiement sans preuve
        // warning  → sourcing engagé sans paiement confirmé
        // ok       → pas d'anomalie détectée
        alert_level: deliveredUnpaid.length > 0 || stripeNoproof.length > 0
          ? 'critical'
          : sourcedUnpaid.length > 0
            ? 'warning'
            : 'ok',
      },

      // ── Anti-fraude relais cash ──────────────────────────────────────────
      fraud_relais: {

        // SIGNAL 1 — Collected sans reverse (risque maximal)
        // Marchandise remise, argent non reçu. Action immédiate requise.
        collected_unpaid: {
          count:     fraudCollectedUnpaid.length,
          total_kmf: Math.round(fraudCollectedUnpaid.reduce((s, o) => s + Number(o.total_kmf || 0), 0)),
          orders: fraudCollectedUnpaid.map(o => ({
            reference:             o.reference,
            relais:                o.relais_name,
            agent:                 o.agent_name,
            relais_phone:          o.relais_phone,
            island:                o.island,
            client:                o.client_name,
            client_phone:          o.client_phone,
            total_kmf:             Math.round(Number(o.total_kmf)),
            cash_ref_code:         o.cash_ref_code,
            collected_at:          o.collected_at,
            heures_depuis_collected: o.heures_depuis_collected != null
              ? Math.round(Number(o.heures_depuis_collected))
              : null,
          })),
        },

        // SIGNAL 2 — Délai de reverse anormal (> 3 jours)
        // Le reverse a eu lieu mais trop tard. Pattern suspect.
        delayed_reverse: {
          count: fraudDelayedReverse.length,
          orders: fraudDelayedReverse.map(o => ({
            reference:           o.reference,
            relais:              o.relais_name,
            agent:               o.agent_name,
            relais_phone:        o.relais_phone,
            island:              o.island,
            client:              o.client_name,
            total_kmf:           Math.round(Number(o.total_kmf)),
            collected_at:        o.collected_at,
            cash_paid_at:        o.cash_paid_at,
            jours_delai_reverse: Math.round(Number(o.jours_delai_reverse)),
            urgency:             Number(o.jours_delai_reverse) >= cfg.FRAUD_REVERSE_CRIT_DAYS ? 'critical' : 'warning',
          })),
        },

        // SIGNAL 3 — Colis bloqué au relais depuis > 14 jours (rétention)
        // Marchandise retenue. Peut cacher une collecte non déclarée.
        stale_parcels: {
          count: fraudStaleParcels.length,
          orders: fraudStaleParcels.map(o => ({
            reference:      o.reference,
            relais:         o.relais_name,
            agent:          o.agent_name,
            relais_phone:   o.relais_phone,
            island:         o.island,
            client:         o.client_name,
            client_phone:   o.client_phone,
            total_kmf:      Math.round(Number(o.total_kmf)),
            available_at:   o.available_at,
            jours_au_relais: Math.round(Number(o.jours_au_relais)),
          })),
        },

        // SCORE PAR RELAIS — classement des agents par niveau de risque
        // risk_score = collected_unpaid×3 + delayed_reverse×2 + stale_parcels×1
        // Permet d'identifier rapidement quel agent surveiller en priorité.
        relais_risk_scores: relaisRiskList,

        // Niveau d'alerte global anti-fraude
        // critical → au moins 1 collected non reversé
        // warning  → délais suspects ou rétention colis
        // ok       → aucun signal détecté
        alert_level: fraudCollectedUnpaid.length > 0
          ? 'critical'
          : fraudDelayedReverse.length > 0 || fraudStaleParcels.length > 0
            ? 'warning'
            : 'ok',
      },

      // ── Liste opérationnelle des commandes en attente ──────────────────────
      pending_orders: pendingOrders.map(o => {
        const ageH = +Number(o.age_hours).toFixed(1);
        return {
          id:            o.id,
          reference:     o.reference,
          mode:          o.payment_mode === 'cash_relais' ? 'cash' : 'stripe',
          order_status:  o.order_status,
          total_kmf:     Math.round(Number(o.total_kmf)),
          total_eur:     o.total_eur ? +Number(o.total_eur).toFixed(2) : null,
          cash_ref_code: o.cash_ref_code || null,
          client:        o.client_name,
          phone:         o.client_phone,
          relais:        o.relais_name,
          created_at:    o.created_at,
          age_hours:     ageH,
          // Urgency : pour coloration dans le dashboard
          //   ok       → < 12h
          //   warning  → 12h–36h  (rappel à envoyer)
          //   critical → > 36h    (annulation à déclencher)
          urgency: ageH >= cfg.FRAUD_PENDING_CRIT_H ? 'critical' : ageH >= cfg.FRAUD_PENDING_WARN_H ? 'warning' : 'ok',
        };
      }),
    });

  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/dashboard/sales — Sales analytics for CT view
// ═══════════════════════════════════════════════════════════════
router.get('/sales', async (req, res, next) => {
  try {
    const period = parseInt(req.query.period) || 30;
    const since = new Date();
    since.setDate(since.getDate() - period);
    const sinceStr = since.toISOString();

    // Previous period (for evolution)
    const prevSince = new Date(since);
    prevSince.setDate(prevSince.getDate() - period);
    const prevSinceStr = prevSince.toISOString();

    // ═══ 1. KPIs principaux + MARGE RÉELLE ═══
    // Utilise orders.cost_real_kmf + margin_real_pct déjà renseignés par finance.js
    const kpiQ = await db.query(`
      SELECT
        COUNT(*)                                                          AS nb_commandes,
        COALESCE(SUM(total_kmf), 0)                                       AS ca_kmf,
        COALESCE(AVG(total_kmf), 0)                                       AS panier_moyen,
        COALESCE(SUM(CASE WHEN payment_mode = 'stripe_eur' THEN total_eur ELSE 0 END), 0) AS ca_eur,
        COALESCE(SUM(cost_real_kmf) FILTER (WHERE cost_real_kmf IS NOT NULL), 0) AS couts_reels_kmf,
        COUNT(*)             FILTER (WHERE cost_real_kmf IS NOT NULL)     AS nb_avec_cost,
        COUNT(*)             FILTER (WHERE cost_real_kmf IS NULL)         AS nb_sans_cost,
        COALESCE(AVG(margin_real_pct) FILTER (WHERE margin_real_pct IS NOT NULL), 0) AS marge_moy_pct
      FROM orders
      WHERE created_at >= $1 AND status NOT IN ('cancelled')
    `, [sinceStr]);

    // Previous period KPIs
    const prevKpiQ = await db.query(`
      SELECT COUNT(*) AS nb, COALESCE(SUM(total_kmf),0) AS ca
      FROM orders
      WHERE created_at >= $1 AND created_at < $2 AND status NOT IN ('cancelled')
    `, [prevSinceStr, sinceStr]);

    // ═══ 2. Répartition par île ═══
    // Note : orders ne stocke pas l'île directement, on JOIN sur relais.
    const byIsland = await db.query(`
      SELECT COALESCE(r.island, 'Inconnue') AS island,
             COUNT(*)                       AS nb,
             COALESCE(SUM(o.total_kmf), 0)  AS ca
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.created_at >= $1 AND o.status NOT IN ('cancelled')
      GROUP BY COALESCE(r.island, 'Inconnue')
      ORDER BY ca DESC
    `, [sinceStr]);

    // ═══ 3. Répartition par mode paiement ═══
    const byPayment = await db.query(`
      SELECT payment_mode,
             COUNT(*)                   AS nb,
             COALESCE(SUM(total_kmf),0) AS ca
      FROM orders
      WHERE created_at >= $1 AND status NOT IN ('cancelled')
      GROUP BY payment_mode
      ORDER BY ca DESC
    `, [sinceStr]);

    // ═══ 4. Top produits (inchangé mais explicité) ═══
    const topProducts = await db.query(`
      SELECT p.name, p.category,
             COUNT(*)                                        AS nb_sold,
             COALESCE(SUM(oi.price_kmf * oi.quantity),0)     AS revenue
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN orders o   ON o.id = oi.order_id
      WHERE o.created_at >= $1 AND o.status NOT IN ('cancelled')
      GROUP BY p.name, p.category
      ORDER BY revenue DESC LIMIT 10
    `, [sinceStr]);

    // ═══ 5. NEW — Répartition par catégorie avec marge ═══
    // Marge par cat = (revenue - cost) / revenue, en utilisant cost_real_kmf des orders
    const byCategory = await db.query(`
      SELECT
        p.category                                          AS categorie,
        COUNT(DISTINCT o.id)                                AS nb_commandes,
        COALESCE(SUM(oi.price_kmf * oi.quantity), 0)        AS ca_kmf,
        COALESCE(SUM(
          (oi.price_kmf * oi.quantity) *
          COALESCE(o.margin_real_pct, 0) / 100
        ), 0)                                               AS marge_kmf,
        COALESCE(AVG(o.margin_real_pct) FILTER (
          WHERE o.margin_real_pct IS NOT NULL), 0)          AS taux_marge_pct
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN orders o   ON o.id = oi.order_id
      WHERE o.created_at >= $1 AND o.status NOT IN ('cancelled')
      GROUP BY p.category
      ORDER BY ca_kmf DESC
    `, [sinceStr]);

    // ═══ 6. NEW — Évolution journalière ═══
    // Buckets: si period ≤ 31j → par jour, sinon par semaine
    const bucket = period <= 31 ? 'day' : 'week';
    const evolution = await db.query(`
      SELECT
        date_trunc($2, created_at)::date   AS bucket_date,
        COUNT(*)                            AS nb_commandes,
        COALESCE(SUM(total_kmf),0)          AS ca_kmf
      FROM orders
      WHERE created_at >= $1 AND status NOT IN ('cancelled')
      GROUP BY bucket_date
      ORDER BY bucket_date ASC
    `, [sinceStr, bucket]);

    // ═══ 7. NEW — Funnel commandes ═══
    // 5 étapes: créées → confirmées → expédiées → livrées → payées
    // ENUM order_status: confirmed, ordered, preparation, shipped, available, collected, cancelled, refunded
    // - "confirmed"  = créée + paiement attendu
    // - "ordered"    = paiement validé → commande lancée
    // - "preparation"= colis emballé au hub
    // - "shipped"    = en transit maritime
    // - "available"  = arrivé au relais
    // - "collected"  = remis au client (= livré + payé)
    const funnelQ = await db.query(`
      SELECT
        COUNT(*)                                                                AS nb_creees,
        COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'refunded'))         AS nb_confirmees,
        COUNT(*) FILTER (WHERE status IN ('shipped','available','collected'))   AS nb_expediees,
        COUNT(*) FILTER (WHERE status = 'collected')                            AS nb_livrees,
        COUNT(*) FILTER (WHERE
          status = 'collected'
          OR (payment_mode = 'stripe_eur' AND payment_status = 'paid')
        )                                                                        AS nb_payees,
        COUNT(*) FILTER (WHERE status IN ('cancelled', 'refunded'))             AS nb_perdues
      FROM orders
      WHERE created_at >= $1
    `, [sinceStr]);

    // ═══ 8. NEW — Cohortes (rétention par mois d'acquisition) ═══
    // Pour chaque client, on identifie le mois de sa 1ère commande.
    // Puis on mesure le % qui a re-commandé les mois suivants.
    // Retourne une matrice mois_acquisition × mois_offset.
    // Limité à 6 cohortes × 6 mois pour rester lisible.
    //
    // FIX 25/04/2026 : la colonne `client_phone` n'existe pas sur `orders`.
    // On la récupère via COALESCE(u.phone, r.phone) — pattern déjà utilisé
    // dans /clients du même fichier.
    const cohortLimitMonths = 6;
    const cohortsQ = await db.query(`
      WITH orders_with_phone AS (
        SELECT o.id,
               o.created_at,
               o.status,
               COALESCE(u.phone, r.phone) AS client_phone
        FROM orders o
        LEFT JOIN users u      ON u.id = o.user_id
        LEFT JOIN recipients r ON r.id = o.recipient_id
      ),
      first_orders AS (
        SELECT client_phone,
               date_trunc('month', MIN(created_at))::date AS cohort_month
        FROM orders_with_phone
        WHERE client_phone IS NOT NULL
          AND status NOT IN ('cancelled')
        GROUP BY client_phone
        HAVING MIN(created_at) >= (CURRENT_DATE - ($1 || ' months')::interval)
      ),
      orders_flagged AS (
        SELECT o.client_phone,
               fo.cohort_month,
               date_trunc('month', o.created_at)::date AS order_month,
               EXTRACT(YEAR FROM age(date_trunc('month', o.created_at), fo.cohort_month))*12
               + EXTRACT(MONTH FROM age(date_trunc('month', o.created_at), fo.cohort_month)) AS offset_months
        FROM orders_with_phone o
        JOIN first_orders fo ON fo.client_phone = o.client_phone
        WHERE o.status NOT IN ('cancelled')
      )
      SELECT cohort_month,
             offset_months::int AS offset_months,
             COUNT(DISTINCT client_phone) AS nb_clients
      FROM orders_flagged
      WHERE offset_months <= $2
      GROUP BY cohort_month, offset_months
      ORDER BY cohort_month ASC, offset_months ASC
    `, [cohortLimitMonths, cohortLimitMonths]).catch(err => {
      // Si problème malgré le fix, on dégrade plutôt que planter
      console.warn('[dashboard/sales] cohortes failed:', err.message);
      return { rows: [] };
    });

    // ═══ Assemblage réponse ═══
    const k = kpiQ.rows[0];
    const pk = prevKpiQ.rows[0];
    const evoCa  = Number(pk.ca) > 0 ? +(((Number(k.ca_kmf) - Number(pk.ca)) / Number(pk.ca)) * 100).toFixed(1) : null;
    const evoCmd = Number(pk.nb) > 0 ? +(((Number(k.nb_commandes) - Number(pk.nb)) / Number(pk.nb)) * 100).toFixed(1) : null;
    const margeKmf = Number(k.ca_kmf) * Number(k.marge_moy_pct) / 100;
    const f = funnelQ.rows[0];
    const nbCreees = Number(f.nb_creees);

    // ADR-009 : exposer la cible marge depuis finance_config pour cohérence Vue Santé / Sales
    let targetMargePct = 40;  // fallback aligné sur la décision business
    try {
      const { rows: fc } = await db.query('SELECT target_marge_brute_pct FROM finance_config WHERE id = 1');
      if (fc[0]?.target_marge_brute_pct) targetMargePct = Number(fc[0].target_marge_brute_pct);
    } catch (_) { /* fallback sur 40 */ }
    const margeReellePct = Number(k.marge_moy_pct);
    const ecartCiblePct = +(margeReellePct - targetMargePct).toFixed(1);

    res.json({
      period,
      kpi: {
        ca_kmf:       Number(k.ca_kmf),
        ca_eur:       Number(k.ca_eur),
        nb_commandes: Number(k.nb_commandes),
        panier_moyen: Math.round(Number(k.panier_moyen)),
        evolution: { ca_pct: evoCa, commandes_pct: evoCmd },
      },
      // NEW : marge réelle (plus de hardcode 25%) + cible depuis finance_config (ADR-009)
      marges: {
        marge_reelle_kmf: Math.round(margeKmf),
        taux_marge_pct:   +margeReellePct.toFixed(1),
        cible_marge_pct:  targetMargePct,        // NEW : cible depuis finance_config
        ecart_cible_pct:  ecartCiblePct,         // NEW : positif si au-dessus, négatif si sous
        nb_avec_cost:     Number(k.nb_avec_cost),
        nb_sans_cost:     Number(k.nb_sans_cost),
        couverture_pct:   (Number(k.nb_avec_cost) + Number(k.nb_sans_cost)) > 0
          ? +(Number(k.nb_avec_cost) / (Number(k.nb_avec_cost) + Number(k.nb_sans_cost)) * 100).toFixed(0)
          : 0,
      },
      by_island: byIsland.rows,
      by_payment: byPayment.rows,
      top_products: topProducts.rows,
      // NEW
      by_category: byCategory.rows.map(r => ({
        categorie:      r.categorie,
        nb_commandes:   Number(r.nb_commandes),
        ca_kmf:         Math.round(Number(r.ca_kmf)),
        marge_kmf:      Math.round(Number(r.marge_kmf)),
        taux_marge_pct: +Number(r.taux_marge_pct).toFixed(1),
      })),
      // NEW
      evolution: {
        bucket,                    // 'day' | 'week'
        points: evolution.rows.map(r => ({
          date: r.bucket_date,
          nb_commandes: Number(r.nb_commandes),
          ca_kmf: Math.round(Number(r.ca_kmf)),
        })),
      },
      // NEW
      funnel: {
        etapes: [
          { id: 'creees',      label: 'Commandes créées',   count: nbCreees,                 pct: 100 },
          { id: 'confirmees',  label: 'Confirmées',         count: Number(f.nb_confirmees),  pct: nbCreees > 0 ? +(Number(f.nb_confirmees)/nbCreees*100).toFixed(1) : 0 },
          { id: 'expediees',   label: 'Expédiées',          count: Number(f.nb_expediees),   pct: nbCreees > 0 ? +(Number(f.nb_expediees)/nbCreees*100).toFixed(1) : 0 },
          { id: 'livrees',     label: 'Livrées',            count: Number(f.nb_livrees),     pct: nbCreees > 0 ? +(Number(f.nb_livrees)/nbCreees*100).toFixed(1) : 0 },
          { id: 'payees',      label: 'Payées',             count: Number(f.nb_payees),      pct: nbCreees > 0 ? +(Number(f.nb_payees)/nbCreees*100).toFixed(1) : 0 },
        ],
        perdues: Number(f.nb_perdues),
      },
      // NEW
      cohorts: {
        limit_months: cohortLimitMonths,
        rows: cohortsQ.rows.map(r => ({
          cohort_month:  r.cohort_month,
          offset_months: Number(r.offset_months),
          nb_clients:    Number(r.nb_clients),
        })),
      },
    });
  } catch(err) { next(err); }
});

module.exports = router;

