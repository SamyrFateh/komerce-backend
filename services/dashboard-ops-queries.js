/**
 * @komerce-arch
 * @role          dashboard-dashboard-ops-queries
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, routes/dashboard-shared.js, services/economic-engine-queries.js, utils/logger.js
 * @used-by       routes/dashboard-ops.js
 * @db-read       customs_effective_rates, exchange_rates, incidents, invoices, order_items, orders, parcels, products, recipients, relais, scan_events, users
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * services/dashboard-ops-queries.js
 *
 * Extrait de routes/dashboard-ops.js — R9 (2026-06-14)
 *
 * Expose :
 *   getOps()                      — GET /ops  (activité, SLA, logistique, alertes)
 *   getPilotage(mois)             — GET /pilotage  (coûts & marges)
 *   getPipeline()                 — GET /pipeline  (kanban commandes)
 *   getRetards(niveau?)           — GET /retards  (clients en retard + compensations)
 *   getForecast(params)           — GET /forecast  (projections CA)
 *   getGlobal()                   — GET /global  (vue unifiée CT)
 *   getStats()                    — GET /stats  (alias /global avec mapping pilotage)
 *
 * Bug pré-existant corrigé : getEcoVar était appelé dans /pilotage sans être
 * importé nulle part. Il est résolu ici via economic-engine-queries.getVar()
 * qui lit directement economic_variables — c'est la bonne source.
 */

const db  = require('../db');
const log = require('../utils/logger').child({ module: 'dashboard-ops-queries' });
const { getEurKmf, loadDashConfig } = require('../routes/dashboard-shared');

// FIX : getEcoVar était undefined dans la route d'origine.
// On délègue à economic-engine-queries.getVar() qui fait la même lecture DB.
const { getVar: getEcoVar } = require('./economic-engine-queries');

// ─── getOps ───────────────────────────────────────────────────────────────

async function getOps() {
  const cfg = await loadDashConfig();

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

  const { rows: [delais] } = await db.query(`
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(shipped_at, NOW()) - created_at)) / 86400)
        FILTER (WHERE status NOT IN ('cancelled')))::int AS avg_preparation_jours,
      ROUND(AVG(EXTRACT(EPOCH FROM (collected_at - created_at)) / 86400)
        FILTER (WHERE status = 'collected' AND collected_at IS NOT NULL))::int AS avg_livraison_totale_jours
    FROM orders
  `);

  const [cashAlert, anomAlert, stockAlert] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS c FROM orders
      WHERE payment_mode = 'cash_relais' AND payment_status = 'pending'
        AND created_at < NOW() - INTERVAL '12 hours'`),
    db.query(`SELECT COUNT(*)::int AS c FROM orders
      WHERE status NOT IN ('collected','cancelled') AND updated_at < NOW() - INTERVAL '7 days'`),
    db.query(`SELECT COUNT(*)::int AS c FROM products
      WHERE is_active = TRUE AND stock IS NOT NULL AND stock < 3`),
  ]);

  return {
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
}

// ─── getPilotage ─────────────────────────────────────────────────────────

async function getPilotage(mois) {
  const [annee, moisNum] = mois.split('-').map(Number);
  const debutMois = `${mois}-01`;
  const finMois   = new Date(Date.UTC(annee, moisNum, 1)).toISOString().split('T')[0];
  const rates     = await getEurKmf();

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

  const { rows: catRows } = await db.query(`
    SELECT p.category, COUNT(oi.id) AS nb_articles, COUNT(DISTINCT oi.order_id) AS nb_commandes,
      COALESCE(SUM(oi.price_kmf * oi.quantity), 0) AS ca_kmf
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders o   ON o.id = oi.order_id
    WHERE o.created_at >= $1 AND o.created_at < $2 AND o.status != 'cancelled'
    GROUP BY p.category ORDER BY nb_commandes DESC
  `, [debutMois, finMois]);

  // Taux douane effectif — fallback en cascade
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
      douaneSource = rows[0].period;
    }
  } catch { /* vue pas encore disponible — migration 034 non passée */ }

  const { rows: pipelineRows } = await db.query(`
    SELECT status, COUNT(*) AS nb FROM orders WHERE status != 'cancelled' GROUP BY status ORDER BY nb DESC
  `);

  const { rows: ratesHistory } = await db.query(
    'SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC LIMIT 6'
  );

  const caKmf = parseFloat(vol.ca_kmf);
  const customsDefault = await getEcoVar('customs_rate_default_pct', 42);
  const TAUX_TERRAIN = douaneEffectif ? douaneEffectif / 100 : customsDefault / 100;
  const hubCostAed = await getEcoVar('hub_monthly_cost_aed', 7000);
  const hubMensuelKmf = hubCostAed * rates.aed_kmf;

  return {
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
}

// ─── getPipeline ─────────────────────────────────────────────────────────

async function getPipeline() {
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

  return { total: rows.length, active, pipeline };
}

// ─── getRetards ───────────────────────────────────────────────────────────

async function getRetards(niveau) {
  const cfg = await loadDashConfig();

  const { rows } = await db.query(`
    SELECT o.id, o.reference, o.status,
      COALESCE(p.recipient_name, u.full_name, rc.full_name) AS client_nom,
      COALESCE(p.recipient_phone, u.phone, rc.phone) AS client_phone,
      u.email AS client_email,
      EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS age_jours
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT recipient_name, recipient_phone
      FROM parcels
      WHERE order_id = o.id AND status != 'cancelled'
      ORDER BY created_at DESC LIMIT 1
    ) p ON true
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN recipients rc ON rc.id = o.recipient_id
    WHERE o.status NOT IN ('collected','cancelled')
      AND EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 >= $1
    ORDER BY age_jours DESC LIMIT 200
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

  return { total: clients.length, par_niveau: parNiveau, clients };
}

