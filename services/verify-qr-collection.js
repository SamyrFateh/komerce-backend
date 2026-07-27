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
const { resolveQrCollection } = require('./qr-collection-core');
const log = require('../utils/logger').child({ module: 'verify-qr-collection' });
const pickupProofService = require('./documents/pickup-proof');

async function verifyQrCollection({ token, orderId, user }) {
  if (!token) return { status: 400, body: { error: 'token est requis' } };
  if (!user?.id || !user?.role) throw new Error('[verifyQrCollection] user requis');

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // P5-L5 : validation + transition + invalidation QR + scan + parcelSync
    // sont désormais dans qr-collection-core.js, partagé avec scan-operations.js
    // (verifyQr). ROLLBACK déjà exécuté par le noyau sur tout `ok:false`.
    const result = await resolveQrCollection({ client, token, orderId, user });
    if (!result.ok) return result.response;

    const { order } = result;

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
