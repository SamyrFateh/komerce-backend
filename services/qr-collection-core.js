/**
 * @komerce-arch
 * @role          qr-collection-core
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        client, token, orderId, user
 * @outputs       { ok:true, order, scanRow } | { ok:false, response:{status,body} }
 * @depends       db.js (via client fourni par l'appelant), services/order-status-machine.js, utils/parcelSync.js
 * @used-by       services/verify-qr-collection.js, services/scan-operations.js
 * @db-read       orders, recipients, relais, users
 * @db-write      orders, scans
 * @db-txn        caller_transaction_required
 * @doctrine      qr_pickup_single_validation (P5-L5)
 * @impact-areas  orders
 * @version       2026-07
 */

'use strict';

const log = require('../utils/logger').child({ module: 'qr-collection-core' });

/**
 * KOMERCE — Cœur de vérification/collecte QR retrait (services/qr-collection-core.js)
 *
 * Avant (P5-L5, 2026-07) : cette logique — SELECT verrouillé, 4 gardes
 * (commande trouvée / statut 'available' / token présent / token correspond
 * / non expiré), transition vers 'collected', invalidation qr_token/
 * qr_expires_at, insertion du scan, sync colis — était dupliquée à
 * l'identique dans services/verify-qr-collection.js ET services/scan-
 * operations.js (verifyQr). Deux chemins d'entrée (QR public / scan
 * terrain), une seule vérité désormais.
 *
 * NE GÈRE PAS le BEGIN/COMMIT ni les effets post-commit (notification,
 * preuve de retrait, fidélité) : ceux-ci restent spécifiques à chaque
 * appelant (ex. seul verify-qr-collection.js émet une preuve de retrait —
 * asymétrie constatée, non tranchée ici, signalée séparément). L'appelant
 * fournit un client déjà en transaction (BEGIN déjà posé) et fait lui-même
 * le COMMIT après un `ok:true` ; sur `ok:false`, le ROLLBACK a déjà été fait
 * ici.
 *
 * Durcissement au passage : `FOR UPDATE OF o` est désormais posé dans les
 * DEUX chemins (verify-qr-collection.js l'avait déjà, scan-operations.js ne
 * l'avait pas — un SELECT non verrouillé sur ce chemin pouvait laisser deux
 * collectes concurrentes passer les gardes avant que l'une des deux
 * n'écrive).
 *
 * @param {object} opts
 * @param {object} opts.client   client transactionnel (BEGIN déjà exécuté par l'appelant)
 * @param {string} opts.token
 * @param {string} [opts.orderId]
 * @param {{id, role}} opts.user
 * @returns {Promise<{ok:true, order:object, scanRow:object}|{ok:false, response:{status:number, body:object}}>}
 */
async function resolveQrCollection({ client, token, orderId, user }) {
  const queryText = orderId
    ? `SELECT o.*,
              rc.full_name  AS recipient_name,
              rc.phone      AS recipient_phone,
              r.name        AS relais_name,
              u.phone       AS user_phone
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       LEFT JOIN users      u  ON u.id  = o.user_id
       WHERE o.id = $1 AND o.qr_token = $2
       FOR UPDATE OF o`
    : `SELECT o.*,
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
  const queryParams = orderId ? [orderId, token] : [token];

  const { rows: [order] } = await client.query(queryText, queryParams);

  if (!order) {
    await client.query('ROLLBACK');
    return { ok: false, response: { status: 404, body: { error: 'Commande introuvable' } } };
  }

  if (order.status !== 'available') {
    await client.query('ROLLBACK');
    return {
      ok: false,
      response: {
        status: 422,
        body: {
          error: order.status === 'collected'
            ? 'Ce colis a déjà été remis au client'
            : `Statut incompatible : ${order.status}`,
          current_status: order.status,
        },
      },
    };
  }

  if (!order.qr_token) {
    await client.query('ROLLBACK');
    return { ok: false, response: { status: 400, body: { error: 'Aucun QR code généré pour cette commande' } } };
  }

  if (order.qr_token !== token) {
    await client.query('ROLLBACK');
    log.warn(`[VERIFY-QR] Token invalide pour ${order.reference}`);
    return { ok: false, response: { status: 400, body: { error: 'QR code invalide' } } };
  }

  if (order.qr_expires_at && new Date(order.qr_expires_at) < new Date()) {
    await client.query('ROLLBACK');
    return {
      ok: false,
      response: {
        status: 400,
        body: { error: 'QR code expiré — veuillez en générer un nouveau', expired_at: order.qr_expires_at },
      },
    };
  }

  // require() différé : évite un cycle statique avec order-status-machine.js
  // au chargement du module (même précaution que dans les deux fichiers
  // d'origine avant extraction).
  const { transitionOrderStatus } = require('./order-status-machine');

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
    return { ok: false, response: { status: 422, body: { error: machineResult.error } } };
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
    [order.id, user.id, order.relais_name || '', `QR-${String(token).slice(0, 8)}`]
  );

  const { safeSyncScanToParcels } = require('../utils/parcelSync');
  await safeSyncScanToParcels({
    order_id: order.id,
    step: 'collected',
    scan_id: scanRow?.id,
    scanned_by: user.id,
    notes: 'Retrait client via QR Code — token validé',
  }, client);

  return { ok: true, order, scanRow };
}

module.exports = { resolveQrCollection };
