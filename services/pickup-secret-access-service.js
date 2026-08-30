/**
 * @komerce-arch
 * @role          pickup-secret-access-service
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        orderId, code, token, userId, payerName
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, services/order-mutation-service.js, utils/pickup-receipt-html.js
 * @used-by       services/pickup-secret-service.js (réexport)
 * @db-read       orders, order_items, products, relais, users, pickup_reveal_codes, pickup_print_tokens
 * @db-write      orders, pickup_reveal_codes, pickup_print_tokens
 * @db-write-via:order-mutation-service orders
 * @db-txn        none (pool global db, comme avant l'extraction — aucune transaction ajoutée)
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-08 (extrait de pickup-secret-service.js, LOT 5B — nettoyage architectural)
 */

'use strict';

/**
 * pickup-secret-access-service.js
 *
 * Extrait de services/pickup-secret-service.js (LOT 5B, nettoyage
 * architectural). Porte l'accès contrôlé et temporaire au secret de
 * retrait APRÈS sa génération : mise en cache one-shot pour révélation,
 * token d'impression, reçu imprimable, révélation one-shot au destinataire
 * autorisé.
 *
 * Ne porte PAS le cycle de vie cryptographique du secret (génération,
 * anti-collision, hash/salt, régénération admin) — celui-ci reste dans
 * services/pickup-secret-service.js. Cette frontière sépare :
 *   - émettre un secret (pickup-secret-service.js)
 *   - donner un accès contrôlé, temporaire et one-shot à un secret déjà
 *     émis (ce fichier)
 *
 * Copie exacte du comportement d'origine — mêmes requêtes SQL, mêmes TTL,
 * mêmes ON CONFLICT, même atomicité one-shot (DELETE ... RETURNING pour le
 * print token, purge après reveal), mêmes codes HTTP, mêmes messages,
 * aucune transaction ajoutée (pool global `db`, exactement comme avant).
 *
 * services/pickup-secret-service.js reste la façade publique unique : il
 * réexporte les 4 fonctions ci-dessous, aucun appelant historique n'est
 * modifié.
 *
 * Exports :
 *   cacheCodeForReveal(orderId, code)        → void — INSERT pickup_reveal_codes (TTL 30 min)
 *   issuePrintToken({ orderId, code, payerName }) → token — INSERT pickup_print_tokens (TTL 2 min)
 *   getReceiptHTML({ orderId, token })       → { status: 200, html } | { status, error }
 *   revealOnce({ orderId, userId })          → { status, body }
 */

const { markPickupSecretRevealed } = require('./order-mutation-service');

const crypto = require('crypto');
const db     = require('../db');
const { buildReceiptHTML } = require('../utils/pickup-receipt-html');
const log = require('../utils/logger').child({ module: 'pickup-secret-service' });

// ══════════════════════════════════════════════════════════════════════════════
// cacheCodeForReveal
// ══════════════════════════════════════════════════════════════════════════════
// Persiste le code clair dans pickup_reveal_codes (TTL 30 min).
// Remplace la Map REVEAL_CACHE in-memory (SEC-1 / migration 070).

