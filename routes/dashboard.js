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

// ── Config SLA & Compensations (chargée depuis business_rules) ──────────────
// Fallback = valeurs actuelles hardcodées → zéro régression si DB vide
async function loadDashConfig() {
  const [slaWarn, slaLate, slaBlocked, inactive, compPrev, compCredit, compDiscount, compRefund, cacheSec] = await Promise.all([
    getRule('SLA_WARNING_DAYS', 35),
    getRule('SLA_LATE_DAYS', 42),
    getRule('SLA_BLOCKED_DAYS', 56),
    getRule('SLA_INACTIVE_DAYS', 7),
    getRule('COMP_PREVENTIVE_DAYS', 28),
    getRule('COMP_CREDIT_DAYS', 35),
    getRule('COMP_DISCOUNT_DAYS', 42),
    getRule('COMP_REFUND_DAYS', 56),
    getRule('DASHBOARD_CACHE_TTL_SEC', 30),
  ]);
  _cacheTtlMs = cacheSec * 1000;
  return { SLA_WARNING_DAYS: slaWarn, SLA_LATE_DAYS: slaLate, SLA_BLOCKED_DAYS: slaBlocked, INACTIVE_DAYS: inactive, DELAY_PREVENTIF: compPrev, DELAY_AVOIR: compCredit, DELAY_REMISE: compDiscount, DELAY_REMBOURSEMENT: compRefund };
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

    // ── Taux douane effectif (customs_taux_mensuel) ─────────────────────────
    let douaneEffectif = null;
    try {
      const { rows } = await db.query('SELECT taux_effectif_pct FROM customs_taux_mensuel WHERE mois = $1', [mois]);
      if (rows[0]?.taux_effectif_pct != null) douaneEffectif = parseFloat(rows[0].taux_effectif_pct);
    } catch { /* vue pas encore disponible */ }

    // ── Pipeline du mois ────────────────────────────────────────────────────
    const { rows: pipelineRows } = await db.query(`
      SELECT status, COUNT(*) AS nb FROM orders WHERE status != 'cancelled' GROUP BY status ORDER BY nb DESC
    `);

    // ── Taux de change historique ───────────────────────────────────────────
    const { rows: ratesHistory } = await db.query(
      'SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC LIMIT 6'
    );

    const caKmf = parseFloat(vol.ca_kmf);
    const TAUX_TERRAIN = douaneEffectif ? douaneEffectif / 100 : 0.42;
    const hubMensuelKmf = 7000 * rates.aed_kmf;

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
        source_taux: douaneEffectif ? 'customs_history' : 'decision_v75_42pct',
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
// 7. GET /clients — Analyse comportement clients (ex-pilotage/clients)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/clients', async (req, res, next) => {
  try {
    const top   = Math.min(50, Math.max(1, parseInt(req.query.top) || 20));
    const debut = req.query.debut || '2024-01-01';
    const fin   = req.query.fin   || new Date().toISOString().split('T')[0];
    const finExcl = new Date(new Date(fin).getTime() + 86400000).toISOString().split('T')[0];

    const cacheKey = `clients_${debut}_${fin}_${top}`;
    const hit = cached(cacheKey);
    if (hit) return res.json(hit);

    const [kpiRes, topClientsRes, topProdsRes, relaisRes, evoRes] = await Promise.all([
      db.query(`
        SELECT COUNT(DISTINCT o.user_id) AS nb_clients,
          COUNT(DISTINCT o.id) FILTER (WHERE o.status != 'cancelled') AS commandes_valides,
          COALESCE(SUM(o.total_kmf) FILTER (WHERE o.status != 'cancelled'), 0) AS ca_kmf,
          COALESCE(AVG(o.total_kmf) FILTER (WHERE o.status != 'cancelled'), 0) AS panier_moyen,
          COUNT(DISTINCT o.user_id) FILTER (WHERE o.user_id IN (
            SELECT user_id FROM orders GROUP BY user_id HAVING COUNT(*) >= 2
          )) AS clients_recurrents
        FROM orders o WHERE o.created_at >= $1 AND o.created_at < $2
      `, [debut, finExcl]),

      db.query(`
        SELECT u.full_name AS name, u.phone,
          COUNT(o.id) AS nb_commandes,
          COALESCE(SUM(o.total_kmf) FILTER (WHERE o.status != 'cancelled'), 0) AS ca_kmf,
          MAX(o.created_at) AS derniere_commande
        FROM orders o JOIN users u ON u.id = o.user_id
        WHERE o.created_at >= $1 AND o.created_at < $2
        GROUP BY u.id, u.full_name, u.phone
        ORDER BY ca_kmf DESC LIMIT $3
      `, [debut, finExcl, top]),

      db.query(`
        SELECT p.name, p.category, SUM(oi.quantity) AS qty,
          COUNT(DISTINCT oi.order_id) AS nb_commandes,
          COALESCE(SUM(oi.price_kmf * oi.quantity), 0) AS ca_kmf
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status != 'cancelled'
        GROUP BY p.id, p.name, p.category ORDER BY qty DESC LIMIT $3
      `, [debut, finExcl, top]),

      db.query(`
        SELECT r.name AS relais, r.island,
          COUNT(DISTINCT o.id) AS nb_commandes,
          COALESCE(SUM(o.total_kmf) FILTER (WHERE o.status != 'cancelled'), 0) AS ca_kmf,
          COUNT(*) FILTER (WHERE o.status = 'collected') AS livrees
        FROM orders o JOIN relais r ON r.id = o.relais_id
        WHERE o.created_at >= $1 AND o.created_at < $2
        GROUP BY r.id, r.name, r.island ORDER BY ca_kmf DESC
      `, [debut, finExcl]),

      db.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS mois,
          COUNT(DISTINCT id) AS nb_commandes,
          COUNT(DISTINCT user_id) AS nb_clients,
          COALESCE(SUM(total_kmf) FILTER (WHERE status != 'cancelled'), 0) AS ca_kmf
        FROM orders WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1 ORDER BY 1 ASC
      `, [debut, finExcl]),
    ]);

    const kpi = kpiRes.rows[0];
    const nbClients = parseInt(kpi.nb_clients);

    const result = {
      periode: { debut, fin },
      kpi: {
        nb_clients:         nbClients,
        commandes_valides:  parseInt(kpi.commandes_valides),
        ca_total_kmf:       Math.round(parseFloat(kpi.ca_kmf)),
        panier_moyen_kmf:   Math.round(parseFloat(kpi.panier_moyen)),
        clients_recurrents: parseInt(kpi.clients_recurrents),
        taux_recurrence_pct: nbClients > 0 ? +(parseInt(kpi.clients_recurrents) / nbClients * 100).toFixed(1) : 0,
      },
      top_clients:  topClientsRes.rows.map(c => ({
        name: c.name, phone: c.phone, nb_commandes: parseInt(c.nb_commandes),
        ca_kmf: Math.round(parseFloat(c.ca_kmf)), derniere_commande: c.derniere_commande,
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

    // ── Calculs résumé ────────────────────────────────────────────────────────
    const cashPendingKmf   = Math.round(Number(agg.cash_pending_kmf));
    const stripePendingEur = +Number(agg.stripe_pending_eur).toFixed(2);
    const totalPendingKmf  = cashPendingKmf + Math.round(stripePendingEur * rates.eur_kmf);
    const alertCount       = Number(agg.cash_overdue_36h) + Number(agg.stripe_failed_count);

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
          urgency: ageH >= 36 ? 'critical' : ageH >= 12 ? 'warning' : 'ok',
        };
      }),
    });

  } catch(err) { next(err); }
});

module.exports = router;

