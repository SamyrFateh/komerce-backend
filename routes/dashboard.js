/**
 * KOMERCE — Dashboard admin v7.2 — Pipeline fix (colonnes obsolètes)
 *
 * GET /api/dashboard/ops                          → pilotage opérationnel
 * GET /api/dashboard/sales?period=30              → ventes & marges
 * GET /api/dashboard/retards?niveau=...           → clients à contacter
 * GET /api/dashboard/forecast?target_date=...     → projections
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// Toutes les routes dashboard nécessitent authentification admin
router.use(authenticate, requireRole(['admin']));

// ─── Seuils SLA (commandes actives = non collected/cancelled) ─────────────────
// SLA annoncé : 3–5 semaines (21–35 jours)
const SLA_WARNING_DAYS  = 35;  // alerte après 35j
const SLA_LATE_DAYS     = 42;  // en retard après 42j
const SLA_BLOCKED_DAYS  = 56;  // bloqué après 56j (8 semaines)
const INACTIVE_DAYS     = 7;   // bloqué si pas d'activité depuis 7j

// Seuils compensation retards
const DELAY_PREVENTIF   = 28;  // 4 semaines → contact préventif
const DELAY_AVOIR       = 35;  // 5 semaines → avoir 5%
const DELAY_REMISE      = 42;  // 6 semaines → remise 10%
const DELAY_REMBOURSEMENT = 56; // 8 semaines → remboursement

// --- In-memory cache (TTL 30s) ---
const _cache = new Map();
function cached(key, ttlMs = 30000) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  return null;
}
function setCache(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

// ─── GET /api/dashboard/ops ──────────────────────────────────────────────────

router.get('/ops', async (req, res) => {
  try {
    const hit = cached('ops');
    if (hit) return res.json(hit);

    // ── Activité ──────────────────────────────────────────────────────────────
    const { rows: [activ] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)                                          AS commandes_aujourd_hui,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled'))                                   AS commandes_en_cours,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled')
                           AND updated_at < NOW() - INTERVAL '7 days')                                   AS commandes_bloquees,
        COUNT(*) FILTER (WHERE status = 'collected' AND updated_at::date = CURRENT_DATE)                 AS livrees_aujourd_hui,
        COUNT(*) FILTER (WHERE status = 'collected' AND updated_at >= NOW() - INTERVAL '30 days')        AS livrees_30j
      FROM orders
    `);

    // ── SLA ───────────────────────────────────────────────────────────────────
    const { rows: slaRows } = await db.query(`
      SELECT
        reference,
        status,
        created_at,
        updated_at,
        EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 AS age_jours,
        EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400 AS inactif_jours
      FROM orders
      WHERE status NOT IN ('collected','cancelled')
      ORDER BY created_at ASC
    `);

    const slaGroups = { on_time: 0, warning: 0, late: 0, blocked: 0 };
    const lateCmds  = [];

    for (const o of slaRows) {
      const age      = Number(o.age_jours);
      const inactif  = Number(o.inactif_jours);
      let   groupe;

      if (inactif >= INACTIVE_DAYS || age >= SLA_BLOCKED_DAYS) {
        groupe = 'blocked';
      } else if (age >= SLA_LATE_DAYS) {
        groupe = 'late';
        lateCmds.push({ reference: o.reference, status: o.status, jours: Math.round(age) });
      } else if (age >= SLA_WARNING_DAYS) {
        groupe = 'warning';
      } else {
        groupe = 'on_time';
      }
      slaGroups[groupe]++;
    }

    // ── Logistique ────────────────────────────────────────────────────────────

    // Dubai — 📥 Réceptionner : commandes commandées, en attente de réception au hub
    const { rows: dubaiReceptionItems } = await db.query(`
      SELECT o.reference, o.status,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(o.ordered_at, o.created_at))) / 86400 AS jours_dans_etape
      FROM orders o
      WHERE o.status = 'ordered'
      ORDER BY o.created_at ASC
      LIMIT 50
    `);

    // Dubai — 📦 Expédier : commandes reçues au hub, prêtes à expédier
    const { rows: dubaiExpeditionItems } = await db.query(`
      SELECT o.reference, o.status,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(o.ordered_at, o.created_at))) / 86400 AS jours_dans_etape
      FROM orders o
      WHERE o.status = 'preparation'
      ORDER BY o.created_at ASC
      LIMIT 50
    `);

    // Transitaire : remis au transitaire, en attente embarquement
    const { rows: transitaireItems } = await db.query(`
      SELECT o.reference, o.status,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(o.shipped_at, o.created_at))) / 86400 AS jours_attente
      FROM orders o
      WHERE o.status = 'shipped'
      ORDER BY o.shipped_at ASC NULLS LAST
      LIMIT 50
    `);

    // Bateau : embarqués, en transit maritime
    const { rows: bateauItems } = await db.query(`
      SELECT o.reference, o.shipment_id, o.status,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(o.shipped_at, o.created_at))) / 86400 AS jours_en_mer
      FROM orders o
      WHERE o.status = 'in_transit'
      ORDER BY o.shipped_at ASC NULLS LAST
      LIMIT 50
    `);

    // Anjouan : disponibles au relais
    const { rows: anjouanItems } = await db.query(`
      SELECT o.reference, rc.full_name AS destinataire,
             r.name AS relais_nom,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(o.available_at, o.updated_at))) / 3600 AS heures_en_attente
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      WHERE o.status = 'available'
      ORDER BY o.available_at ASC NULLS LAST
      LIMIT 50
    `);

    const logistique = {
      dubai_reception:  { count: dubaiReceptionItems.length,  items: dubaiReceptionItems,  label: '📥 Réceptionner' },
      dubai_expedition: { count: dubaiExpeditionItems.length, items: dubaiExpeditionItems, label: '📦 Expédier' },
      transitaire:      { count: transitaireItems.length,     items: transitaireItems,     label: '🏢 Transitaire' },
      bateau:           { count: bateauItems.length,          items: bateauItems,          label: '🚢 En mer' },
      anjouan:          { count: anjouanItems.length,         items: anjouanItems,         label: '📍 Relais Anjouan' },
    };

    // ── Délais moyens ─────────────────────────────────────────────────────────
    const { rows: [delais] } = await db.query(`
      SELECT
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(shipped_at, NOW()) - created_at)) / 86400)
          FILTER (WHERE status NOT IN ('cancelled')))::int AS avg_preparation_jours,
        ROUND(AVG(EXTRACT(EPOCH FROM (collected_at - created_at)) / 86400)
          FILTER (WHERE status = 'collected' AND collected_at IS NOT NULL))::int AS avg_livraison_totale_jours,
        ROUND(
          100.0 * COUNT(*) FILTER (
            WHERE status NOT IN ('collected','cancelled')
              AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 > $1
          ) / NULLIF(COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled')), 0),
          1
        ) AS pct_en_retard_raw
      FROM orders
    `, [SLA_LATE_DAYS]);

    const pct_retard = delais.pct_en_retard_raw !== null
      ? Number(delais.pct_en_retard_raw).toFixed(1) + '%'
      : '0.0%';

    // ── Alertes ───────────────────────────────────────────────────────────────

    // Cash relais en attente > 12h
    const { rows: [cashAlert] } = await db.query(`
      SELECT COUNT(*) AS count FROM orders
      WHERE payment_mode = 'cash_relais'
        AND payment_status = 'pending'
        AND created_at < NOW() - INTERVAL '12 hours'
    `);

    // Anomalies scan non traitées (orders bloqués sans activité 7j)
    const { rows: [anomAlert] } = await db.query(`
      SELECT COUNT(*) AS count FROM orders
      WHERE status NOT IN ('collected','cancelled')
        AND updated_at < NOW() - INTERVAL '7 days'
    `);

    // Stock faible < 3
    const { rows: [stockAlert] } = await db.query(`
      SELECT COUNT(*) AS count FROM products
      WHERE is_active = TRUE AND stock IS NOT NULL AND stock < 3
    `);

    const alertes = {
      cash_pending: { count: Number(cashAlert.count) },
      anomalies:    { count: Number(anomAlert.count) },
      low_stock:    { count: Number(stockAlert.count) },
      sms_failed:   { count: 0 }, // placeholder — nécessite table SMS log
    };

    // ── Clients en retard (résumé pour ops) ───────────────────────────────────
    const { rows: retardsRows } = await db.query(`
      SELECT o.reference, rc.full_name AS client,
             rc.phone AS phone,
             EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS jours,
             o.status
      FROM orders o
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      WHERE o.status NOT IN ('collected','cancelled')
        AND EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 >= $1
      ORDER BY jours DESC
      LIMIT 20
    `, [DELAY_PREVENTIF]);

    const clients_retards = {
      count: retardsRows.length,
      par_niveau: {},
      urgents: [],
    };

    for (const r of retardsRows) {
      const j = Number(r.jours);
      let comp, niveau;
      if (j >= DELAY_REMBOURSEMENT) {
        comp = 'remboursement_possible'; niveau = 'remboursement_possible';
      } else if (j >= DELAY_REMISE) {
        comp = 'remise_10%'; niveau = 'remise_10pct_prochaine_cmd';
      } else if (j >= DELAY_AVOIR) {
        comp = 'avoir_5%'; niveau = 'avoir_5pct';
      } else {
        comp = 'contact'; niveau = 'contact_préventif';
      }
      clients_retards.par_niveau[niveau] = (clients_retards.par_niveau[niveau] || 0) + 1;
      if (j >= DELAY_REMISE) {
        clients_retards.urgents.push({
          reference: r.reference,
          client: r.client,
          email: null,
          jours_retard: Math.round(j),
          compensation: comp,
        });
      }
    }

    const result = {
      activite: {
        commandes_aujourd_hui: Number(activ.commandes_aujourd_hui),
        commandes_en_cours:    Number(activ.commandes_en_cours),
        commandes_bloquees:    Number(activ.commandes_bloquees),
        livrees_aujourd_hui:   Number(activ.livrees_aujourd_hui),
        livrees_30j:           Number(activ.livrees_30j),
      },
      sla: {
        on_time: slaGroups.on_time,
        warning: slaGroups.warning,
        late:    slaGroups.late,
        blocked: slaGroups.blocked,
        details: { late: lateCmds.slice(0, 10) },
      },
      logistique,
      delais: {
        avg_preparation_jours:     delais.avg_preparation_jours,
        avg_livraison_totale_jours: delais.avg_livraison_totale_jours,
        pct_en_retard:             pct_retard,
      },
      alertes,
      clients_retards,
    };
    setCache('ops', result);
    res.json(result);

  } catch (err) {
    console.error('Dashboard ops error:', err.message);
    res.status(500).json({ error: 'Erreur pilotage opérationnel' });
  }
});

// ─── GET /api/dashboard/sales ────────────────────────────────────────────────

router.get('/sales', async (req, res) => {
  try {
    const period     = Math.max(1, Math.min(365, parseInt(req.query.period) || 30));
    const periodPrev = period; // même durée pour comparaison

    // ── KPI L1 — CA & marge ──────────────────────────────────────────────────
    const { rows: [kpi] } = await db.query(`
      SELECT
        -- Période courante
        COALESCE(SUM(total_kmf) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1), 0)                                                  AS ca_kmf,
        COALESCE(SUM(total_kmf) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1) / 492.0, 0)                                          AS ca_eur,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND status != 'cancelled')                                           AS nb_commandes,
        COALESCE(AVG(total_kmf) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day' * $1 AND status != 'cancelled'), 0)                        AS panier_moyen_kmf,

        -- Coûts pour marge décomposée (utilise cost_transport_kmf + cost_douane_kmf réels)
        COALESCE(SUM(total_kmf - cost_transport_kmf - cost_douane_kmf) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day' * $1
            AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0) AND status != 'cancelled'
        ), 0)                                                                                             AS marge_produit_kmf,
        COALESCE(SUM(cost_transport_kmf) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day' * $1
            AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0) AND status != 'cancelled'
        ), 0)                                                                                             AS cout_transport_kmf,
        COALESCE(SUM(cost_douane_kmf) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day' * $1
            AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0) AND status != 'cancelled'
        ), 0)                                                                                             AS cout_douane_kmf,
        COALESCE(SUM(total_kmf - cost_transport_kmf - cost_douane_kmf) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day' * $1
            AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0) AND status != 'cancelled'
        ), 0)                                                                                             AS marge_reelle_kmf,
        COUNT(*) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day' * $1
            AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0) AND status != 'cancelled'
        )                                                                                                 AS nb_avec_cost,
        COUNT(*) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day' * $1
            AND cost_transport_kmf = 0 AND cost_douane_kmf = 0 AND status != 'cancelled'
        )                                                                                                 AS nb_sans_cost,

        -- Période précédente (pour évolution)
        COALESCE(SUM(total_kmf) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day' * $2
            AND created_at <  NOW() - INTERVAL '1 day' * $1
        ), 0)                                                                                                                                         AS ca_prev_kmf,
        COUNT(*) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day' * $2
            AND created_at <  NOW() - INTERVAL '1 day' * $1
            AND status != 'cancelled'
        )                                                                                                                                             AS commandes_prev
      FROM orders
    `, [period, period * 2]);

    const ca        = Number(kpi.ca_kmf);
    const caPrev    = Number(kpi.ca_prev_kmf);
    const nbCmd     = Number(kpi.nb_commandes);
    const nbCmdPrev = Number(kpi.commandes_prev);
    const margeReel = Number(kpi.marge_reelle_kmf);
    const panierMoy = Number(kpi.panier_moyen_kmf);
    const caEur     = Number(kpi.ca_eur);

    const evo_ca  = caPrev > 0 ? ((ca - caPrev) / caPrev * 100).toFixed(1) + '%' : 'N/A';
    const evo_cmd = nbCmdPrev > 0 ? ((nbCmd - nbCmdPrev) / nbCmdPrev * 100).toFixed(1) + '%' : 'N/A';
    const tauxMarge = ca > 0 && Number(kpi.nb_avec_cost) > 0
      ? (margeReel / ca * 100).toFixed(1) + '%'
      : '—';

    // Alertes vente à perte
    const { rows: perteRows } = await db.query(`
      SELECT reference FROM orders
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND (cost_transport_kmf > 0 OR cost_douane_kmf > 0)
        AND total_kmf < (cost_transport_kmf + cost_douane_kmf)
        AND status != 'cancelled'
      LIMIT 10
    `, [period]);

    const marge = {
      marge_produit_kmf:   Math.round(Number(kpi.marge_produit_kmf)),
      cout_transport_kmf:  Math.round(Number(kpi.cout_transport_kmf)),
      cout_douane_kmf:     Math.round(Number(kpi.cout_douane_kmf)),
      marge_reelle_kmf:    Math.round(margeReel),
      taux_marge_moy:      tauxMarge,
      nb_sans_cost_renseigne: Number(kpi.nb_sans_cost),
      alerte_vente_a_perte: perteRows.length > 0
        ? { count: perteRows.length, commandes: perteRows }
        : null,
    };

    // ── Diaspora vs local ─────────────────────────────────────────────────────
    const { rows: diasporaRows } = await db.query(`
      SELECT
        'local' AS origine,
        COUNT(*) AS nb_commandes,
        COALESCE(SUM(total_kmf), 0) AS ca_kmf,
        COALESCE(AVG(total_kmf), 0) AS panier_moyen_kmf
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND status != 'cancelled'
      GROUP BY 1
      ORDER BY 1
    `, [period]);

    // ── Marge par catégorie ───────────────────────────────────────────────────
    const { rows: catRows } = await db.query(`
      SELECT
        p.category,
        COUNT(o.id) AS nb_commandes,
        COALESCE(SUM(o.total_kmf), 0) AS ca_kmf,
        COALESCE(SUM(o.total_kmf - o.cost_transport_kmf - o.cost_douane_kmf), 0) AS marge_produit_kmf,
        ROUND(
          CASE WHEN SUM(o.total_kmf) > 0
            THEN 100.0 * SUM(o.total_kmf - o.cost_transport_kmf - o.cost_douane_kmf)::numeric / SUM(o.total_kmf)
            ELSE 0 END, 1
        ) AS taux_marge_pct
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
      WHERE o.created_at >= NOW() - INTERVAL '1 day' * $1
        AND o.status != 'cancelled'
      GROUP BY p.category
      ORDER BY ca_kmf DESC
    `, [period]);

    // ── Top 10 produits ───────────────────────────────────────────────────────
    const { rows: topProds } = await db.query(`
      SELECT
        p.id, p.name, p.category,
        SUM(oi.quantity) AS qty_vendue,
        SUM(oi.price_kmf * oi.quantity) AS revenue_kmf,
        CASE WHEN SUM(CASE WHEN p.cost_kmf IS NOT NULL THEN 1 ELSE 0 END) > 0
          THEN ROUND(SUM(oi.price_kmf * oi.quantity - COALESCE(p.cost_kmf, 0) * oi.quantity))
          ELSE NULL
        END AS marge_kmf,
        CASE WHEN SUM(oi.price_kmf * oi.quantity) > 0
          THEN ROUND(100.0 * SUM(oi.price_kmf * oi.quantity - COALESCE(p.cost_kmf, 0) * oi.quantity) / NULLIF(SUM(oi.price_kmf * oi.quantity), 0), 1)
          ELSE NULL
        END AS taux_marge_pct
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
      WHERE o.created_at >= NOW() - INTERVAL '1 day' * $1
        AND o.status != 'cancelled'
      GROUP BY p.id, p.name, p.category
      ORDER BY revenue_kmf DESC
      LIMIT 10
    `, [period]);

    // ── Produits jamais vendus ────────────────────────────────────────────────
    const { rows: neverRows } = await db.query(`
      SELECT p.id, p.name, p.category
      FROM products p
      WHERE p.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = p.id AND o.status != 'cancelled'
        )
      ORDER BY p.name
    `);

    // ── Clients ───────────────────────────────────────────────────────────────
    const { rows: [clients] } = await db.query(`
      SELECT
        COUNT(DISTINCT user_id) FILTER (
          WHERE created_at >= NOW() - INTERVAL '1 day' * $1
            AND user_id IS NOT NULL
        ) AS nouveaux_cette_periode,
        COUNT(DISTINCT user_id) FILTER (
          WHERE user_id IN (
            SELECT user_id FROM orders
            WHERE status != 'cancelled' AND user_id IS NOT NULL
            GROUP BY user_id HAVING COUNT(*) >= 2
          )
        ) AS clients_recurrents,
        COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS total_clients
      FROM orders
    `, [period]);

    // BUG-004 fix: guard explicite pour nbClients=0 (base vide ou après reset)
    const nbClients   = Number(clients.total_clients);
    const nbRecurrents = Number(clients.clients_recurrents);
    const tauxReachat = nbClients > 0
      ? (nbRecurrents / nbClients * 100).toFixed(1) + '%'
      : '0%';

    // LTV moyen : CA total / nb clients uniques
    const { rows: [ltv] } = await db.query(`
      SELECT COALESCE(SUM(total_kmf) / NULLIF(COUNT(DISTINCT user_id), 0), 0) AS ltv_moyen_kmf
      FROM orders WHERE status != 'cancelled'
    `);

    res.json({
      period,
      kpi_l1: {
        ca_kmf:         Math.round(ca),
        ca_eur:         Math.round(caEur),
        nb_commandes:   nbCmd,
        panier_moyen_kmf: Math.round(panierMoy),
        taux_conversion: '—',  // nécessite sessions / visiteurs
        marge: marge,
        evolution: {
          ca_pct:         evo_ca,
          commandes_pct:  evo_cmd,
        },
      },
      kpi_l2: {
        diaspora_vs_local:   diasporaRows.map(r => ({
          ...r,
          ca_kmf: Math.round(Number(r.ca_kmf)),
          panier_moyen_kmf: Math.round(Number(r.panier_moyen_kmf)),
        })),
        marge_par_categorie: catRows.map(r => ({
          ...r,
          ca_kmf: Math.round(Number(r.ca_kmf)),
          marge_produit_kmf: Math.round(Number(r.marge_produit_kmf)),
        })),
      },
      kpi_l3: {
        taux_reachat_pct:  tauxReachat,
        ltv_moyen_kmf:     Math.round(Number(ltv.ltv_moyen_kmf)),
      },
      produits: {
        top_10: topProds.map(p => ({
          ...p,
          revenue_kmf: Math.round(Number(p.revenue_kmf)),
          marge_kmf:   p.marge_kmf !== null ? Math.round(Number(p.marge_kmf)) : null,
        })),
        jamais_vendus: {
          count: neverRows.length,
          items: neverRows,
        },
      },
      clients: {
        nouveaux_cette_periode: Number(clients.nouveaux_cette_periode),
        clients_recurrents:     nbRecurrents,
        total_clients:          Number(clients.total_clients),
      },
    });

  } catch (err) {
    console.error('Dashboard sales error:', err.message);
    res.status(500).json({ error: 'Erreur ventes & marges' });
  }
});

// ─── GET /api/dashboard/retards ──────────────────────────────────────────────

router.get('/retards', async (req, res) => {
  try {
    const { niveau } = req.query;

    // Récupérer toutes les commandes actives en retard
    const { rows } = await db.query(`
      SELECT
        o.id, o.reference, o.status,
        rc.full_name AS client_nom,
        rc.phone     AS client_phone,
        u.email            AS client_email,
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS age_jours,
        EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 86400 AS inactif_jours
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      WHERE o.status NOT IN ('collected','cancelled')
        AND EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 >= $1
      ORDER BY age_jours DESC
      LIMIT 200
    `, [DELAY_PREVENTIF]);

    // Classifier et filtrer
    const parNiveau = {
      remboursement_possible:    { count: 0, label: 'Remboursement possible (8 sem+)' },
      remise_10pct_prochaine_cmd: { count: 0, label: 'Remise −10% prochaine commande' },
      avoir_5pct:                { count: 0, label: 'Avoir 5% offert' },
      contact_préventif:         { count: 0, label: 'Contact préventif' },
    };

    const clients = rows
      .map(o => {
        const jours = Number(o.age_jours);
        let niv, comp, sms;

        if (jours >= DELAY_REMBOURSEMENT) {
          niv  = 'remboursement_possible';
          comp = 'remboursement_possible';
          sms  = `Bonjour ${o.client_nom || 'cher client'}, votre commande ${o.reference} accuse un retard important. Nous vous contactons pour trouver une solution. Komerce`;
        } else if (jours >= DELAY_REMISE) {
          niv  = 'remise_10pct_prochaine_cmd';
          comp = 'remise_10pct_prochaine_cmd';
          sms  = `Komerce : Nous nous excusons pour le délai sur ${o.reference}. En compensation, bénéficiez de −10% sur votre prochaine commande. Merci de votre patience.`;
        } else if (jours >= DELAY_AVOIR) {
          niv  = 'avoir_5pct';
          comp = 'avoir_5pct';
          sms  = `Komerce : Votre commande ${o.reference} prend plus de temps que prévu. Nous vous offrons un avoir de 5%. Merci pour votre patience.`;
        } else {
          niv  = 'contact_préventif';
          comp = 'contact_préventif';
          sms  = `Komerce : Votre commande ${o.reference} est en cours de traitement. Nous vous tenons informé dès que votre colis est expédié.`;
        }

        parNiveau[niv].count++;

        return {
          reference:                o.reference,
          status:                   o.status,
          client_nom:               o.client_nom,
          client_phone:             o.client_phone,
          client_email:             o.client_email,
          jours_de_retard:          Math.round(jours),
          type_retard:              jours >= SLA_LATE_DAYS ? 'retard' : 'préventif',
          compensation_recommandee: comp,
          sms_suggere:              sms,
          _niveau:                  niv,
        };
      })
      .filter(o => !niveau || o._niveau === niveau)
      .map(({ _niveau, ...rest }) => rest);

    res.json({
      total:     clients.length,
      par_niveau: parNiveau,
      clients,
    });

  } catch (err) {
    console.error('Dashboard retards error:', err.message);
    res.status(500).json({ error: 'Erreur retards' });
  }
});

// ─── GET /api/dashboard/forecast ─────────────────────────────────────────────

router.get('/forecast', async (req, res) => {
  try {
    const {
      target_date,
      ref_period = 30,
      from_date,
    } = req.query;

    if (!target_date) {
      return res.status(400).json({ error: 'target_date obligatoire (YYYY-MM-DD)' });
    }

    const targetDt    = new Date(target_date);
    const today       = new Date();
    if (isNaN(targetDt.getTime()) || targetDt <= today) {
      return res.status(400).json({ error: 'target_date doit être dans le futur' });
    }

    const daysRemaining = Math.ceil((targetDt - today) / 86400000);
    const refPeriod     = Math.max(1, Math.min(365, parseInt(ref_period)));
    const fromDt        = from_date ? new Date(from_date) : new Date(today.getTime() - refPeriod * 86400000);
    const fromStr       = fromDt.toISOString().split('T')[0];

    const cacheKey = `forecast_${fromStr}_${target_date}_${refPeriod}`;
    const fHit = cached(cacheKey);
    if (fHit) return res.json(fHit);

    // Réalisé depuis from_date
    const { rows: [realise] } = await db.query(`
      SELECT
        COALESCE(SUM(total_kmf), 0) AS ca_kmf,
        COALESCE(SUM(total_kmf - cost_transport_kmf - cost_douane_kmf), 0) AS marge_reelle_kmf
      FROM orders
      WHERE status != 'cancelled'
        AND created_at >= $1
        AND created_at <= NOW()
    `, [fromStr]);

    // Statistiques journalières sur la période de référence pour le modèle
    const { rows: statsRows } = await db.query(`
      SELECT
        created_at::date AS jour,
        SUM(total_kmf) AS ca_jour
      FROM orders
      WHERE status != 'cancelled'
        AND created_at >= NOW() - INTERVAL '1 day' * $1
      GROUP BY 1
      ORDER BY 1
    `, [refPeriod]);

    const dailyCAs = statsRows.map(r => Number(r.ca_jour));
    const nbDays   = dailyCAs.length || 1;
    const avgCA    = dailyCAs.reduce((s, v) => s + v, 0) / nbDays;
    const variance = dailyCAs.reduce((s, v) => s + Math.pow(v - avgCA, 2), 0) / nbDays;
    const stddev   = Math.sqrt(variance);

    // Projection : réalisé + (jours restants × scénario)
    const caRealise = Number(realise.ca_kmf);
    const margeReal = Number(realise.marge_reelle_kmf);

    const proj_pessimiste = caRealise + daysRemaining * Math.max(0, avgCA - stddev);
    const proj_attendu    = caRealise + daysRemaining * avgCA;
    const proj_optimiste  = caRealise + daysRemaining * (avgCA + stddev);

    // Marge projetée (utilise le taux moyen réalisé ou 20% si pas de données)
    const tauxMargeReel = caRealise > 0 ? margeReal / caRealise : 0.20;
    const marge_pess    = proj_pessimiste  * tauxMargeReel;
    const marge_att     = proj_attendu     * tauxMargeReel;
    const marge_opt     = proj_optimiste   * tauxMargeReel;

    const alertePerte = marge_att < 0
      ? `⚠️ Projection de marge négative (${Math.round(marge_att).toLocaleString('fr-FR')} KMF) — vérifier les coûts`
      : null;

    const forecastResult = {
      from_date:     fromStr,
      target_date:   target_date,
      days_remaining: daysRemaining,
      realise: {
        ca_kmf:          Math.round(caRealise),
        marge_reelle_kmf: Math.round(margeReal),
      },
      modele: {
        note:              `Modèle linéaire basé sur l'historique`,
        ref_period_jours:  refPeriod,
        avg_ca_par_jour:   Math.round(avgCA),
        stddev_ca:         Math.round(stddev),
      },
      projection_ca: {
        pessimiste: Math.round(proj_pessimiste),
        attendu:    Math.round(proj_attendu),
        optimiste:  Math.round(proj_optimiste),
      },
      projection_marge: {
        pessimiste:      Math.round(marge_pess),
        attendu:         Math.round(marge_att),
        optimiste:       Math.round(marge_opt),
        taux_marge_proj: (tauxMargeReel * 100).toFixed(1) + '%',
        alerte_perte:    alertePerte,
      },
    };
    setCache(cacheKey, forecastResult);
    res.json(forecastResult);

  } catch (err) {
    console.error('Dashboard forecast error:', err.message);
    res.status(500).json({ error: 'Erreur prévisions' });
  }
});

// ─── GET /api/dashboard/pipeline ──────────────────────────────────────────────
// Pipeline Kanban — toutes les commandes avec leur statut actuel + timestamps
// Retourne les commandes groupées par étape du pipeline

router.get('/pipeline', async (req, res) => {
  try {
    const hit = cached('pipeline');
    if (hit) return res.json(hit);

    const { rows } = await db.query(`
      SELECT
        o.id,
        o.reference,
        o.status,
        o.total_kmf,
        o.payment_mode,
        o.payment_status,
        o.created_at,
        o.ordered_at,
        o.shipped_at,
        o.available_at,
        o.collected_at,
        o.cancelled_at,
        o.updated_at,
        u.full_name   AS client_name,
        u.phone       AS client_phone,
        rc.full_name  AS recipient_name,
        rc.phone      AS recipient_phone,
        r.name        AS relais_name,
        (SELECT p.name FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = o.id
         ORDER BY oi.created_at ASC LIMIT 1
        ) AS product_name,
        (SELECT p.image_url FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = o.id
         ORDER BY oi.created_at ASC LIMIT 1
        ) AS product_image_url,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id)::int AS items_count,
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS age_jours,
        EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 86400 AS inactif_jours
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      LEFT JOIN relais r ON r.id = o.relais_id
      ORDER BY o.created_at DESC
    `);

    // Group by status
    const STAGES = [
      'confirmed', 'ordered', 'preparation',
      'shipped', 'available', 'collected',
      'cancelled', 'refunded'
    ];

    const pipeline = {};
    for (const s of STAGES) {
      pipeline[s] = { count: 0, orders: [] };
    }

    let active = 0;
    for (const order of rows) {
      const s = order.status;
      if (pipeline[s]) {
        pipeline[s].count++;
        pipeline[s].orders.push(order);
      }
      if (!['collected', 'cancelled', 'refunded'].includes(s)) active++;
    }

    const result = { total: rows.length, active, pipeline };
    setCache('pipeline', result);
    res.json(result);
  } catch (err) {
    console.error('[dashboard/pipeline] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur pipeline' });
  }
});

module.exports = router;
