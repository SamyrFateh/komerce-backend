/**
 * KOMERCE — scans.js — DIFF v8.4
 *
 * Route à insérer dans scans.js
 * AVANT la route générique GET /:order_id (dernière route du fichier)
 *
 * Routes ajoutées :
 *   POST /api/scans/verify-qr  → vérifie le QR scanné par l'agent, invalide le token, marque collected
 *
 * ⚠️  Cette route DOIT être insérée AVANT router.get('/:order_id', ...)
 *     sinon Express capturerait 'verify-qr' comme valeur de :order_id.
 *
 * Prérequis migration SQL : voir migration_v84.sql
 * Variable d'env requise : QR_SECRET (même valeur que dans orders.js)
 */

'use strict';

const crypto = require('crypto'); // déjà dans orders.js, à ajouter si absent de scans.js

// ── POST /api/scans/verify-qr ─────────────────────────────────────────────────
// Vérifie un QR code scanné par l'agent relais à la remise du colis.
// Le token est invalidé après usage (usage unique).
// Body : { token, order_id }
// Rôles : admin, agent_relais
//
// INSÉRER AVANT router.get('/:order_id', ...)
router.post('/verify-qr', authenticate, requireRole(['admin', 'agent_relais']), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { token, order_id } = req.body;

    if (!token || !order_id) {
      return res.status(400).json({ error: 'token et order_id sont requis' });
    }

    // Chercher la commande avec ce token
    const { rows: [order] } = await client.query(
      `SELECT o.*,
              rc.full_name  AS recipient_name,
              rc.phone      AS recipient_phone,
              r.name        AS relais_name,
              u.phone       AS user_phone
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       LEFT JOIN users      u  ON u.id  = o.user_id
       WHERE o.id = $1`,
      [order_id]
    );

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // Vérifications
    if (order.status !== 'available') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: order.status === 'collected'
          ? 'Ce colis a déjà été remis au client'
          : `Statut incompatible : ${order.status}`,
        current_status: order.status,
      });
    }

    if (!order.qr_token) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucun QR code généré pour cette commande' });
    }

    if (order.qr_token !== token) {
      await client.query('ROLLBACK');
      console.warn(`[VERIFY-QR] Token invalide pour ${order.reference} — fourni: ${token.slice(0, 8)}... attendu: ${order.qr_token.slice(0, 8)}...`);
      return res.status(400).json({ error: 'QR code invalide' });
    }

    if (order.qr_expires_at && new Date(order.qr_expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'QR code expiré — veuillez en générer un nouveau',
        expired_at: order.qr_expires_at,
      });
    }

    // ✅ Token valide — marquer comme collecté et invalider le token
    await client.query(
      `UPDATE orders
       SET status       = 'collected',
           collected_at = NOW(),
           qr_token     = NULL,       -- usage unique : invalider immédiatement
           qr_expires_at = NULL,
           updated_at   = NOW()
       WHERE id = $1`,
      [order.id]
    );

    // Historiser le changement de statut
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'collected', 'Remise client via QR Code', $2)`,
      [order.id, req.user.id]
    );

    // Enregistrer le scan
    await client.query(
      `INSERT INTO scans
         (order_id, step, scanned_by, location, scan_code, notes)
       VALUES ($1, 'collected', $2, $3, $4, 'Retrait client via QR Code — token validé')`,
      [
        order.id,
        req.user.id,
        order.relais_name || '',
        `QR-${token.slice(0, 8)}`,
      ]
    );

    await client.query('COMMIT');

    console.log(`[VERIFY-QR] ✅ ${order.reference} remis à ${order.recipient_name} via QR`);

    // SMS confirmation au commanditaire (non bloquant)
    if (order.user_phone) {
      sendSMS(
        order.user_phone,
        `Komerce · Votre colis ${order.reference} a bien été récupéré par ${order.recipient_name || 'le destinataire'}. Merci pour votre confiance ! 🎉`,
        'collected',
        order.id
      ).catch(err => console.error('SMS QR collect error:', err.message));
    }

    // Recalculer fidélité (non bloquant)
    if (order.user_id) {
      const { recalculateLoyalty } = require('./loyalty');
      recalculateLoyalty(db, order.user_id)
        .catch(e => console.error('[LOYALTY] recalculate error:', e.message));
    }

    res.json({
      success:      true,
      message:      'Remise enregistrée avec succès',
      reference:    order.reference,
      recipient:    order.recipient_name,
      relais:       order.relais_name,
      collected_at: new Date().toISOString(),
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[VERIFY-QR] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur validation QR code' });
  } finally {
    client.release();
  }
});
