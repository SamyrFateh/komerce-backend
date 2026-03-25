/**
 * KOMERCE — Dashboard opérationnel + analyse des ventes
 * Version 2.0 · Mars 2026
 *
 * ══════════════════════════════════════════════════════════════════
 * PILOTAGE (opérationnel — temps réel)
 *   GET /api/dashboard/ops
 *
 *   • Activité du jour : commandes aujourd'hui / en cours / bloquées / livrées
 *   • Logistique par étape :
 *       - Dubai    : paid + preparation (à préparer / prêt à partir)
 *       - Bateau   : shipped (en transit)
 *       - Anjouan  : available (au relais, à récupérer)
 *   • Délais moyens : préparation, livraison, % en retard
 *   • SLA : on_time / warning / late / blocked
 *   • Cash relais en attente, anomalies, stock faible, SMS échoués
 *
 * ══════════════════════════════════════════════════════════════════
 * ANALYSE DES VENTES (business — moyen/long terme)
 *   GET /api/dashboard/sales?period=30
 *
 *   KPI Niveau 1 (obligatoires) :
 *     - CA total · Nombre commandes · Panier moyen · Marge totale
 *   KPI Niveau 2 (importants) :
 *     - Marge par catégorie · CA diaspora vs local · % cash vs stripe
 *   KPI Niveau 3 (avancés) :
 *     - LTV client · Taux de réachat · Produits récurrents
 *
 *   Marge réelle :
 *     prix payé client
 *     - coût réel achat (products.cost_kmf)
 *     - coût réel transport (orders.cost_transport_kmf)
 *     - coût réel douane (orders.cost_douane_kmf)
 *     = MARGE RÉELLE
 *
 * Toutes les routes sont réservées à l'admin.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const adminOnly = [authenticate, requireRole(['admin'])];

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/ops
// ══════════════════════════════════════════════════════════════════════════════

router.get('/ops', ...adminOnly, async (req, res) => {
  try {

    // ── 1. ACTIVITÉ DU JOUR ─────────────────────────────────────────────────
    const { rows: [today] } = await db.query(`
      SELECT
        -- Nouvelles commandes aujourd'hui (toutes)
        COUNT(*) FILTER (
          WHERE DATE(created_at) = CURRENT_DATE
        )                                                       AS commandes_aujourd_hui,

        -- Commandes actives (non terminées)
        COUNT(*) FILTER (
          WHERE status NOT IN ('collected','cancelled','refunded')
            AND payment_status = 'paid'
        )                                                       AS commandes_en_cours,

        -- Bloquées : aucun scan depuis 7j, pas encore livrées
        COUNT(*) FILTER (
          WHERE status NOT IN ('available','collected','cancelled','refunded')
            AND payment_status = 'paid'
            AND updated_at < NOW() - INTERVAL '7 days'
        )                                                       AS commandes_bloquees,

        -- Livrées aujourd'hui
        COUNT(*) FILTER (
          WHERE status = 'collected'
            AND DATE(collected_at) = CURRENT_DATE
        )                                                       AS livrees_aujourd_hui,

        -- Livrées sur les 30 derniers jours
        COUNT(*) FILTER (
          WHERE status = 'collected'
            AND collected_at >= NOW() - INTERVAL '30 days'
        )                                                       AS livrees_30j
      FROM orders
    `);

    // ── 2. LOGISTIQUE PAR ÉTAPE ─────────────────────────────────────────────
    // Dubai = commandes payées pas encore expédiées (préparation en cours)
    const { rows: dubai } = await db.query(`
      SELECT o.reference, o.total_kmf, o.status,
             o.created_at, o.updated_at,
             EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400 AS jours_dans_etape
      FROM orders o
      WHERE o.payment_status = 'paid'
        AND o.status IN ('paid','preparation')
      ORDER BY o.updated_at ASC
      LIMIT 50
    `);

    // Bateau = en transit (shipped mais pas encore au relais)
    const { rows: transit } = await db.query(`
      SELECT o.reference, o.total_kmf, o.shipped_at,
             s.reference AS shipment_ref, s.eta,
             EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 AS jours_en_mer
      FROM orders o
      LEFT JOIN shipments s ON s.id = o.shipment_id
      WHERE o.status = 'shipped'
      ORDER BY o.shipped_at ASC
      LIMIT 50
    `);

    // Anjouan = arrivé au relais, pas encore récupéré
    const { rows: anjouan } = await db.query(`
      SELECT o.reference, o.total_kmf, o.available_at,
             r.name AS relais_name, r.zone,
             rc.full_name AS destinataire, rc.phone AS destinataire_phone,
             EXTRACT(EPOCH FROM (NOW() - o.available_at))/3600 AS heures_en_attente
      FROM orders o
      LEFT JOIN relais     r  ON r.id  = o.relais_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      WHERE o.status = 'available'
      ORDER BY o.available_at ASC
      LIMIT 50
    `);

    // ── 3. DÉLAIS MOYENS ────────────────────────────────────────────────────
    // Délai moyen de préparation : paid → premiere scan 'preparation'
    const { rows: [prepDelay] } = await db.query(`
      SELECT ROUND(AVG(
        EXTRACT(EPOCH FROM (
          first_prep.prep_at - o.updated_at
        ))/86400
      ), 1) AS avg_days_preparation
      FROM orders o
      JOIN (
        SELECT order_id, MIN(created_at) AS prep_at
        FROM scans
        WHERE step = 'preparation'
        GROUP BY order_id
      ) first_prep ON first_prep.order_id = o.id
      WHERE o.payment_status = 'paid'
        AND o.created_at >= NOW() - INTERVAL '90 days'
    `);

    // Délai moyen livraison complète : paid → collected
    const { rows: [deliveryDelay] } = await db.query(`
      SELECT ROUND(AVG(
        EXTRACT(EPOCH FROM (collected_at - updated_at))/86400
      ), 1) AS avg_days_delivery
      FROM orders
      WHERE status = 'collected'
        AND payment_status = 'paid'
        AND collected_at IS NOT NULL
        AND created_at >= NOW() - INTERVAL '90 days'
    `);

    // % de commandes en retard (>35j depuis paiement, pas encore livrées)
    const { rows: [latePct] } = await db.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE EXTRACT(EPOCH FROM (NOW() - updated_at))/86400 > 35
        )::float / NULLIF(COUNT(*), 0) * 100 AS pct_late
      FROM orders
      WHERE payment_status = 'paid'
        AND status NOT IN ('collected','cancelled','refunded')
    `);

    // ── 4. SLA DÉTAILLÉ ─────────────────────────────────────────────────────
    // SLA Komerce : paid→preparation 2j · preparation→shipped 3j · shipped→available 35j

    const { rows: slaRows } = await db.query(`
      SELECT
        o.id, o.reference, o.status, o.updated_at,
        o.shipped_at, o.available_at,
        EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400 AS total_days_active,
        -- Délai preparation
        EXTRACT(EPOCH FROM (
          COALESCE(
            (SELECT MIN(s.created_at) FROM scans s WHERE s.order_id = o.id AND s.step = 'preparation'),
            NOW()
          ) - o.updated_at
        ))/86400 AS days_to_preparation,
        -- Délai preparation→shipped
        CASE WHEN o.shipped_at IS NOT NULL THEN
          EXTRACT(EPOCH FROM (
            o.shipped_at - COALESCE(
              (SELECT MIN(s.created_at) FROM scans s WHERE s.order_id = o.id AND s.step = 'preparation'),
              o.updated_at
            )
          ))/86400
        END AS days_prep_to_shipped,
        -- Délai shipped→available
        CASE WHEN o.available_at IS NOT NULL AND o.shipped_at IS NOT NULL THEN
          EXTRACT(EPOCH FROM (o.available_at - o.shipped_at))/86400
        WHEN o.shipped_at IS NOT NULL THEN
          EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400
        END AS days_shipped_to_available,
        -- Dernier scan
        (SELECT MAX(s2.created_at) FROM scans s2 WHERE s2.order_id = o.id) AS last_scan_at
      FROM orders o
      WHERE o.status NOT IN ('draft','confirmed','cancelled','refunded')
        AND o.payment_status = 'paid'
    `);

    const sla = { on_time: 0, warning: 0, late: 0, blocked: 0, details: { warning: [], late: [], blocked: [] } };

    for (const row of slaRows) {
      const daysSinceScan = row.last_scan_at
        ? (Date.now() - new Date(row.last_scan_at)) / 86400000
        : row.total_days_active;

      // Bloqué = aucun scan depuis 7j (sauf si déjà available = au relais)
      if (daysSinceScan > 7 && row.status !== 'available') {
        sla.blocked++;
        sla.details.blocked.push({ reference: row.reference, status: row.status, jours_sans_scan: Math.round(daysSinceScan) });
        continue;
      }

      let breach = false, warn = false;

      if (row.status === 'paid' || row.status === 'preparation') {
        if (row.days_to_preparation > 2) breach = true;
        else if (row.days_to_preparation > 1) warn = true;
      }
      if (row.days_prep_to_shipped > 3) breach = true;
      else if (row.days_prep_to_shipped > 2) warn = true;

      if (row.days_shipped_to_available > 35) breach = true;
      else if (row.days_shipped_to_available > 30) warn = true;

      if (breach) {
        sla.late++;
        sla.details.late.push({ reference: row.reference, status: row.status, jours: Math.round(row.total_days_active) });
      } else if (warn) {
        sla.warning++;
        sla.details.warning.push({ reference: row.reference, status: row.status, jours: Math.round(row.total_days_active) });
      } else {
        sla.on_time++;
      }
    }

    // ── 5. CASH RELAIS EN ATTENTE (>12h) ───────────────────────────────────
    const { rows: cashPending } = await db.query(`
      SELECT reference, created_at, total_kmf, cash_ref_code,
             ROUND(EXTRACT(EPOCH FROM (NOW() - created_at))/3600, 1) AS heures_attente
      FROM orders
      WHERE payment_mode = 'cash_relais'
        AND payment_status = 'pending'
        AND status = 'confirmed'
        AND created_at <= NOW() - INTERVAL '12 hours'
      ORDER BY created_at ASC
    `);

    // ── 6. ANOMALIES SCAN ───────────────────────────────────────────────────
    const { rows: anomalies } = await db.query(`
      SELECT s.id, s.step, s.location, s.notes, s.created_at,
             o.reference AS commande
      FROM scans s
      LEFT JOIN orders o ON o.id = s.order_id
      WHERE s.is_anomaly = TRUE
      ORDER BY s.created_at DESC
      LIMIT 20
    `);

    // ── 7. STOCK FAIBLE (<3 unités) ─────────────────────────────────────────
    const { rows: lowStock } = await db.query(`
      SELECT sku, name, category, emoji, stock
      FROM products
      WHERE is_active = TRUE AND stock < 3
      ORDER BY stock ASC
    `);

    // ── 8. SMS ÉCHOUÉS (24h) ────────────────────────────────────────────────
    const { rows: smsFailed } = await db.query(`
      SELECT recipient, type, created_at
      FROM sms_log
      WHERE status = 'failed'
        AND created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
    `);

    // ── 9. CLIENTS À CONTACTER — RETARDS ET COMPENSATIONS ───────────────────
    // Logique :
    //   - "En retard avéré"    : commande payée depuis >35 jours, pas encore livrée
    //   - "En retard probable" : expédiée depuis >28 jours, ETA dépassée ou proche
    //   - "Risque délai"       : payée depuis >5 jours, pas encore de scan préparation
    //
    // Compensation recommandée (seuils à adapter selon ta politique) :
    //   • Risque délai (pas encore expédié)       → prévenir le client
    //   • Retard 1–7j (35–42j depuis paiement)    → avoir / code promo 5%
    //   • Retard 7–14j (42–49j depuis paiement)   → remise 10% prochaine commande
    //   • Retard >14j (>49j depuis paiement)      → remboursement possible

    const { rows: clientsRetards } = await db.query(`
      SELECT
        o.id              AS order_id,
        o.reference,
        o.status,
        o.total_kmf,
        o.payment_mode,
        o.created_at      AS commande_le,
        o.shipped_at,
        o.available_at,

        -- Durée totale depuis paiement (jours)
        ROUND(EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400, 1)
                          AS jours_depuis_paiement,

        -- Durée en mer si expédiée
        CASE WHEN o.shipped_at IS NOT NULL AND o.status = 'shipped'
          THEN ROUND(EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400, 1)
        END               AS jours_en_mer,

        -- ETA shipment si disponible
        s.eta             AS eta_arrivee,
        s.reference       AS shipment_ref,
        CASE WHEN s.eta IS NOT NULL
          THEN ROUND(EXTRACT(EPOCH FROM (s.eta - NOW()))/86400, 0)
        END               AS jours_avant_eta,

        -- Client
        u.full_name       AS client_nom,
        u.email           AS client_email,
        u.phone           AS client_phone,
        u.country         AS client_pays,

        -- Destinataire aux Comores
        rc.full_name      AS destinataire_nom,
        rc.phone          AS destinataire_phone,

        -- Relais cible
        r.name            AS relais_nom,

        -- Classification du retard
        CASE
          -- Payé depuis >5j sans scan préparation : risque en amont
          WHEN o.status IN ('paid','preparation')
            AND EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400 > 5
            THEN 'risque_délai'

          -- Expédié depuis >35j : SLA maritime dépassé
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 35
            THEN 'retard_avéré'

          -- Expédié depuis 28–35j : fenêtre critique
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 28
            THEN 'retard_probable'

          -- ETA dépassée d'au moins 3 jours
          WHEN s.eta IS NOT NULL AND s.eta < NOW() - INTERVAL '3 days'
            AND o.status = 'shipped'
            THEN 'eta_dépassée'

          ELSE NULL
        END               AS type_retard,

        -- Retard en jours (vs SLA 35j maritime ou 5j préparation)
        CASE
          WHEN o.status IN ('paid','preparation')
            THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400, 0) - 5)
          WHEN o.status = 'shipped'
            THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400, 0) - 35)
          ELSE 0
        END               AS jours_de_retard,

        -- Compensation recommandée
        CASE
          -- Pas encore expédié depuis >5j : prévenir seulement
          WHEN o.status IN ('paid','preparation')
            AND EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400 > 5
            THEN 'contact_préventif'

          -- 1 à 7 jours de retard maritime
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 BETWEEN 35 AND 42
            THEN 'avoir_5pct'

          -- 7 à 14 jours de retard maritime
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 BETWEEN 42 AND 49
            THEN 'remise_10pct_prochaine_cmd'

          -- Plus de 14 jours de retard maritime
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 49
            THEN 'remboursement_possible'

          -- ETA dépassée
          WHEN s.eta IS NOT NULL AND s.eta < NOW() - INTERVAL '3 days'
            THEN 'avoir_5pct'

          -- Fenêtre critique 28–35j : prévenir avant dépassement
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 28
            THEN 'contact_préventif'

          ELSE NULL
        END               AS compensation_recommandee

      FROM orders o
      LEFT JOIN users      u  ON u.id  = o.user_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      LEFT JOIN relais      r  ON r.id  = o.relais_id
      LEFT JOIN shipments   s  ON s.id  = o.shipment_id

      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('collected','cancelled','refunded','available')
        AND (
          -- Payé depuis >5j sans avoir été expédié
          (o.status IN ('paid','preparation')
            AND EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400 > 5)
          OR
          -- En mer depuis >28j
          (o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 28)
          OR
          -- ETA dépassée de 3j
          (s.eta IS NOT NULL AND s.eta < NOW() - INTERVAL '3 days' AND o.status = 'shipped')
        )
      ORDER BY
        -- Les plus critiques en premier
        CASE
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 49 THEN 1
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 42 THEN 2
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 35 THEN 3
          WHEN s.eta IS NOT NULL AND s.eta < NOW() - INTERVAL '3 days' THEN 4
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 28 THEN 5
          ELSE 6
        END ASC,
        jours_en_mer DESC NULLS LAST
    `);

    // Comptage par niveau de compensation
    const compensationSummary = clientsRetards.reduce((acc, c) => {
      const k = c.compensation_recommandee || 'ok';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

    // ── RÉPONSE ─────────────────────────────────────────────────────────────
    res.json({
      generated_at: new Date().toISOString(),

      // Vue d'ensemble du jour
      activite: {
        commandes_aujourd_hui: parseInt(today.commandes_aujourd_hui),
        commandes_en_cours:    parseInt(today.commandes_en_cours),
        commandes_bloquees:    parseInt(today.commandes_bloquees),
        livrees_aujourd_hui:   parseInt(today.livrees_aujourd_hui),
        livrees_30j:           parseInt(today.livrees_30j),
      },

      // Logistique par étape géographique
      logistique: {
        dubai:   { label: 'Dubai – À préparer',       count: dubai.length,   items: dubai   },
        bateau:  { label: 'Bateau – En transit',      count: transit.length, items: transit },
        anjouan: { label: 'Anjouan – À récupérer',    count: anjouan.length, items: anjouan },
      },

      // Délais (objectif : 3–5 semaines total)
      delais: {
        avg_preparation_jours: prepDelay.avg_days_preparation || 0,
        avg_livraison_totale_jours: deliveryDelay.avg_days_delivery || 0,
        pct_en_retard: parseFloat(latePct.pct_late || 0).toFixed(1) + '%',
        objectif_semaines: '3 à 5 semaines',
      },

      // SLA détaillé
      sla: {
        on_time: sla.on_time,
        warning: sla.warning,
        late:    sla.late,
        blocked: sla.blocked,
        details: sla.details,
      },

      // Alertes
      alertes: {
        cash_pending: { count: cashPending.length, items: cashPending },
        anomalies:    { count: anomalies.length,   items: anomalies  },
        low_stock:    { count: lowStock.length,     items: lowStock   },
        sms_failed:   { count: smsFailed.length,    items: smsFailed  },
      },

      // Clients à contacter pour retard / compensation
      // → Détails complets disponibles via GET /api/dashboard/retards
      clients_retards: {
        count: clientsRetards.length,
        // Résumé par niveau d'urgence
        par_niveau: compensationSummary,
        // Cas critiques uniquement dans la vue OPS (remboursement possible)
        urgents: clientsRetards.filter(c =>
          c.compensation_recommandee === 'remboursement_possible' ||
          c.compensation_recommandee === 'remise_10pct_prochaine_cmd'
        ).map(c => ({
          reference:   c.reference,
          client:      c.client_nom,
          email:       c.client_email,
          phone:       c.client_phone,
          jours_retard: c.jours_de_retard,
          compensation: c.compensation_recommandee,
        })),
      },
    });

  } catch (err) {
    console.error('[DASHBOARD OPS]', err);
    res.status(500).json({ error: 'Erreur dashboard opérationnel' });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/retards
// ══════════════════════════════════════════════════════════════════════════════
//
// Liste complète des clients dont la commande est en retard ou à risque.
// Données de contact incluses pour faciliter la prise en charge.
//
// Niveaux :
//   contact_préventif          → informer avant que le SLA soit dépassé
//   avoir_5pct                 → bon d'achat 5% sur prochaine commande
//   remise_10pct_prochaine_cmd → remise 10% sur prochaine commande
//   remboursement_possible     → retard grave, remboursement à envisager
//
// Query params :
//   ?niveau=remboursement_possible  → filtrer par niveau de compensation
//   ?status=shipped                 → filtrer par statut de commande

router.get('/retards', ...adminOnly, async (req, res) => {
  try {
    const { niveau, status: filterStatus } = req.query;

    // ── Requête principale ───────────────────────────────────────────────────
    // Même logique que dans /ops mais avec toutes les informations de contact
    // et les détails nécessaires pour décider de l'action à entreprendre.

    const { rows } = await db.query(`
      SELECT
        -- Commande
        o.id              AS order_id,
        o.reference,
        o.status,
        o.total_kmf,
        o.payment_mode,
        o.created_at      AS commande_le,
        o.shipped_at,

        -- Timing
        ROUND(EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400, 1)
                          AS jours_depuis_paiement,
        CASE WHEN o.shipped_at IS NOT NULL AND o.status = 'shipped'
          THEN ROUND(EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400, 1)
        END               AS jours_en_mer,

        -- Expédition
        s.reference       AS shipment_ref,
        s.eta             AS eta_arrivee,
        s.carrier         AS transporteur,
        s.container_ref   AS container,
        CASE WHEN s.eta IS NOT NULL
          THEN ROUND(EXTRACT(EPOCH FROM (s.eta - NOW()))/86400, 0)
        END               AS jours_avant_eta,

        -- Client expéditeur (diaspora)
        u.full_name       AS client_nom,
        u.email           AS client_email,
        u.phone           AS client_phone,
        u.country         AS client_pays,

        -- Destinataire aux Comores
        rc.full_name      AS destinataire_nom,
        rc.phone          AS destinataire_phone,

        -- Relais
        r.name            AS relais_nom,
        r.agent_name      AS relais_agent,
        r.phone           AS relais_phone,
        r.zone            AS relais_zone,

        -- Dernier scan enregistré
        (SELECT step       FROM scans WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1)
                          AS dernier_scan_step,
        (SELECT location   FROM scans WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1)
                          AS dernier_scan_lieu,
        (SELECT created_at FROM scans WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1)
                          AS dernier_scan_le,

        -- Type de retard
        CASE
          WHEN o.status IN ('paid','preparation')
            AND EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400 > 5
            THEN 'risque_délai'
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 35
            THEN 'retard_avéré'
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 28
            THEN 'retard_probable'
          WHEN s.eta IS NOT NULL AND s.eta < NOW() - INTERVAL '3 days'
            AND o.status = 'shipped'
            THEN 'eta_dépassée'
          ELSE NULL
        END               AS type_retard,

        -- Jours de retard réels (vs SLA promis)
        CASE
          WHEN o.status IN ('paid','preparation')
            THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400, 0) - 5)
          WHEN o.status = 'shipped'
            THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400, 0) - 35)
          ELSE 0
        END               AS jours_de_retard,

        -- Compensation recommandée
        CASE
          WHEN o.status IN ('paid','preparation')
            AND EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400 > 5
            THEN 'contact_préventif'
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 BETWEEN 35 AND 42
            THEN 'avoir_5pct'
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 BETWEEN 42 AND 49
            THEN 'remise_10pct_prochaine_cmd'
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 49
            THEN 'remboursement_possible'
          WHEN s.eta IS NOT NULL AND s.eta < NOW() - INTERVAL '3 days'
            THEN 'avoir_5pct'
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 28
            THEN 'contact_préventif'
          ELSE NULL
        END               AS compensation_recommandee,

        -- Message SMS/email suggéré (template)
        CASE
          WHEN o.status IN ('paid','preparation')
            AND EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400 > 5
            THEN 'Bonjour ' || u.full_name || ', votre commande ' || o.reference || ' est en cours de préparation. Expédition prévue sous 48h. Merci pour votre patience.'
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 49
            THEN 'Bonjour ' || u.full_name || ', votre commande ' || o.reference || ' accuse un retard important. Nous vous présentons nos excuses et restons disponibles pour tout remboursement ou solution alternative.'
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 42
            THEN 'Bonjour ' || u.full_name || ', votre commande ' || o.reference || ' est légèrement retardée. Un bon de réduction de 10% vous sera offert sur votre prochaine commande.'
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 35
            THEN 'Bonjour ' || u.full_name || ', votre commande ' || o.reference || ' subit un léger retard. Un avoir de 5% vous est accordé. Merci de votre compréhension.'
          ELSE 'Bonjour ' || u.full_name || ', votre commande ' || o.reference || ' est en transit. Livraison prévue dans les prochains jours.'
        END               AS sms_suggere

      FROM orders o
      LEFT JOIN users      u  ON u.id  = o.user_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      LEFT JOIN relais      r  ON r.id  = o.relais_id
      LEFT JOIN shipments   s  ON s.id  = o.shipment_id

      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('collected','cancelled','refunded','available')
        AND (
          (o.status IN ('paid','preparation')
            AND EXTRACT(EPOCH FROM (NOW() - o.updated_at))/86400 > 5)
          OR
          (o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 28)
          OR
          (s.eta IS NOT NULL AND s.eta < NOW() - INTERVAL '3 days' AND o.status = 'shipped')
        )

      ORDER BY
        CASE
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 49 THEN 1
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 42 THEN 2
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 35 THEN 3
          WHEN s.eta IS NOT NULL AND s.eta < NOW() - INTERVAL '3 days' THEN 4
          WHEN o.status = 'shipped'
            AND EXTRACT(EPOCH FROM (NOW() - o.shipped_at))/86400 > 28 THEN 5
          ELSE 6
        END ASC,
        jours_de_retard DESC NULLS LAST
    `);

    // ── Filtres optionnels ───────────────────────────────────────────────────
    let filtered = rows;
    if (niveau)        filtered = filtered.filter(r => r.compensation_recommandee === niveau);
    if (filterStatus)  filtered = filtered.filter(r => r.status === filterStatus);

    // ── Résumé par niveau ────────────────────────────────────────────────────
    const parNiveau = rows.reduce((acc, r) => {
      const k = r.compensation_recommandee || 'inconnu';
      if (!acc[k]) acc[k] = { count: 0, label: '' };
      acc[k].count++;
      acc[k].label = {
        contact_préventif:          'À prévenir — expédition en attente',
        avoir_5pct:                 'Avoir 5% — retard 1–7j',
        remise_10pct_prochaine_cmd: 'Remise 10% — retard 7–14j',
        remboursement_possible:     '🚨 Remboursement possible — retard >14j',
      }[k] || k;
      return acc;
    }, {});

    // ── Réponse ──────────────────────────────────────────────────────────────
    res.json({
      generated_at: new Date().toISOString(),
      total:        rows.length,
      filtre_actif: { niveau: niveau || null, status: filterStatus || null },
      par_niveau:   parNiveau,

      // Tableau complet avec contact + compensation + SMS suggéré
      clients: filtered,

      // Notice de politique (à adapter)
      politique_compensation: {
        contact_préventif:          'Informer proactivement, aucune compensation automatique',
        avoir_5pct:                 'Envoyer code promo 5% valable 90 jours',
        remise_10pct_prochaine_cmd: 'Envoyer code promo 10% valable 90 jours',
        remboursement_possible:     'Contacter le client pour accord amiable — remboursement total ou partiel selon situation',
      },
    });

  } catch (err) {
    console.error('[DASHBOARD RETARDS]', err);
    res.status(500).json({ error: 'Erreur dashboard retards' });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/sales?period=30
// ══════════════════════════════════════════════════════════════════════════════
//
// ?period=7  → 7 jours
// ?period=30 → 30 jours (défaut)
// ?period=90 → 3 mois

router.get('/sales', ...adminOnly, async (req, res) => {
  try {
    const period = parseInt(req.query.period) || 30;

    // ── KPI NIVEAU 1 : CA + MARGE RÉELLE ──────────────────────────────────
    //
    // Marge réelle par commande =
    //   Σ (price_kmf - cost_kmf) × quantité     (marge produit)
    //   − cost_transport_kmf                      (fret alloué)
    //   − cost_douane_kmf                         (douane allouée)
    //
    // ⚠️  Si cost_kmf non renseigné → marge_produit non calculable.
    //     L'API signale la part des commandes avec/sans cost renseigné.

    const { rows: [kpi1] } = await db.query(`
      SELECT
        COUNT(DISTINCT o.id)                                         AS nb_commandes,
        COALESCE(SUM(o.total_kmf), 0)                               AS ca_kmf,
        COALESCE(SUM(o.total_eur), 0)                               AS ca_eur,
        COALESCE(AVG(o.total_kmf), 0)                               AS panier_moyen_kmf,

        -- Marge produit (seulement les lignes avec cost_kmf renseigné)
        COALESCE(SUM(
          CASE WHEN p.cost_kmf IS NOT NULL
            THEN (oi.price_kmf - p.cost_kmf) * oi.quantity
          END
        ), 0)                                                        AS marge_produit_kmf,

        -- Marge réelle = marge produit − transport − douane
        COALESCE(SUM(
          CASE WHEN p.cost_kmf IS NOT NULL
            THEN (oi.price_kmf - p.cost_kmf) * oi.quantity
          END
        ), 0)
        - COALESCE(SUM(o.cost_transport_kmf), 0)
        - COALESCE(SUM(o.cost_douane_kmf), 0)                       AS marge_reelle_kmf,

        -- Coûts logistiques totaux
        COALESCE(SUM(o.cost_transport_kmf), 0)                      AS cout_transport_kmf,
        COALESCE(SUM(o.cost_douane_kmf), 0)                         AS cout_douane_kmf,

        -- Taux de marge moyen sur produits avec cost
        COALESCE(AVG(
          CASE WHEN p.cost_kmf IS NOT NULL AND p.cost_kmf > 0
            THEN ((oi.price_kmf - p.cost_kmf)::float / p.cost_kmf) * 100
          END
        ), 0)                                                        AS taux_marge_moy_pct,

        -- Nb commandes avec au moins un produit sans cost_kmf (alerte marge inconnue)
        COUNT(DISTINCT CASE WHEN p.cost_kmf IS NULL THEN o.id END)  AS nb_sans_cost_renseigne
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products   p  ON p.id = oi.product_id
      WHERE o.payment_status = 'paid'
        AND o.created_at >= NOW() - ($1 || ' days')::INTERVAL
    `, [period]);

    // Alerte : est-ce qu'on vend potentiellement à perte ?
    // Commandes où marge_produit < 0 (prix achat > prix vente, erreur de pricing)
    const { rows: atLoss } = await db.query(`
      SELECT o.reference, o.total_kmf,
             SUM((oi.price_kmf - p.cost_kmf) * oi.quantity) AS marge_produit_kmf
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products   p  ON p.id = oi.product_id
      WHERE o.payment_status = 'paid'
        AND o.created_at >= NOW() - ($1 || ' days')::INTERVAL
        AND p.cost_kmf IS NOT NULL
      GROUP BY o.id, o.reference, o.total_kmf
      HAVING SUM((oi.price_kmf - p.cost_kmf) * oi.quantity) < 0
    `, [period]);

    // ── COMPARAISON PÉRIODE PRÉCÉDENTE ─────────────────────────────────────
    const { rows: [prev] } = await db.query(`
      SELECT
        COUNT(DISTINCT o.id)             AS nb_commandes,
        COALESCE(SUM(o.total_kmf), 0)    AS ca_kmf,
        COALESCE(AVG(o.total_kmf), 0)    AS panier_moyen_kmf
      FROM orders o
      WHERE o.payment_status = 'paid'
        AND o.created_at >= NOW() - ($1 || ' days')::INTERVAL * 2
        AND o.created_at <  NOW() - ($1 || ' days')::INTERVAL
    `, [period]);

    const growthCA     = prev.ca_kmf > 0
      ? (((kpi1.ca_kmf - prev.ca_kmf) / prev.ca_kmf) * 100).toFixed(1)
      : null;
    const growthOrders = prev.nb_commandes > 0
      ? (((kpi1.nb_commandes - prev.nb_commandes) / prev.nb_commandes) * 100).toFixed(1)
      : null;

    // ── KPI NIVEAU 2A : DIASPORA VS LOCAL ──────────────────────────────────
    // users.country = 'KM' → client local · tout autre code → diaspora
    const { rows: byOrigin } = await db.query(`
      SELECT
        CASE WHEN u.country = 'KM' THEN 'local' ELSE 'diaspora' END AS origine,
        COUNT(DISTINCT o.id)                                          AS nb_commandes,
        COALESCE(SUM(o.total_kmf), 0)                                AS ca_kmf,
        COALESCE(AVG(o.total_kmf), 0)                                AS panier_moyen_kmf,
        -- Répartition pays pour la diaspora
        ARRAY_AGG(DISTINCT u.country) FILTER (WHERE u.country != 'KM') AS pays_diaspora
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.payment_status = 'paid'
        AND o.created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY CASE WHEN u.country = 'KM' THEN 'local' ELSE 'diaspora' END
    `, [period]);

    // ── KPI NIVEAU 2B : MARGE PAR CATÉGORIE ───────────────────────────────
    const { rows: byCategory } = await db.query(`
      SELECT
        p.category,
        COUNT(DISTINCT o.id)                                         AS nb_commandes,
        SUM(oi.quantity)                                             AS qty_vendue,
        SUM(oi.quantity * oi.price_kmf)                             AS ca_kmf,
        -- Marge produit (si cost_kmf renseigné)
        COALESCE(SUM(
          CASE WHEN p.cost_kmf IS NOT NULL
            THEN (oi.price_kmf - p.cost_kmf) * oi.quantity
          END
        ), 0)                                                        AS marge_produit_kmf,
        ROUND(COALESCE(AVG(
          CASE WHEN p.cost_kmf IS NOT NULL AND p.cost_kmf > 0
            THEN ((oi.price_kmf - p.cost_kmf)::numeric / p.cost_kmf) * 100
          END
        ), 0), 1)                                                    AS taux_marge_pct
      FROM order_items oi
      JOIN products p ON p.id  = oi.product_id
      JOIN orders   o ON o.id  = oi.order_id
      WHERE o.payment_status = 'paid'
        AND o.created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY p.category
      ORDER BY ca_kmf DESC
    `, [period]);

    // ── KPI NIVEAU 2C : % CASH VS STRIPE ──────────────────────────────────
    const { rows: paymentModes } = await db.query(`
      SELECT
        payment_mode,
        COUNT(*)               AS nb,
        SUM(total_kmf)         AS ca_kmf,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct
      FROM orders
      WHERE payment_status = 'paid'
        AND created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY payment_mode
    `, [period]);

    // ── TOP 10 PRODUITS ───────────────────────────────────────────────────
    const { rows: topProducts } = await db.query(`
      SELECT
        p.name, p.category, p.emoji,
        SUM(oi.quantity)                                   AS qty_vendue,
        SUM(oi.quantity * oi.price_kmf)                   AS ca_kmf,
        CASE WHEN p.cost_kmf IS NOT NULL
          THEN SUM((oi.price_kmf - p.cost_kmf) * oi.quantity)
        END                                                AS marge_kmf,
        CASE WHEN p.cost_kmf IS NOT NULL AND p.cost_kmf > 0
          THEN ROUND(((p.price_kmf - p.cost_kmf)::numeric / p.cost_kmf) * 100, 1)
        END                                                AS taux_marge_pct
      FROM order_items oi
      JOIN products p ON p.id  = oi.product_id
      JOIN orders   o ON o.id  = oi.order_id
      WHERE o.payment_status = 'paid'
        AND o.created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY p.id, p.name, p.category, p.emoji, p.price_kmf, p.cost_kmf
      ORDER BY ca_kmf DESC
      LIMIT 10
    `, [period]);

    // ── PRODUITS JAMAIS VENDUS ────────────────────────────────────────────
    const { rows: neverSold } = await db.query(`
      SELECT p.sku, p.name, p.category, p.emoji, p.price_kmf, p.stock,
             p.created_at
      FROM products p
      WHERE p.is_active = TRUE
        AND p.id NOT IN (
          SELECT DISTINCT oi.product_id
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.payment_status = 'paid'
        )
      ORDER BY p.created_at ASC
    `);

    // ── CLIENTS ───────────────────────────────────────────────────────────
    const { rows: [clientStats] } = await db.query(`
      SELECT
        COUNT(DISTINCT u.id) FILTER (
          WHERE u.created_at >= NOW() - ($1 || ' days')::INTERVAL
        )                            AS nouveaux_cette_periode,
        COUNT(DISTINCT u.id)         AS total_clients
      FROM users u
      WHERE u.role = 'client'
    `, [period]);

    // Taux de réachat : clients avec >1 commande payée (KPI L3)
    const { rows: [retention] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE nb_cmd > 1) AS recurrents,
        COUNT(*)                           AS total_avec_commande,
        ROUND(
          COUNT(*) FILTER (WHERE nb_cmd > 1)::numeric
          / NULLIF(COUNT(*), 0) * 100, 1
        )                                  AS taux_reachat_pct
      FROM (
        SELECT user_id, COUNT(*) AS nb_cmd
        FROM orders
        WHERE payment_status = 'paid' AND user_id IS NOT NULL
        GROUP BY user_id
      ) t
    `);

    // LTV moyen (Lifetime Value) — valeur moyenne d'un client sur toute sa vie (KPI L3)
    const { rows: [ltv] } = await db.query(`
      SELECT ROUND(AVG(total_ca), 0) AS ltv_moyen_kmf
      FROM (
        SELECT user_id, SUM(total_kmf) AS total_ca
        FROM orders
        WHERE payment_status = 'paid' AND user_id IS NOT NULL
        GROUP BY user_id
      ) t
    `);

    // Top 5 clients par CA
    const { rows: topClients } = await db.query(`
      SELECT
        u.full_name, u.email, u.country,
        COUNT(o.id)       AS nb_commandes,
        SUM(o.total_kmf)  AS ca_kmf,
        MAX(o.created_at) AS derniere_commande
      FROM orders o
      JOIN users u ON u.id = o.user_id
      WHERE o.payment_status = 'paid'
        AND o.created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY u.id, u.full_name, u.email, u.country
      ORDER BY ca_kmf DESC
      LIMIT 5
    `, [period]);

    // ── TENDANCES ─────────────────────────────────────────────────────────
    const { rows: trendHebdo } = await db.query(`
      SELECT
        DATE_TRUNC('week', created_at) AS semaine,
        COUNT(*)                       AS nb_commandes,
        SUM(total_kmf)                 AS ca_kmf
      FROM orders
      WHERE payment_status = 'paid'
        AND created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY semaine ASC
    `, [period]);

    const { rows: trendJour } = await db.query(`
      SELECT
        DATE(created_at) AS jour,
        COUNT(*)         AS nb_commandes,
        SUM(total_kmf)   AS ca_kmf
      FROM orders
      WHERE payment_status = 'paid'
        AND created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY DATE(created_at)
      ORDER BY jour ASC
    `, [period]);

    // ── TAUX DE CONVERSION ────────────────────────────────────────────────
    const { rows: [conv] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE payment_status = 'paid') AS payees,
        COUNT(*) FILTER (WHERE status != 'draft')       AS total_hors_draft
      FROM orders
      WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
    `, [period]);

    const tauxConversion = conv.total_hors_draft > 0
      ? ((conv.payees / conv.total_hors_draft) * 100).toFixed(1)
      : 0;

    // ── ANNULATIONS ───────────────────────────────────────────────────────
    const { rows: [cancelled] } = await db.query(`
      SELECT COUNT(*) AS count FROM orders
      WHERE status = 'cancelled'
        AND created_at >= NOW() - ($1 || ' days')::INTERVAL
    `, [period]);

    // ── RÉPONSE ───────────────────────────────────────────────────────────
    res.json({
      periode_jours: period,
      generated_at:  new Date().toISOString(),

      // ════════════════════════════════
      // KPI NIVEAU 1 — OBLIGATOIRES
      // ════════════════════════════════
      kpi_l1: {
        ca_kmf:          parseInt(kpi1.ca_kmf),
        ca_eur:          parseFloat(kpi1.ca_eur).toFixed(2),
        nb_commandes:    parseInt(kpi1.nb_commandes),
        panier_moyen_kmf: parseInt(kpi1.panier_moyen_kmf),
        // MARGE
        marge: {
          marge_produit_kmf: parseInt(kpi1.marge_produit_kmf),
          cout_transport_kmf: parseInt(kpi1.cout_transport_kmf),
          cout_douane_kmf:    parseInt(kpi1.cout_douane_kmf),
          marge_reelle_kmf:  parseInt(kpi1.marge_reelle_kmf),
          taux_marge_moy:    parseFloat(kpi1.taux_marge_moy_pct).toFixed(1) + '%',
          // Alerte : commandes potentiellement à perte
          alerte_vente_a_perte: atLoss.length > 0
            ? { count: atLoss.length, commandes: atLoss }
            : null,
          // Alerte : cost_kmf non renseigné = marge inconnue
          nb_sans_cost_renseigne: parseInt(kpi1.nb_sans_cost_renseigne),
        },
        // Évolution vs période précédente
        evolution: {
          ca_pct:         growthCA     ? `${growthCA}%`     : 'N/A',
          commandes_pct:  growthOrders ? `${growthOrders}%` : 'N/A',
        },
        // Conversion
        taux_conversion:   `${tauxConversion}%`,
        commandes_annulees: parseInt(cancelled.count),
      },

      // ════════════════════════════════
      // KPI NIVEAU 2 — IMPORTANTS
      // ════════════════════════════════
      kpi_l2: {
        // Diaspora vs local
        diaspora_vs_local: byOrigin,

        // Marge par catégorie (savoir où on gagne vraiment)
        marge_par_categorie: byCategory,

        // Répartition paiements
        modes_paiement: paymentModes,
      },

      // ════════════════════════════════
      // PRODUITS
      // ════════════════════════════════
      produits: {
        top_10:       topProducts,
        jamais_vendus: { count: neverSold.length, items: neverSold },
      },

      // ════════════════════════════════
      // CLIENTS
      // ════════════════════════════════
      clients: {
        nouveaux_cette_periode: parseInt(clientStats.nouveaux_cette_periode),
        total_clients:          parseInt(clientStats.total_clients),
        top_5_par_ca:           topClients,
        // KPI L3
        ltv_moyen_kmf:          parseInt(ltv.ltv_moyen_kmf || 0),
        taux_reachat:           `${retention.taux_reachat_pct || 0}%`,
        clients_recurrents:     parseInt(retention.recurrents || 0),
      },

      // ════════════════════════════════
      // KPI NIVEAU 3 — AVANCÉS
      // ════════════════════════════════
      kpi_l3: {
        ltv_moyen_kmf:      parseInt(ltv.ltv_moyen_kmf || 0),
        taux_reachat_pct:   `${retention.taux_reachat_pct || 0}%`,
        recurrents:         parseInt(retention.recurrents || 0),
        // Produits récurrents (achetés par plusieurs clients différents)
        // → voir top_produits qui a qty_vendue + nb commandes
      },

      // ════════════════════════════════
      // TENDANCES
      // ════════════════════════════════
      tendances: {
        hebdomadaire: trendHebdo,
        journaliere:  trendJour,
      },
    });

  } catch (err) {
    console.error('[DASHBOARD SALES]', err);
    res.status(500).json({ error: 'Erreur dashboard ventes' });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/forecast
// ══════════════════════════════════════════════════════════════════════════════
//
// Projection du CA et de la marge bénéficiaire vers une date cible.
//
// Méthode :
//   1. On observe les N derniers jours (ref_period, défaut 30) pour calculer :
//      - moyenne journalière de CA
//      - moyenne journalière de marge réelle
//      - écart-type journalier (volatilité)
//   2. On projette jusqu'à target_date avec 3 scénarios :
//      - Pessimiste  : moyenne − 1 écart-type
//      - Attendu     : moyenne (tendance actuelle)
//      - Optimiste   : moyenne + 1 écart-type
//   3. On retourne aussi une courbe jour par jour (pour afficher un graphe)
//
// Query params :
//   ?target_date=2026-05-31   (obligatoire — format YYYY-MM-DD)
//   ?ref_period=30            (jours d'historique pour la moyenne, défaut 30)
//   ?from_date=2026-04-01     (optionnel — point de départ du cumul, défaut : début du mois en cours)

router.get('/forecast', ...adminOnly, async (req, res) => {
  try {

    // ── Paramètres ─────────────────────────────────────────────────────────
    const { target_date, ref_period = '30', from_date } = req.query;

    if (!target_date || !/^\d{4}-\d{2}-\d{2}$/.test(target_date)) {
      return res.status(400).json({
        error: 'Paramètre target_date requis (format YYYY-MM-DD). Ex: ?target_date=2026-05-31'
      });
    }

    const targetDate = new Date(target_date);
    const today      = new Date();
    today.setHours(0, 0, 0, 0);

    if (targetDate <= today) {
      return res.status(400).json({
        error: 'target_date doit être dans le futur.'
      });
    }

    const refDays       = Math.max(7, Math.min(365, parseInt(ref_period)));
    const daysRemaining = Math.round((targetDate - today) / 86400000);

    // Point de départ du cumul (from_date ou début du mois en cours)
    const fromDate = from_date && /^\d{4}-\d{2}-\d{2}$/.test(from_date)
      ? from_date
      : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

    const daysElapsed = Math.max(1, Math.round(
      (today - new Date(fromDate)) / 86400000
    ));

    // ── 1. CA ET MARGE CUMULÉS DEPUIS from_date ───────────────────────────
    const { rows: [cumul] } = await db.query(`
      SELECT
        COALESCE(SUM(o.total_kmf), 0)   AS ca_kmf,
        COUNT(DISTINCT o.id)            AS nb_commandes,
        -- Marge réelle cumulée
        COALESCE(SUM(
          CASE WHEN p.cost_kmf IS NOT NULL
            THEN (oi.price_kmf - p.cost_kmf) * oi.quantity
          END
        ), 0)
        - COALESCE(SUM(o.cost_transport_kmf), 0)
        - COALESCE(SUM(o.cost_douane_kmf), 0)   AS marge_reelle_kmf
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products   p  ON p.id = oi.product_id
      WHERE o.payment_status = 'paid'
        AND o.created_at >= $1::date
        AND o.created_at <  NOW()
    `, [fromDate]);

    // ── 2. MOYENNE + ÉCART-TYPE JOURNALIER (sur ref_period jours) ─────────
    // On calcule le CA et la marge de chaque jour sur la période de référence,
    // puis on en tire la moyenne et l'écart-type (mesure de volatilité).
    const { rows: dailyStats } = await db.query(`
      SELECT
        DATE(o.created_at)              AS jour,
        SUM(o.total_kmf)               AS ca_kmf,
        COALESCE(SUM(
          CASE WHEN p.cost_kmf IS NOT NULL
            THEN (oi.price_kmf - p.cost_kmf) * oi.quantity
          END
        ), 0)
        - COALESCE(SUM(o.cost_transport_kmf), 0)
        - COALESCE(SUM(o.cost_douane_kmf), 0)   AS marge_reelle_kmf
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products   p  ON p.id = oi.product_id
      WHERE o.payment_status = 'paid'
        AND o.created_at >= NOW() - ($1 || ' days')::INTERVAL
        AND o.created_at <  NOW()
      GROUP BY DATE(o.created_at)
      ORDER BY jour ASC
    `, [refDays]);

    // Jours avec 0 commande = 0 CA — on les inclut pour ne pas surestimer
    // En complétant les jours manquants avec 0
    const caValues     = dailyStats.map(d => parseFloat(d.ca_kmf || 0));
    const margeValues  = dailyStats.map(d => parseFloat(d.marge_reelle_kmf || 0));

    // Remplir les jours sans commande avec 0 (sur refDays)
    const totalDaysRef = refDays;
    const daysWithOrders = caValues.length;
    const daysWithZero   = totalDaysRef - daysWithOrders;

    // Ajouter les jours à 0
    for (let i = 0; i < daysWithZero; i++) {
      caValues.push(0);
      margeValues.push(0);
    }

    const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const stddev = arr => {
      const m = mean(arr);
      const variance = arr.reduce((acc, v) => acc + Math.pow(v - m, 2), 0) / arr.length;
      return Math.sqrt(variance);
    };

    const avgCAJour     = mean(caValues);
    const stdCAJour     = stddev(caValues);
    const avgMargeJour  = mean(margeValues);
    const stdMargeJour  = stddev(margeValues);

    // ── 3. PROJECTION ─────────────────────────────────────────────────────
    // Projection additionnelle (jours restants × scénario)
    const projCA = {
      pessimiste: Math.max(0, (avgCAJour - stdCAJour)    * daysRemaining),
      attendu:    Math.max(0,  avgCAJour                  * daysRemaining),
      optimiste:  Math.max(0, (avgCAJour + stdCAJour)    * daysRemaining),
    };

    const projMarge = {
      pessimiste: (avgMargeJour - stdMargeJour) * daysRemaining,
      attendu:     avgMargeJour                 * daysRemaining,
      optimiste:  (avgMargeJour + stdMargeJour) * daysRemaining,
    };

    // CA total projeté = cumul déjà réalisé + projection
    const caCumul    = parseFloat(cumul.ca_kmf);
    const margeCumul = parseFloat(cumul.marge_reelle_kmf);

    const totalProjetCA = {
      pessimiste: Math.round(caCumul + projCA.pessimiste),
      attendu:    Math.round(caCumul + projCA.attendu),
      optimiste:  Math.round(caCumul + projCA.optimiste),
    };

    const totalProjetMarge = {
      pessimiste: Math.round(margeCumul + projMarge.pessimiste),
      attendu:    Math.round(margeCumul + projMarge.attendu),
      optimiste:  Math.round(margeCumul + projMarge.optimiste),
    };

    // Taux de marge projeté (sur scénario attendu)
    const tauxMargeProjetePct = totalProjetCA.attendu > 0
      ? ((totalProjetMarge.attendu / totalProjetCA.attendu) * 100).toFixed(1)
      : 0;

    // ── 4. COURBE DE PROJECTION JOUR PAR JOUR ─────────────────────────────
    // Utile pour afficher un graphe. On génère un point par jour jusqu'à target_date.
    const courbe = [];

    // Jours déjà écoulés depuis from_date (CA réel jour par jour)
    const { rows: realDays } = await db.query(`
      SELECT
        DATE(created_at) AS jour,
        SUM(total_kmf)   AS ca_kmf
      FROM orders
      WHERE payment_status = 'paid'
        AND created_at >= $1::date
        AND created_at <  NOW()
      GROUP BY DATE(created_at)
      ORDER BY jour ASC
    `, [fromDate]);

    // Cumul réel
    let runningCA = 0;
    const realByDay = {};
    for (const d of realDays) {
      realByDay[d.jour.toISOString().split('T')[0]] = parseFloat(d.ca_kmf);
    }

    const startDate = new Date(fromDate);
    const endDate   = new Date(target_date);
    let cursor      = new Date(startDate);

    while (cursor <= endDate) {
      const dayStr = cursor.toISOString().split('T')[0];
      const isPast = cursor < today;
      const isToday = cursor.toDateString() === today.toDateString();

      if (isPast || isToday) {
        // Données réelles
        runningCA += realByDay[dayStr] || 0;
        courbe.push({
          date:    dayStr,
          ca_kmf:  Math.round(runningCA),
          type:    'reel',
        });
      } else {
        // Projection
        runningCA += avgCAJour;  // tendance attendue
        courbe.push({
          date:       dayStr,
          ca_pessimiste: Math.round(caCumul + projCA.pessimiste * ((cursor - today) / 86400000 / daysRemaining)),
          ca_attendu:    Math.round(runningCA),
          ca_optimiste:  Math.round(caCumul + projCA.optimiste  * ((cursor - today) / 86400000 / daysRemaining)),
          type:          'projection',
        });
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    // ── RÉPONSE ───────────────────────────────────────────────────────────
    res.json({
      generated_at:   new Date().toISOString(),
      target_date,
      from_date:      fromDate,
      days_elapsed:   daysElapsed,
      days_remaining: daysRemaining,

      // Ce qui est déjà réalisé
      realise: {
        ca_kmf:          Math.round(caCumul),
        marge_reelle_kmf: Math.round(margeCumul),
        nb_commandes:    parseInt(cumul.nb_commandes),
        taux_marge_pct:  caCumul > 0
          ? ((margeCumul / caCumul) * 100).toFixed(1) + '%'
          : '0%',
      },

      // Paramètres du modèle (transparence)
      modele: {
        ref_period_jours:   refDays,
        jours_avec_ventes:  daysWithOrders,
        jours_sans_ventes:  daysWithZero,
        avg_ca_par_jour:    Math.round(avgCAJour),
        stddev_ca:          Math.round(stdCAJour),
        avg_marge_par_jour: Math.round(avgMargeJour),
        note: stdCAJour > avgCAJour * 0.5
          ? '⚠️ Forte variabilité journalière — les projections ont une large marge d\'erreur'
          : '✅ Variabilité raisonnable — projections fiables à ±' + Math.round((stdCAJour / avgCAJour) * 100) + '%',
      },

      // Projection CA total à target_date
      projection_ca: {
        pessimiste: totalProjetCA.pessimiste,
        attendu:    totalProjetCA.attendu,
        optimiste:  totalProjetCA.optimiste,
        additif_jours_restants: {
          pessimiste: Math.round(projCA.pessimiste),
          attendu:    Math.round(projCA.attendu),
          optimiste:  Math.round(projCA.optimiste),
        }
      },

      // Projection marge réelle à target_date
      projection_marge: {
        pessimiste:       totalProjetMarge.pessimiste,
        attendu:          totalProjetMarge.attendu,
        optimiste:        totalProjetMarge.optimiste,
        taux_marge_proj:  tauxMargeProjetePct + '%',
        alerte_perte:     totalProjetMarge.pessimiste < 0
          ? '🚨 Scénario pessimiste : risque de marge négative — vérifier les coûts'
          : null,
      },

      // Courbe jour par jour (pour graphe front-end)
      // type: 'reel' = données passées · 'projection' = estimé
      courbe,
    });

  } catch (err) {
    console.error('[DASHBOARD FORECAST]', err);
    res.status(500).json({ error: 'Erreur dashboard prévisions' });
  }
});

module.exports = router;
