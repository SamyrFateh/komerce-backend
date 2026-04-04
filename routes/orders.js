/**
 * KOMERCE — orders.js — DIFF v8.4
 *
 * Nouvelles routes à insérer dans orders.js
 * AVANT la route générique GET /:ref (ligne ~502)
 *
 * Routes ajoutées :
 *   GET  /api/orders/relais          → colis en attente pour l'agent relais connecté
 *   GET  /api/orders/problems        → commandes problématiques du relais courant
 *   POST /api/orders/:id/qr-token    → génère un token QR unique (48h) pour une commande
 *
 * ⚠️  Ces routes DOIVENT être insérées AVANT router.get('/:ref', ...) dans orders.js
 *     sinon Express capturerait 'relais' et 'problems' comme valeur de :ref.
 *
 * Prérequis migration SQL : voir migration_v84.sql
 * Variable d'env requise : QR_SECRET (chaîne aléatoire secrète, ex: 64 caractères)
 */

'use strict';

// À ajouter en tête de orders.js si pas déjà présent
const crypto = require('crypto');

// ─── GET /api/orders/relais ───────────────────────────────────────────────────
// Liste les commandes disponibles (status = 'available') au relais de l'agent connecté.
// Inclut aussi les commandes en transit vers ce relais (statut shipped / transit_comores).
// Rôles : admin, agent_relais
//
// INSÉRER AVANT router.get('/:ref', ...)
router.get('/relais', authenticate, requireRole(['admin', 'agent_relais']), async (req, res) => {
  try {
    const relais_id = req.user.relais_id;
    if (!relais_id && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Aucun relais associé à cet agent' });
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
         AND o.status IN ('shipped', 'transit_comores', 'available')
         AND o.status NOT IN ('collected', 'cancelled', 'refunded')
       ORDER BY
         CASE o.status
           WHEN 'available'       THEN 1
           WHEN 'transit_comores' THEN 2
           WHEN 'shipped'         THEN 3
         END,
         o.available_at ASC NULLS LAST,
         o.created_at   ASC`,
      params
    );

    // Calculer alertes >48h (colis disponibles non retirés)
    const now = Date.now();
    const enriched = rows.map(o => ({
      ...o,
      alert_48h: o.status === 'available' && o.available_at
        ? (now - new Date(o.available_at).getTime()) > 48 * 60 * 60 * 1000
        : false,
      hours_waiting: o.available_at
        ? Math.floor((now - new Date(o.available_at).getTime()) / (60 * 60 * 1000))
        : null,
    }));

    const summary = {
      en_attente:  enriched.filter(o => o.status === 'available').length,
      en_transit:  enriched.filter(o => ['shipped', 'transit_comores'].includes(o.status)).length,
      alertes_48h: enriched.filter(o => o.alert_48h).length,
    };

    res.json({ summary, orders: enriched });
  } catch (err) {
    console.error('[orders/relais] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur récupération commandes relais' });
  }
});

// ─── GET /api/orders/problems ─────────────────────────────────────────────────
// Détecte les commandes problématiques du relais courant (ou tous si admin).
// 10 règles de détection alignées sur la spec v8.2.
// Rôles : admin, agent_relais, agent_hub
//
// INSÉRER AVANT router.get('/:ref', ...)
router.get('/problems', authenticate, requireRole(['admin', 'agent_relais', 'agent_hub']), async (req, res) => {
  try {
    const relais_id = req.user.relais_id;

    const relaisFilter = (relais_id && req.user.role !== 'admin')
      ? `AND o.relais_id = '${relais_id}'`  // sécurisé : UUID, pas d'injection possible
      : '';

    // 10 règles de détection — chaque règle retourne des commandes avec problem_type
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
           -- Règle 1 : paiement confirmé mais pas de BC (bon de commande)
           WHEN o.payment_status = 'paid'
            AND o.status IN ('confirmed', 'ordered')
            AND o.purchasing_at IS NULL
            THEN 'payment_no_bc'

           -- Règle 2 : double paiement suspect (vérifier en DB via stripe)
           -- (nécessite table payments — à implémenter si besoin)

           -- Règle 3 : préparation bloquée >4 jours
           WHEN o.status = 'preparation'
            AND o.preparation_at < NOW() - INTERVAL '4 days'
            THEN 'preparation_too_long'

           -- Règle 4 : transit >12 jours
           WHEN o.status IN ('shipped', 'transit_comores')
            AND o.shipped_at < NOW() - INTERVAL '12 days'
            THEN 'transit_too_long'

           -- Règle 5 : disponible depuis >7 jours (non retiré)
           WHEN o.status = 'available'
            AND o.available_at < NOW() - INTERVAL '7 days'
            THEN 'waiting_too_long'

           -- Règle 6 : disponible sans notification (qr_token NULL après 1h)
           WHEN o.status = 'available'
            AND o.available_at < NOW() - INTERVAL '1 hour'
            AND o.qr_token IS NULL
            THEN 'no_notification'

           -- Règle 7 : commande active depuis >30 jours sans avancement
           WHEN o.status IN ('ordered', 'purchasing')
            AND o.created_at < NOW() - INTERVAL '30 days'
            THEN 'stalled'

           -- Règle 8 : paiement cash non soldé après collecte (si possible à détecter)
           -- (nécessite table cash_settlements — Phase 2)

           -- Règle 9 : commande active sans relais assigné
           WHEN o.relais_id IS NULL
            AND o.status NOT IN ('draft', 'confirmed', 'cancelled', 'refunded')
            THEN 'no_relais'

           ELSE 'other'
         END AS problem_type,

         -- Ancienneté en heures pour triage
         EXTRACT(EPOCH FROM (NOW() - GREATEST(
           o.available_at, o.shipped_at, o.preparation_at, o.purchasing_at, o.created_at
         ))) / 3600 AS hours_since_last_event

       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       WHERE o.status NOT IN ('collected', 'cancelled', 'refunded', 'draft')
         ${relaisFilter}
         AND (
           -- Règle 1
           (o.payment_status = 'paid' AND o.status IN ('confirmed', 'ordered') AND o.purchasing_at IS NULL)
           -- Règle 3
           OR (o.status = 'preparation' AND o.preparation_at < NOW() - INTERVAL '4 days')
           -- Règle 4
           OR (o.status IN ('shipped', 'transit_comores') AND o.shipped_at < NOW() - INTERVAL '12 days')
           -- Règle 5
           OR (o.status = 'available' AND o.available_at < NOW() - INTERVAL '7 days')
           -- Règle 6
           OR (o.status = 'available' AND o.available_at < NOW() - INTERVAL '1 hour' AND o.qr_token IS NULL)
           -- Règle 7
           OR (o.status IN ('ordered', 'purchasing') AND o.created_at < NOW() - INTERVAL '30 days')
           -- Règle 9
           OR (o.relais_id IS NULL AND o.status NOT IN ('draft', 'confirmed', 'cancelled', 'refunded'))
         )
       ORDER BY o.id, hours_since_last_event DESC`,
      []
    );

    // Score santé global (0-100)
    // Formule : 100 - (nb_problèmes * 5), min 0
    const health_score = Math.max(0, 100 - rows.length * 5);

    // Regrouper par catégorie
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

  } catch (err) {
    console.error('[orders/problems] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur récupération problèmes' });
  }
});

