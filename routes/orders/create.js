/**
 * @komerce-arch
 * @role          orders-create
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       middleware/auth.js, services/order-checkout-service.js,
 *                services/cart-share-service.js, utils/rates.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       finance_config
 * @db-write      none
 * @db-write-via:order-checkout-service order_items, order_status_history, orders, recipients
 * @db-write-via:cart-share-service shared_carts, shared_cart_events
 * @doctrine-note l'orchestration checkout (validation → pricing → shared-cart →
 *                transport → wallet → INSERT) vit dans order-checkout-service ;
 *                après son COMMIT, la façade demande au boundary shared-cart
 *                de réconcilier la complétion avant de rendre le HTTP 201.
 *                Pour Stripe/PayPal, finance_config est validée strictement
 *                avant toute création : aucun fallback FX ne peut engager un
 *                paiement en EUR. Le cash KMF reste indépendant de ce garde.
 * @db-txn        delegated_to_service
 * @doctrine      resolve_before_behavior_change, payment_fx_authority
 * @impact-areas  orders, checkout, shared-cart, payment, finance
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
const {
  getAuthoritativeRates,
  AuthoritativeRateUnavailableError,
} = require('../../utils/rates');

const EUR_PAYMENT_MODES = new Set(['stripe_eur', 'paypal_eur']);

// Business Alignment Closure — un relais explicite est désormais une
// précondition du checkout. Il fixe le marché, le routage et la résolution
// LOCAL_STOCK/IMPORT ; laisser le service choisir "le premier relais actif"
// rendrait ces décisions arbitraires en environnement multi-marché.
const orderCreateSchema = {
  ...orders.create,
  body: orders.create.body.fork(['relais_id'], schema => schema.required()),
};

router.post('/', authenticateOrCreateGuest, validate(orderCreateSchema), async (req, res, next) => {
  // Payment & FX Authority — toute commande qui sera encaissée en EUR doit
  // d'abord obtenir le taux canonique finance_config. getAuthoritativeRates()
  // hydrate le cache partagé de utils/rates ; l'orchestrateur checkout réutilise
  // donc exactement ce snapshot au moment de calculer orders.total_eur.
  // Aucun fallback 492/138 ne peut servir à créer une dette de paiement.
  if (EUR_PAYMENT_MODES.has(req.body.payment_mode)) {
    try {
      await getAuthoritativeRates();
    } catch (err) {
      if (err instanceof AuthoritativeRateUnavailableError || err?.code === 'fx_rate_unavailable') {
        return res.status(503).json({
          error: 'Taux de change temporairement indisponible — paiement EUR suspendu',
          code: 'fx_rate_unavailable',
        });
      }
      return next(err);
    }
  }

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