// ─── getForecast ──────────────────────────────────────────────────────────

async function getForecast({ target_date, ref_period = 30 }) {
  const targetDt = new Date(target_date);
  const today    = new Date();
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

  return {
    target_date, days_remaining: daysRemaining,
    realise_kmf: Math.round(caRealise),
    modele: { ref_period_jours: refPeriod, avg_ca_jour: Math.round(avgCA), stddev: Math.round(stddev) },
    projection: {
      pessimiste: Math.round(caRealise + daysRemaining * Math.max(0, avgCA - stddev)),
      attendu:    Math.round(caRealise + daysRemaining * avgCA),
      optimiste:  Math.round(caRealise + daysRemaining * (avgCA + stddev)),
    },
  };
}

// ─── getGlobal ────────────────────────────────────────────────────────────

async function getGlobal() {
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
    const { rows: [sc] } = await db.query('SELECT COUNT(*)::int AS c FROM scan_events');
    scanCount = sc.c;
  } catch (_) {}

  let invoiceCount = 0;
  try {
    const { rows: [inv] } = await db.query('SELECT COUNT(*)::int AS c FROM invoices');
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

  return {
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
      reference: o.reference, status: o.status, total_kmf: Number(o.total_kmf),
      payment_mode: o.payment_mode, customer_name: o.customer_name,
      relais_name: o.relais_name, island: o.island, created_at: o.created_at,
    })),
  };
}

// ─── getStats ─────────────────────────────────────────────────────────────
// Alias /global avec mapping pour compatibilité ct-views-pilotage.js

async function getStats() {
  const g = await getGlobal();
  return {
    panier_moyen_kmf: g.kpi.avg_basket_kmf,
    avgBasket: g.kpi.avg_basket_kmf,
    nb_clients: g.kpi.nb_clients,
    total_orders: g.kpi.total_orders,
    active_orders: g.kpi.active_orders,
    completed_orders: g.kpi.completed_orders,
    ca_total_kmf: g.kpi.ca_total_kmf,
    kpi: g.kpi,
  };
}

module.exports = { getOps, getPilotage, getPipeline, getRetards, getForecast, getGlobal, getStats };