// ─── POST /api/orders/:id/qr-token ───────────────────────────────────────────
// Génère un token QR unique pour une commande disponible.
// Le token est stocké en DB avec une expiration 48h.
// Rôles : admin, agent_relais
//
// INSÉRER AVANT router.get('/:ref', ...) — mais après router.get('/relais') et router.get('/problems')
router.post('/:id/qr-token', authenticate, requireRole(['admin', 'agent_relais']), async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que la commande est dans un état compatible (available)
    const { rows: [order] } = await db.query(
      `SELECT o.*, rc.full_name AS recipient_name, r.name AS relais_name
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE o.id = $1`,
      [id]
    );

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    if (order.status !== 'available') {
      return res.status(422).json({
        error: `Impossible de générer un QR — statut actuel : ${order.status} (attendu : available)`,
        current_status: order.status,
      });
    }

    // Générer le token : SHA256(orderId + relaisId + timestamp + QR_SECRET)
    const secret    = process.env.QR_SECRET || 'komerce-qr-default-secret-change-in-prod';
    const timestamp = Date.now().toString();
    const token     = crypto
      .createHash('sha256')
      .update(`${id}-${order.relais_id || 'NO_RELAIS'}-${timestamp}-${secret}`)
      .digest('hex')
      .slice(0, 24); // 24 caractères hex = suffisamment unique et lisible

    const expiration = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h

    // Sauvegarder en DB
    await db.query(
      `UPDATE orders
       SET qr_token = $1, qr_expires_at = $2, updated_at = NOW()
       WHERE id = $3`,
      [token, expiration, id]
    );

    console.log(`[QR-TOKEN] Généré pour ${order.reference} — token: ${token.slice(0, 8)}... expires: ${expiration.toISOString()}`);

    // Payload QR complet — sera encodé en JSON dans le QR code côté frontend
    const qr_payload = {
      orderId:     id,
      reference:   order.reference,
      clientName:  order.recipient_name || 'Client',
      relaisId:    order.relais_id,
      relaisName:  order.relais_name,
      token,
      expiration:  expiration.toISOString(),
    };

    res.json({
      success:    true,
      token,
      expiration: expiration.toISOString(),
      qr_payload, // le frontend encode ce JSON en QR
    });

  } catch (err) {
    console.error('[orders/qr-token] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur génération token QR' });
  }
});
