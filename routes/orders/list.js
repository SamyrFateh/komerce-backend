/**
 * KOMERCE â GET /api/orders (liste, relais, problems, credits)
 *
 * GET /              â liste des commandes du client connectÃ©
 * GET /relais        â commandes au relais de l'agent
 * GET /problems      â commandes problÃ©matiques
 * GET /credits       â crÃ©dits boutique disponibles
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const { getRule, getRuleNumber }    = require('../../utils/rules');

// âââ GET /api/orders â liste client ââââââââââââââââââââââââââââââââââââââââââ

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;

    const conditions = ['o.user_id = $1'];
    const params     = [req.user.id];
    let   pi         = 2;

    if (status) {
      conditions.push(`o.status = $${pi++}`);
      params.push(status);
    }

    const where = conditions.join(' AND ');

    // Jointure via order_items pour rÃ©cupÃ©rer le premier article
    const { rows } = await db.query(
      `SELECT
         o.id, o.reference, o.status, o.total_kmf,
         o.payment_mode, o.payment_status,
         o.confection_type, o.module_type,
         o.created_at,
         r.name AS relais_name,
         -- Premier article de la commande (pour affichage)
         (
           SELECT p.name FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = o.id
           ORDER BY oi.created_at ASC LIMIT 1
         ) AS product_name,
         (
           SELECT p.image_url FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = o.id
           ORDER BY oi.created_at ASC LIMIT 1
         ) AS product_image_url,
         (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS items_count
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE ${where}
       ORDER BY o.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, Number(limit), Number(offset)]
    );

    res.json(rows);
  } catch(err) { next(err); }
});

// âââ GET /api/orders/relais âââââââââââââââââââââââââââââââââââââââââââââââââââ
// Liste les commandes disponibles (status = 'available') au relais de l'agent connectÃ©.
// Inclut aussi les commandes en transit vers ce relais (statut shipped / transit_comores).
// Inclut les commandes cash en attente de paiement (status='confirmed', payment_mode='cash_relais').
// RÃ´les : admin, agent_relais

router.get('/relais', authenticate, requireRole(['admin', 'agent_relais']), async (req, res, next) => {
  try {
    const relais_id = req.user.relais_id;
    if (!relais_id && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Aucun relais associÃ© Ã  cet agent' });
    }

    const conditions = relais_id
      ? `o.relais_id = $1`
      : `1=1`; // admin voit tout

    const params = relais_id ? [relais_id] : [];

    const { rows } = await db.query(
      `SELECT
         o.id,
         o.reference,
         o.status,
         o.total_kmf,
         o.payment_mode,
         o.payment_status,
         o.pickup_code,
         o.qr_token,
         o.qr_expires_at,
         o.available_at,
         o.shipped_at,
         o.created_at,
         o.cash_ref_code,
         rc.full_name  AS recipient_name,
         rc.phone      AS recipient_phone,
         r.name        AS relais_name,
         -- Nombre d'articles
         (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS items_count,
         -- Premier article (pour affichage)
         (
           SELECT p.name FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = o.id
           ORDER BY oi.created_at ASC LIMIT 1
         ) AS product_name
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       WHERE ${conditions}
         AND (
           o.status IN ('shipped', 'available')
           OR (o.status = 'confirmed' AND o.payment_mode = 'cash_relais' AND o.payment_status = 'pending')
         )
         AND o.status NOT IN ('collected', 'cancelled', 'refunded')
       ORDER BY
         CASE o.status
           WHEN 'available' THEN 1
           WHEN 'shipped'   THEN 2
           WHEN 'confirmed' THEN 3
         END,
         o.available_at ASC NULLS LAST,
         o.created_at   ASC`,
      params
    );

    // Calculer alertes (colis disponibles non retirÃ©s â seuil configurable)
    const alertHours = await getRule('ORDER_ALERT_48H_AVAILABLE', 48);
    const now        = Date.now();
    const enriched   = rows.map(o => ({
      ...o,
      alert_48h: o.status === 'available' && o.available_at
        ? (now - new Date(o.available_at).getTime()) > alertHours * 60 * 60 * 1000
        : false,
      hours_waiting: o.available_at
        ? Math.floor((now - new Date(o.available_at).getTime()) / (60 * 60 * 1000))
        : null,
    }));

    const summary = {
      en_attente:   enriched.filter(o => o.status === 'available').length,
      en_transit:   enriched.filter(o => o.status === 'shipped').length,
      alertes_48h:  enriched.filter(o => o.alert_48h).length,
      cash_pending: enriched.filter(o => o.status === 'confirmed' && o.payment_mode === 'cash_relais').length,
    };

    res.json({ summary, orders: enriched });
  } catch(err) { next(err); }
});

// âââ GET /api/orders/problems âââââââââââââââââââââââââââââââââââââââââââââââââ
// DÃ©tecte les commandes problÃ©matiques du relais courant (ou tous si admin).
// 10 rÃ¨gles de dÃ©tection alignÃ©es sur la spec v8.2.
// RÃ´les : admin, agent_relais, agent_hub

router.get('/problems', authenticate, requireRole(['admin', 'agent_relais', 'agent_hub']), async (req, res, next) => {
  try {
    const relais_id = req.user.relais_id;

    // Build relais filter safely â parameterized to prevent SQL injection
    const params = [];
    let relaisFilter = '';
    if (relais_id && req.user.role !== 'admin') {
      params.push(relais_id);
      relaisFilter = `AND o.relais_id = $${params.length}`;
    }

    // Seuils problÃ¨mes â configurables via business_rules (safe cast via getRuleNumber)
    // ChargÃ©s en parallÃ¨le pour optimiser les performances (TÃ¢che 6)
    const [prepDays, transitDays, waitDays, noNotifHours, stalledDays] = await Promise.all([
      getRuleNumber('PROBLEM_PREP_BLOCKED_DAYS', 4),
      getRuleNumber('PROBLEM_TRANSIT_MAX_DAYS', 12),
      getRuleNumber('PROBLEM_WAITING_MAX_DAYS', 7),
      getRuleNumber('PROBLEM_NO_NOTIF_HOURS', 1),
      getRuleNumber('PROBLEM_STALLED_DAYS', 30),
    ]);

    // Add threshold params for parameterized query
    const prepDaysIdx     = params.length + 1;
    params.push(prepDays);
    const transitDaysIdx  = params.length + 1;
    params.push(transitDays);
    const waitDaysIdx     = params.length + 1;
    params.push(waitDays);
    const noNotifHoursIdx = params.length + 1;
    params.push(noNotifHours);
    const stalledDaysIdx  = params.length + 1;
    params.push(stalledDays);

    // 10 rÃ¨gles de dÃ©tection â chaque rÃ¨gle retourne des commandes avec problem_type
    const { rows } = await db.query(
      `SELECT DISTINCT ON (o.id)
         o.id,
         o.reference,
         o.status,
         o.total_kmf,
         o.payment_mode,
         o.payment_status,
         o.created_at,
         o.available_at,
         o.shipped_at,
         o.purchasing_at,
         o.preparation_at,
         rc.full_name AS recipient_name,
         rc.phone     AS recipient_phone,
         r.name       AS relais_name,
         CASE
           -- RÃ¨gle 1 : paiement confirmÃ© mais pas de BC (bon de commande)
           WHEN o.payment_status = 'paid'
            AND o.status IN ('confirmed', 'ordered')
            AND o.purchasing_at IS NULL
            THEN 'payment_no_bc'

           -- RÃ¨gle 2 : double paiement suspect (vÃ©rifier en DB via stripe)
           -- (nÃ©cessite table payments â Ã  implÃ©menter si besoin)

           -- RÃ¨gle 3 : prÃ©paration bloquÃ©e >4 jours
           WHEN o.status = 'preparation'
            AND o.preparation_at < NOW() - INTERVAL '1 day' * $${prepDaysIdx}
            THEN 'preparation_too_long'

           -- RÃ¨gle 4 : transit >12 jours
           WHEN o.status = 'shipped'
            AND o.shipped_at < NOW() - INTERVAL '1 day' * $${transitDaysIdx}
            THEN 'transit_too_long'

           -- RÃ¨gle 5 : disponible depuis >7 jours (non retirÃ©)
           WHEN o.status = 'available'
            AND o.available_at < NOW() - INTERVAL '1 day' * $${waitDaysIdx}
            THEN 'waiting_too_long'

           -- RÃ¨gle 6 : disponible sans notification (qr_token NULL aprÃ¨s 1h)
           WHEN o.status = 'available'
            AND o.available_at < NOW() - INTERVAL '1 hour' * $${noNotifHoursIdx}
            AND o.qr_token IS NULL
            THEN 'no_notification'

           -- RÃ¨gle 7 : commande active depuis >30 jours sans avancement
           WHEN o.status = 'ordered'
            AND o.created_at < NOW() - INTERVAL '1 day' * $${stalledDaysIdx}
            THEN 'stalled'

           -- RÃ¨gle 8 : paiement cash non soldÃ© aprÃ¨s collecte (si possible Ã  dÃ©tecter)
           -- (nÃ©cessite table cash_settlements â Phase 2)

           -- RÃ¨gle 9 : commande active sans relais assignÃ©
           WHEN o.relais_id IS NULL
            AND o.status NOT IN ('confirmed', 'cancelled', 'refunded')
            THEN 'no_relais'

           ELSE 'other'
         END AS problem_type,

         -- AnciennetÃ© en heures pour triage
         EXTRACT(EPOCH FROM (NOW() - GREATEST(
           o.available_at, o.shipped_at, o.preparation_at, o.purchasing_at, o.created_at
         ))) / 3600 AS hours_since_last_event

       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       WHERE o.status NOT IN ('collected', 'cancelled', 'refunded')
         ${relaisFilter}
         AND (
           -- RÃ¨gle 1
           (o.payment_status = 'paid' AND o.status IN ('confirmed', 'ordered') AND o.purchasing_at IS NULL)
           -- RÃ¨gle 3
           OR (o.status = 'preparation' AND o.preparation_at < NOW() - INTERVAL '1 day' * $${prepDaysIdx})
           -- RÃ¨gle 4
           OR (o.status = 'shipped' AND o.shipped_at < NOW() - INTERVAL '1 day' * $${transitDaysIdx})
           -- RÃ¨gle 5
           OR (o.status = 'available' AND o.available_at < NOW() - INTERVAL '1 day' * $${waitDaysIdx})
           -- RÃ¨gle 6
           OR (o.status = 'available' AND o.available_at < NOW() - INTERVAL '1 hour' * $${noNotifHoursIdx} AND o.qr_token IS NULL)
           -- RÃ¨gle 7
           OR (o.status = 'ordered' AND o.created_at < NOW() - INTERVAL '1 day' * $${stalledDaysIdx})
           -- RÃ¨gle 9
           OR (o.relais_id IS NULL AND o.status NOT IN ('confirmed', 'cancelled', 'refunded'))
         )
       ORDER BY o.id, hours_since_last_event DESC`,
      params
    );

    // Score santÃ© global (0-100)
    // Formule : 100 - (nb_problÃ¨mes * 5), min 0
    const health_score = Math.max(0, 100 - rows.length * 5);

    // Regrouper par catÃ©gorie
    const by_category = {
      finance:    rows.filter(r => ['payment_no_bc'].includes(r.problem_type)).length,
      logistique: rows.filter(r => ['transit_too_long', 'preparation_too_long', 'no_relais'].includes(r.problem_type)).length,
      client:     rows.filter(r => ['waiting_too_long', 'no_notification'].includes(r.problem_type)).length,
      donnees:    rows.filter(r => ['stalled', 'other'].includes(r.problem_type)).length,
    };

    res.json({
      health_score,
      total: rows.length,
      by_category,
      problems: rows,
    });

  } catch(err) { next(err); }
});

// âââ GET /api/orders/credits â crÃ©dits boutique disponibles ââââââââââââââââââ
// Retourne la somme des crÃ©dits boutique disponibles pour le client connectÃ©.
// RÃ´les : client (ses propres crÃ©dits) ou admin (tous les crÃ©dits d'un user)

router.get('/credits', authenticate, async (req, res, next) => {
  try {
    const userId = req.query.user_id && req.user.role === 'admin'
      ? req.query.user_id
      : req.user.id;

    const { rows } = await db.query(
      `SELECT
         id, amount_kmf, remaining_kmf, reason, source_order_id,
         expires_at, created_at
       FROM store_credits
       WHERE user_id = $1
         AND remaining_kmf > 0
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC`,
      [userId]
    );

    const total_kmf = rows.reduce((sum, c) => sum + Number(c.remaining_kmf), 0);

    res.json({
      total_kmf,
      credits: rows.map(c => ({
        id:              c.id,
        amount_kmf:      c.amount_kmf,
        remaining_kmf:   c.remaining_kmf,
        reason:          c.reason,
        source_order_id: c.source_order_id,
        expires_at:      c.expires_at,
        created_at:      c.created_at,
      })),
    });
  } catch(err) { next(err); }
});

module.exports = router;
