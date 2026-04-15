/**
 * KOMERCE — Dashboard unifié v11.0 — Coffre-fort
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

    // ── Logistique (5 étapes physiques) ─────────────────────────────────────
    const logQueries = {
      dubai_reception:  { status: 'ordered',     label: '📥 Réceptionner', dateCol: 'ordered_at' },
      dubai_expedition: { status: 'preparation', label: '📦 Expédier',     dateCol: 'ordered_at' },
      transitaire:      { status: 'shipped',     label: '🏢 Transitaire',  dateCol: 'shipped_at' },
      bateau:           { status: 'in_transit',  label: '🚢 En mer',       dateCol: 'shipped_at' },
    };

    const logistique = {};
    for (const [key, cfg] of Object.entries(logQueries)) {
      const { rows } = await db.query(`
        SELECT o.reference, o.status,
          EXTRACT(EPOCH FROM (NOW() - COALESCE(o.${cfg.dateCol}, o.created_at))) / 86400 AS jours
        FROM orders o WHERE o.status = $1 ORDER BY o.created_at ASC LIMIT 50
      `, [cfg.status]);
      logistique[key] = { count: rows.length, items: rows, label: cfg.label };
    }

    // Anjouan (relais)
    const { rows: anjouanItems } = await db.query(`
      SELECT o.reference, rc.full_name AS destinataire, r.name AS relais_nom,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(o.available_at, o.updated_at))) / 3600 AS heures_en_attente
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      WHERE o.status = 'available'
      ORDER BY o.available_at ASC NULLS LAST LIMIT 50
    `);
    logistique.anjouan = { count: anjouanItems.length, items: anjouanItems, label: '📍 Relais Anjouan' };

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

    const STAGES = ['pending','confirmed','ordered','preparation','shipped','in_transit','available','collected','cancelled','refunded'];
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
        rc.full_name AS client_nom, rc.phone AS client_phone,
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
// 9. GET /hub-dubai — Operations Hub Dubai (reception, emballage, expedition)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/hub-dubai', async (req, res, next) => {
  try {
    const hit = cached('hub-dubai');
    if (hit) return res.json(hit);

    const { rows: orders } = await db.query(`
      SELECT o.id, o.reference, o.status, o.total_kmf, o.created_at,
        u.full_name AS client_nom,
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS jours
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.status IN ('confirmed', 'ordered', 'preparation', 'shipped')
      ORDER BY o.created_at ASC
    `);

    const orderIds = orders.map(o => o.id);
    const itemsMap = {};

    if (orderIds.length > 0) {
      const { rows: items } = await db.query(`
        SELECT oi.order_id, p.name AS nom, oi.quantity AS quantite,
          oi.price_kmf AS prix_kmf, p.stock,
          CASE
            WHEN p.is_active = FALSE THEN 'annule'
            WHEN p.stock IS NOT NULL AND p.stock <= 0 THEN 'hors_stock'
            WHEN p.stock IS NOT NULL AND p.stock > 0 THEN 'complet'
            ELSE 'en_attente'
          END AS status
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ANY($1)
      `, [orderIds]);

      for (const item of items) {
        if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
        itemsMap[item.order_id].push({
          nom: item.nom,
          quantite: Number(item.quantite),
          prix_kmf: Number(item.prix_kmf),
          status: item.status,
          note: item.status === 'hors_stock' ? 'Rupture de stock' : null,
        });
      }
    }

    function toHubOrder(o) {
      const jours = Math.round(Number(o.jours));
      return {
        reference: o.reference,
        client_nom: o.client_nom || 'Client',
        produits: itemsMap[o.id] || [{ nom: 'Produit', quantite: 1, prix_kmf: Number(o.total_kmf), status: 'en_attente' }],
        total_kmf: Number(o.total_kmf),
        date_commande: o.created_at,
        jours,
        priorite: jours > 35 ? 'urgente' : 'normale',
      };
    }

    const result = {
      a_receptionner: orders.filter(o => ['confirmed', 'ordered'].includes(o.status)).map(toHubOrder),
      a_emballer:     orders.filter(o => o.status === 'preparation').map(toHubOrder),
      a_expedier:     orders.filter(o => o.status === 'shipped').map(toHubOrder),
    };

    setCache('hub-dubai', result);
    res.json(result);
  } catch(err) { next(err); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// 10. GET /relais — Operations Relais (validation, remise colis)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/relais', async (req, res, next) => {
  try {
    const hit = cached('relais');
    if (hit) return res.json(hit);

    const { rows: orders } = await db.query(`
      SELECT o.id, o.reference, o.status, o.total_kmf,
        o.payment_mode, o.payment_status,
        o.available_at, o.created_at, o.updated_at,
        COALESCE(EXTRACT(EPOCH FROM (NOW() - COALESCE(o.available_at, o.updated_at))) / 3600, 0) AS heures_attente,
        rc.full_name AS client_nom, rc.phone AS client_phone,
        r.name AS relais_nom, r.island AS ile
      FROM orders o
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.status IN ('in_transit', 'available')
      ORDER BY o.available_at ASC NULLS LAST, o.updated_at ASC
    `);

    const orderIds = orders.map(o => o.id);
    const itemsMap = {};

    if (orderIds.length > 0) {
      const { rows: items } = await db.query(`
        SELECT oi.order_id, p.name AS nom, oi.quantity AS quantite,
          oi.price_kmf AS prix_kmf
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ANY($1)
      `, [orderIds]);

      for (const item of items) {
        if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
        itemsMap[item.order_id].push({
          nom: item.nom,
          quantite: Number(item.quantite),
          prix_kmf: Number(item.prix_kmf),
          status: 'complet',
        });
      }
    }

    function toRelaisOrder(o) {
      const heures = Math.round(Number(o.heures_attente));
      return {
        reference: o.reference,
        client_nom: o.client_nom || 'Client',
        client_phone: o.client_phone || '',
        produits: itemsMap[o.id] || [{ nom: 'Produit', quantite: 1, prix_kmf: Number(o.total_kmf), status: 'complet' }],
        total_kmf: Number(o.total_kmf),
        payment_mode: o.payment_mode === 'stripe_eur' ? 'stripe' : 'cash_relais',
        payment_status: o.payment_status === 'paid' ? 'paid' : 'pending',
        date_arrivee: o.available_at || o.created_at,
        heures_attente: heures,
        relais_nom: o.relais_nom || 'Relais inconnu',
        ile: o.ile || 'Comores',
        priorite: heures > 120 ? 'urgente' : 'normale',
      };
    }

    const result = {
      a_valider:  orders.filter(o => o.status === 'in_transit').map(toRelaisOrder),
      a_remettre: orders.filter(o => o.status === 'available').map(toRelaisOrder),
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

module.exports = router;

