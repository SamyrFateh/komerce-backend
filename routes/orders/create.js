/**
 * @komerce-arch
 * @role          orders-create
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       middleware/auth.js, services/order-checkout-service.js,
 *                services/cart-share-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-write-via:order-checkout-service order_items, order_status_history, orders, recipients
 * @db-write-via:cart-share-service shared_carts, shared_cart_events
 * @doctrine-note l'orchestration checkout (validation → pricing → shared-cart →
 *                transport → wallet → INSERT) vit dans order-checkout-service ;
 *                après son COMMIT, la façade demande au boundary shared-cart
 *                de réconcilier la complétion avant de rendre le HTTP 201.
 *                La route n'écrit jamais directement les tables shared-cart.
 * @db-txn        delegated_to_service
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout, shared-cart
 * @version       2026-09
 */

'use strict';

/**
 * KOMERCE — POST /api/orders
 *
 * Créer une commande (client authentifié).
 */

const express = require('express');
const router  = express.Router();
const { authenticateOrCreateGuest }      = require('../../middleware/auth-guest');
const { validate }                       = require('../../middleware/validate');
const { orders }                         = require('../../validators');
const { runOrderCheckout }               = require('../../services/order-checkout-service');
const { closeCompletedSharedCartForOrderItems } = require('../../services/cart-share-service');

router.post('/', authenticateOrCreateGuest, validate(orders.create), async (req, res, next) => {
  let result;
  try {
    result = await runOrderCheckout({ user: req.user, body: req.body });
  } catch (err) {
    return next(err);
  }

  if (!result.ok) {
    return res.status(result.status).json(result.body);
  }

  const { order, creditApplied, relais } = result;

  // Régression 2026-09 : une liste entièrement réclamée restait OPEN et
  // continuait à proposer « Clôturer la liste » malgré 4/4 achetés / reste 0.
  // La commande est déjà commitée à ce stade. On attend donc la projection
  // owner shared-cart AVANT le 201 afin qu'un rafraîchissement immédiat du
  // side-cart lise déjà CLOSED. Le boundary est fail-safe : s'il rencontre
  // une erreur, il la journalise et renvoie false sans transformer une
  // commande déjà créée en faux échec client.
  await closeCompletedSharedCartForOrderItems(req.body.items, order.id);

  return res.status(201).json({
    discount_pct: order.discount_pct || 0,
    discount_kmf: order.discount_kmf || 0,
    loyalty_label: order.loyalty_label || null,
    credit_applied_kmf: creditApplied,
    order: {
      id: order.id,
      reference: order.reference,
      status: order.status,
      total_kmf: order.total_kmf,
      total_eur: order.total_eur,
      transport_price_kmf: order.transport_price_kmf,
      payment_mode: order.payment_mode,
      payment_status: order.payment_status,
      cash_ref_code: order.cash_ref_code,
      pickup_code_recipient: order.pickup_code_recipient,
      confection_type: order.confection_type,
      module_type: order.module_type,
      relais: relais ? {
        id: relais.id,
        name: relais.name,
        address: relais.address,
      } : null,
      routing: {
        destination_island: order.destination_island,
        routing_mode: order.routing_mode,
        transit_hub: order.transit_hub,
      },
      created_at: order.created_at,
    },
  });
});

module.exports = router;