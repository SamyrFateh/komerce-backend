/**
 * @komerce-arch
 * @role          qr-collection-core
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        client, token, orderId, user
 * @outputs       { ok:true, order, scanRow } | { ok:false, response:{status,body} }
 *                { ok:true, order, token, expiresAt, rotated } | { ok:false, response:{status,body} }
 * @depends       db.js (via client fourni par l'appelant), services/order-status-machine.js, utils/parcelSync.js
 * @used-by       services/verify-qr-collection.js, services/scan-operations.js, routes/orders/qr.js
 * @db-read       orders, recipients, relais, users
 * @db-write      orders, scans
 * @db-txn        caller_transaction_required
 * @doctrine      qr_pickup_single_validation (P5-L5)
 * @impact-areas  orders
 * @version       2026-07
 */

'use strict';

const crypto = require('crypto');
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

/**
 * KOMERCE — Émission / rotation centralisée du QR de retrait (P5 §4.6/§6)
 *
 * Avant : `routes/orders/qr.js` générait et écrivait `qr_token` /
 * `qr_expires_at` directement en SQL, sans verrou de ligne, et écrasait un
 * token existant sans distinguer une première émission d'une rotation.
 * `routes/tracking.js::generateTrackingToken()` restait un second écrivain
 * mort de `qr_token`, sans expiration, jamais appelé en dehors de son propre
 * fichier.
 *
 * Après : ce noyau est le seul point d'écriture de `qr_token` /
 * `qr_expires_at` à l'émission. La route devient une façade HTTP : elle
 * ouvre la transaction (`db.withTransaction`), applique ses propres règles
 * d'autorisation (IDOR agent_relais ↔ relais) via `preWriteCheck`, puis
 * délègue la génération.
 *
 * Le verrou (`FOR UPDATE OF o`) est posé dès le SELECT et tenu jusqu'à
 * l'UPDATE : deux émissions concurrentes sur la même commande ne peuvent pas
 * toutes les deux lire "pas encore de token" avant que l'une des deux
 * n'écrive — la seconde voit forcément le token déjà posé par la première.
 *
 * `rotated` distingue explicitement les deux cas pour l'appelant (log,
 * audit, réponse HTTP) : `false` si `qr_token` était NULL avant l'écriture
 * (première émission), `true` s'il y avait déjà un token (rotation —
 * l'ancien token est immédiatement invalidé par le simple fait d'être
 * remplacé : plus aucune requête ne peut matcher dessus après ce COMMIT).
 *
 * @param {object} opts
 * @param {object} opts.client          client transactionnel (BEGIN déjà exécuté par l'appelant)
 * @param {string} opts.orderId
 * @param {number} [opts.expirationHours=48]
 * @param {(order:object) => {ok:true}|{ok:false, response:{status:number, body:object}}} [opts.preWriteCheck]
 *        Hook d'autorisation exécuté sur la ligne verrouillée, avant le
 *        contrôle de statut et avant l'écriture. Permet à l'appelant
 *        d'appliquer ses propres règles (ex. IDOR cross-relais) sans que le
 *        noyau ait à connaître `req.user`.
 * @returns {Promise<{ok:true, order:object, token:string, expiresAt:Date, rotated:boolean}|{ok:false, response:{status:number, body:object}}>}
 */
async function issueOrRotateQrToken({ client, orderId, expirationHours = 48, preWriteCheck }) {
  const { rows: [order] } = await client.query(
    `SELECT o.*,
            rc.full_name AS recipient_name,
            r.name       AS relais_name
     FROM orders o
     LEFT JOIN recipients rc ON rc.id = o.recipient_id
     LEFT JOIN relais     r  ON r.id  = o.relais_id
     WHERE o.id = $1
     FOR UPDATE OF o`,
    [orderId]
  );

  if (!order) {
    await client.query('ROLLBACK');
    return { ok: false, response: { status: 404, body: { error: 'Commande introuvable' } } };
  }

  if (typeof preWriteCheck === 'function') {
    const authz = preWriteCheck(order);
    if (!authz.ok) {
      await client.query('ROLLBACK');
      return authz;
    }
  }

  if (order.status !== 'available') {
    await client.query('ROLLBACK');
    return {
      ok: false,
      response: {
        status: 422,
        body: {
          error: `Impossible de générer un QR — statut actuel : ${order.status} (attendu : available)`,
          current_status: order.status,
        },
      },
    };
  }

  const rotated = Boolean(order.qr_token);

  // [TOK-01] Token QR = CSPRNG pur (crypto.randomBytes), non dérivé des
  // inputs (id/relaisId/timestamp/QR_SECRET) — inchangé par rapport à
  // l'ancien comportement de routes/orders/qr.js.
  const token = crypto.randomBytes(24).toString('hex'); // 48 car. hex
  const expiresAt = new Date(Date.now() + expirationHours * 60 * 60 * 1000);

  await client.query(
    `UPDATE orders SET qr_token = $1, qr_expires_at = $2, updated_at = NOW() WHERE id = $3`,
    [token, expiresAt, orderId]
  );

  log.info(
    `[QR-TOKEN] ${rotated ? 'Rotation' : 'Émission'} pour ${order.reference} — token: ${token.slice(0, 8)}... expires: ${expiresAt.toISOString()}`
  );

  return { ok: true, order, token, expiresAt, rotated };
}

module.exports = { resolveQrCollection, issueOrRotateQrToken };
