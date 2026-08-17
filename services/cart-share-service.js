/**
 * @komerce-arch
 * @role          cart-share-service
 * @domain        shared-cart
 * @layer         service
 * @criticality   low
 * @inputs        share_token, order_id
 * @outputs       boolean
 * @depends       db.js
 * @used-by       routes/orders/create.js
 * @db-write      cart_shares
 * @db-txn        not_required
 * @doctrine      writer_not_owner_campaign_2026_08
 * @impact-areas  orders-create, shares
 * @version       2026-08
 */

'use strict';

// services/cart-share-service.js — frontière publique du domaine shared-cart
// pour les écritures cross-feature sur cart_shares (owner du lifecycle,
// cf. features/shared-cart.feature.js db.tables 'cart_shares: RW!').
//
// Avant (campagne WRITER-NOT-OWNER, 2026-08) : routes/orders/create.js
// exécutait un UPDATE cart_shares directement (SQL direct dans la table
// d'un autre feature). Ce module restaure la frontière : orders appelle
// cette API, jamais la table directement.

const db = require('../db');
const log = require('../utils/logger').child({ module: 'cart-share-service' });

/**
 * Marque le lien de partage comme converti en commande (fire-and-forget côté
 * appelant — même contrat que l'ancien appel direct : ne doit jamais faire
 * échouer la commande si le lien n'existe pas/est déjà converti).
 * @param {string} shareToken
 * @param {string} orderId
 * @returns {Promise<boolean>} true si une ligne a été mise à jour
 */
async function markShareConvertedToOrder(shareToken, orderId) {
  if (!shareToken || !orderId) return false;
  try {
    const { rowCount } = await db.query(
      `UPDATE cart_shares
       SET converted_order_id = $1,
           converted_at       = NOW()
       WHERE share_token = $2
         AND converted_order_id IS NULL`,
      [orderId, shareToken]
    );
    return rowCount > 0;
  } catch (e) {
    log.error({ err: e }, '[SHARES] markShareConvertedToOrder error');
    return false;
  }
}

module.exports = { markShareConvertedToOrder };