async function cacheCodeForReveal(orderId, code) {
  await db.query(
    `INSERT INTO pickup_reveal_codes (order_id, code, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 minutes')
     ON CONFLICT (order_id) DO UPDATE
       SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
    [orderId, code]
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// issuePrintToken
// ══════════════════════════════════════════════════════════════════════════════
// Génère un token d'impression et l'insère en DB (valable 2 min).

async function issuePrintToken({ orderId, code, payerName }) {
  const token = crypto.randomBytes(24).toString('hex');
  await db.query(
    `INSERT INTO pickup_print_tokens (token, order_id, code, payer_name, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '2 minutes')
     ON CONFLICT (token) DO NOTHING`,
    [token, orderId, code, payerName || null]
  );
  return token;
}

// ══════════════════════════════════════════════════════════════════════════════
// getReceiptHTML
// ══════════════════════════════════════════════════════════════════════════════
// Retourne { status: 200, html } ou { status, error }.

async function getReceiptHTML({ orderId, token }) {
  if (!token) {
    return { status: 400, error: 'Token manquant' };
  }

  // Consomme le token (DELETE … RETURNING, one-shot)
  const { rows: [tokenData] } = await db.query(
    `DELETE FROM pickup_print_tokens
      WHERE token = $1 AND order_id = $2 AND expires_at > NOW()
      RETURNING order_id, code, payer_name`,
    [token, orderId]
  );
  if (!tokenData) {
    return { status: 403, error: 'Token invalide ou expiré' };
  }

  const { rows: [order] } = await db.query(`
    SELECT
      o.reference, o.total_kmf, o.created_at,
      o.payment_received_at,
      o.payer_name,
      r.name AS relais_name, r.zone AS relais_city,
      u.full_name AS agent_name
    FROM orders o
    LEFT JOIN relais r ON r.id = o.relais_id
    LEFT JOIN users u ON u.id = o.payment_received_by_agent_id
    WHERE o.id = $1
  `, [orderId]);

  if (!order) {
    return { status: 404, error: 'Commande introuvable' };
  }

  const { rows: items } = await db.query(`
    SELECT oi.quantity, oi.price_kmf, p.name AS product_name
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = $1
  `, [orderId]);

  const html = buildReceiptHTML({
    code:  tokenData.code,
    order,
    items,
  });

  return { status: 200, html };
}

// ══════════════════════════════════════════════════════════════════════════════
// revealOnce
// ══════════════════════════════════════════════════════════════════════════════
// Révélation one-shot du code clair au destinataire choisi au checkout.
// Fenêtre 30 min, destinataire vérifié côté serveur, 410 si déjà révélé ou expiré.

async function revealOnce({ orderId, userId }) {
  const { rows: [order] } = await db.query(`
    SELECT id, reference, user_id, pickup_code_recipient_user_id,
           pickup_secret_channel,
           pickup_secret_emitted_at,
           pickup_secret_revealed_at,
           pickup_secret_last4,
           pickup_secret_hash,
           pickup_secret_salt,
           total_kmf
    FROM orders WHERE id = $1
  `, [orderId]);

  if (!order) {
    return { status: 404, body: { error: 'Commande introuvable' } };
  }

  const authorizedRecipientUserId =
    order.pickup_code_recipient_user_id || order.user_id;

  if (authorizedRecipientUserId && String(authorizedRecipientUserId) !== String(userId)) {
    return { status: 403, body: { error: 'Vous n’êtes pas le destinataire du code de retrait' } };
  }

  if (!order.pickup_secret_hash) {
    return { status: 202, body: {
      status:  'pending',
      message: 'Paiement en cours de validation, réessayez dans quelques secondes',
    }};
  }

  if (order.pickup_secret_revealed_at) {
    return { status: 410, body: {
      error:               'Code déjà révélé une fois',
      already_revealed_at: order.pickup_secret_revealed_at,
      message:             'Pour retrouver votre code, utilisez la procédure de perte.',
      masked:              order.pickup_secret_last4
                             ? ('•••-•••-' + order.pickup_secret_last4.slice(-2))
                             : null,
    }};
  }

  const emittedAt = new Date(order.pickup_secret_emitted_at);
  const windowEnd = new Date(emittedAt.getTime() + 30 * 60 * 1000);
  if (new Date() > windowEnd) {
    return { status: 410, body: {
      error:   'Fenêtre de révélation expirée',
      message: 'Le code ne peut plus être affiché. Utilisez la procédure de perte.',
      masked:  order.pickup_secret_last4
                 ? ('•••-•••-' + order.pickup_secret_last4.slice(-2))
                 : null,
    }};
  }

  const { rows: [revealRow] } = await db.query(
    'SELECT code FROM pickup_reveal_codes WHERE order_id = $1 AND expires_at > NOW()',
    [orderId]
  );
  if (!revealRow) {
    return { status: 410, body: {
      error:   'Code non disponible',
      message: 'Le code n\'est plus disponible (redémarrage serveur ou expiration). Utilisez la procédure de perte.',
      masked:  order.pickup_secret_last4
                 ? ('•••-•••-' + order.pickup_secret_last4.slice(-2))
                 : null,
    }};
  }

  // Marquer révélé + purger le cache (one-shot)
  await Promise.all([
    markPickupSecretRevealed(db, orderId),
    db.query('DELETE FROM pickup_reveal_codes WHERE order_id = $1', [orderId]),
  ]);

  log.info(`[PICKUP-SECRET] 👁 Code révélé (one-shot) order=${orderId} channel=${order.pickup_secret_channel}`);

  const qrPayloadRaw = JSON.stringify({ c: revealRow.code, o: order.reference });
  const qrPayload = 'KMR1.' + Buffer.from(qrPayloadRaw)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return { status: 200, body: {
    order_ref:       order.reference,
    code:            revealRow.code,
    qr_payload:      qrPayload,
    channel:         order.pickup_secret_channel,
    total_kmf:       Number(order.total_kmf || 0),
    expires_in_days: 60,
    warning:         'Ce code ne s\'affichera qu\'une seule fois. Notez-le ou prenez une capture d\'écran maintenant.',
  }};
}

module.exports = {
  cacheCodeForReveal,
  issuePrintToken,
  getReceiptHTML,
  revealOnce,
};
