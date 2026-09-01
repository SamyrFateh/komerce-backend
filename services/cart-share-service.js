/**
 * @komerce-arch
 * @role          shared-cart-orders-boundary
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        share_token, order_id, order_items
 * @outputs       boolean
 * @depends       db.js
 * @used-by       routes/orders/create.js, services/order-post-commit-hooks.js
 * @db-read       shared_cart_items, order_items
 * @db-write      cart_shares, shared_carts, shared_cart_events
 * @db-txn        single_statement_atomic_for_completion
 * @doctrine      writer_not_owner_campaign_2026_08, auto_close_when_fully_claimed
 * @impact-areas  orders-create, shares, shared-cart-lifecycle
 * @version       2026-09
 */

'use strict';

// services/cart-share-service.js — frontière publique du domaine shared-cart
// pour les effets cross-feature déclenchés par orders.
//
// Avant la campagne WRITER-NOT-OWNER (2026-08), orders écrivait directement
// cart_shares. Cette frontière porte désormais aussi la projection de fin de
// liste : une commande peut réclamer une ou plusieurs lignes, mais seul le
// domaine shared-cart décide si cette nouvelle vérité rend la liste complète
// et doit la fermer. Orders ne fait donc jamais d'UPDATE direct sur
// shared_carts/shared_cart_events.

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

/**
 * Ferme automatiquement la liste qui vient d'être entièrement réclamée.
 *
 * Cette fonction est appelée APRÈS le COMMIT de la commande mais AVANT la
 * réponse HTTP 201. Elle est idempotente et fail-safe : un incident de cette
 * projection ne transforme jamais une commande déjà commitée en échec client.
 *
 * Le CTE est volontairement une seule instruction SQL :
 *   1. résout la liste depuis les shared_cart_item_id de la commande ;
 *   2. n'accepte qu'une seule liste (l'orchestrateur orders interdit déjà le
 *      mélange, cette garde empêche néanmoins une fermeture ambiguë) ;
 *   3. ferme uniquement une liste OPEN dont TOUTES les lignes possèdent
 *      désormais un order_item ;
 *   4. écrit l'événement cart_closed dans la même instruction atomique.
 *
 * Deux dernières commandes concurrentes sur des lignes différentes restent
 * sûres : chacune n'exécute cette vérification qu'après son propre COMMIT ; la
 * dernière à commiter voit donc les claims déjà commités de l'autre. Si deux
 * vérifications voient simultanément la complétion, le prédicat status='open'
 * fait de l'UPDATE un gagnant unique et évite un double événement.
 *
 * @param {Array<object>} orderItems items de la commande reçus au checkout
 * @param {string} orderId commande qui vient d'être créée
 * @returns {Promise<boolean>} true uniquement si cette commande a déclenché la fermeture
 */
async function closeCompletedSharedCartForOrderItems(orderItems, orderId) {
  if (!Array.isArray(orderItems) || !orderId) return false;

  const sharedCartItemIds = [...new Set(
    orderItems
      .map(item => item?.shared_cart_item_id)
      .filter(Boolean)
      .map(String)
  )];

  if (!sharedCartItemIds.length) return false;

  try {
    const { rowCount } = await db.query(
      `WITH target_carts AS (
         SELECT DISTINCT sci.shared_cart_id
           FROM shared_cart_items sci
          WHERE sci.id = ANY($1::uuid[])
       ),
       single_target AS (
         SELECT shared_cart_id
           FROM target_carts
          WHERE (SELECT COUNT(*) FROM target_carts) = 1
       ),
       closed AS (
         UPDATE shared_carts sc
            SET status = 'closed',
                closed_at = NOW(),
                updated_at = NOW()
          WHERE sc.status = 'open'
            AND sc.id IN (SELECT shared_cart_id FROM single_target)
            AND EXISTS (
              SELECT 1
                FROM shared_cart_items sci
               WHERE sci.shared_cart_id = sc.id
            )
            AND NOT EXISTS (
              SELECT 1
                FROM shared_cart_items sci
               WHERE sci.shared_cart_id = sc.id
                 AND NOT EXISTS (
                   SELECT 1
                     FROM order_items oi
                    WHERE oi.shared_cart_item_id = sci.id
                 )
            )
          RETURNING sc.id, sc.closed_at
       )
       INSERT INTO shared_cart_events (
         shared_cart_id, event_type, actor_type, actor_id, payload
       )
       SELECT closed.id,
              'cart_closed',
              'system',
              NULL,
              jsonb_build_object(
                'closed_at', closed.closed_at,
                'reason', 'all_items_claimed',
                'order_id', $2
              )
         FROM closed
       RETURNING shared_cart_id`,
      [sharedCartItemIds, orderId]
    );

    return rowCount > 0;
  } catch (e) {
    log.error({ err: e, orderId }, '[SHARED-CART] auto-close completed list error');
    return false;
  }
}

module.exports = {
  markShareConvertedToOrder,
  closeCompletedSharedCartForOrderItems,
};
