/**
 * @komerce-arch
 * @role          verify-qr-collection
 * @domain        orders
 * @layer         service
 * @criticality   medium
 * @inputs        token, orderId, user (agent_relais/admin)
 * @outputs       collected status, scan row, pickup_proof document
 * @depends       db.js, services/order-status-machine.js, services/notification-service.js, utils/parcelSync.js, services/documents/pickup-proof.js
 * @used-by       routes/orders/qr.js
 * @db-read       orders, recipients, relais, users
 * @db-write      orders, scans
 * @db-txn        resolve_before_behavior_change
 * @doctrine      pickup_collected_proof, resolve_before_behavior_change
 * @impact-areas  orders
 * @version       2026-06
 */

'use strict';

/**
 * I-SWEEP-2 — Vérification QR transactionnelle.
 *
 * Corrige le risque identifié dans routes/scans.js : verify-qr passait
 * l'order en collected puis lançait safeSyncScanToParcels après COMMIT.
 * Ici, order transition + invalidation QR + scan + parcel sync sont dans
 * la même transaction.
 */

const db = require('../db');
const { notifyText } = require('../services/notification-service'); // ZG-1: remplace sendSMS
const { safeSyncScanToParcels } = require('../utils/parcelSync');
const { transitionOrderStatus } = require('./order-status-machine');
const log = require('../utils/logger').child({ module: 'verify-qr-collection' });
const pickupProofService = require('./documents/pickup-proof');

async function verifyQrCollection({ token, orderId, user }) {
  if (!token) return { status: 400, body: { error: 'token est requis' } };
  if (!user?.id || !user?.role) throw new Error('[verifyQrCollection] user requis');

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    let queryText;
    let queryParams;

    if (orderId) {
      queryText = `SELECT o.*,
              rc.full_name  AS recipient_name,
              rc.phone      AS recipient_phone,
              r.name        AS relais_name,
              u.phone       AS user_phone
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       LEFT JOIN users      u  ON u.id  = o.user_id
       WHERE o.id = $1 AND o.qr_token = $2
       FOR UPDATE OF o`;
      queryParams = [orderId, token];
    } else {
      queryText = `SELECT o.*,
              rc.full_name  AS recipient_name,
              rc.phone      AS recipient_phone,
              r.name        AS relais_name,
              u.phone       AS user_phone
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       LEFT JOIN users      u  ON u.id  = o.user_id
       WHERE o.qr_token = $1
       FOR UPDATE OF o`;
      queryParams = [token];
    }

    const { rows: [order] } = await client.query(queryText, queryParams);

    if (!order) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Commande introuvable' } };
    }

    if (order.status !== 'available') {
      await client.query('ROLLBACK');
      return {
        status: 422,
        body: {
          error: order.status === 'collected'
            ? 'Ce colis a déjà été remis au client'
            : `Statut incompatible : ${order.status}`,
          current_status: order.status,
        },
      };
    }

    if (!order.qr_token) {
      await client.query('ROLLBACK');
      return { status: 400, body: { error: 'Aucun QR code généré pour cette commande' } };
    }

    if (order.qr_token !== token) {
      await client.query('ROLLBACK');
      log.warn(`[VERIFY-QR] Token invalide pour ${order.reference}`);
      return { status: 400, body: { error: 'QR code invalide' } };
    }

    if (order.qr_expires_at && new Date(order.qr_expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return {
        status: 400,
        body: {
          error: 'QR code expiré — veuillez en générer un nouveau',
          expired_at: order.qr_expires_at,
        },
      };
    }

    const machineResult = await transitionOrderStatus({
      orderId: order.id,
      newStatus: 'collected',
      actor: { id: user.id, role: user.role },
      source: 'patch',
      note: 'Remise client via QR Code',
      dbClient: client,
    });

    if (!machineResult.success) {
      await client.query('ROLLBACK');
      return { status: 422, body: { error: machineResult.error } };
    }

    await client.query(
      `UPDATE orders SET qr_token = NULL, qr_expires_at = NULL WHERE id = $1`,
      [order.id]
    );

    const { rows: [scanRow] } = await client.query(
      `INSERT INTO scans
         (order_id, step, scanned_by, location, scan_code, notes)
       VALUES ($1, 'collected', $2, $3, $4, 'Retrait client via QR Code — token validé')
       RETURNING id`,
      [
        order.id,
        user.id,
        order.relais_name || '',
        `QR-${String(token).slice(0, 8)}`,
      ]
    );

    await safeSyncScanToParcels({
      order_id: order.id,
      step: 'collected',
      scan_id: scanRow?.id,
      scanned_by: user.id,
      notes: 'Retrait client via QR Code — token validé',
    }, client);

    await client.query('COMMIT');

    // Preuve de retrait (post-commit, non bloquant)
    pickupProofService.issue(order.id, { issuedBy: user.id }).catch(err => {
      log.warn({ err, order_id: order.id }, '[verify-qr] émission preuve de retrait échouée (non-fatal)');
    });

    if (order.user_phone) {
      notifyText(
        order.user_phone,
        `Komerce · Votre colis ${order.reference} a bien été récupéré par ${order.recipient_name || 'le destinataire'}. Merci pour votre confiance ! 🎉`,
        'collected',
        order.id
      ).catch(err => log.error({ err }, 'Notification QR collect error'));
    }

    if (order.user_id) {
      try {
        // O7.3 (provider loyalty) : importait auparavant routes/loyalty.js
        // (une route, pas une boundary de feature). Voir docs/O7_3_BOUNDARY_ANALYSIS.md.
        const { recalculateLoyalty } = require('./loyalty-service');
        recalculateLoyalty(db, order.user_id)
          .catch(e => log.error({ err: e }, '[LOYALTY] recalculate error:'));
      } catch (_) { /* non-bloquant */ }
    }

    return {
      status: 200,
      body: {
        success: true,
        message: 'Remise enregistrée avec succès',
        reference: order.reference,
        recipient: order.recipient_name,
        relais: order.relais_name,
        collected_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { verifyQrCollection };
