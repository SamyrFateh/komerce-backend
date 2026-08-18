/**
 * @komerce-arch
 * @role          payment-create-stripe-order-intent
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js
 * @used-by       none
 * @db-read       orders
 * @db-write      orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  payment, checkout
 * @version       2026-06
 */

'use strict';

/**
 * I-SWEEP-3A — PaymentIntent Stripe idempotent par commande.
 *
 * Corrige le risque G2 : un replay frontend/réseau de
 * POST /api/payments/stripe/intent pouvait créer plusieurs PaymentIntents
 * pour la même commande avant que l'ID ne soit réutilisé.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');
const { setStripePaymentId } = require('./order-mutation-service');
const log = require('../utils/logger').child({ module: 'create-stripe-order-intent' });

const PRIVILEGED_ROLES = ['admin', 'agent_hub', 'agent_relais'];

async function createStripeOrderIntent({ orderReference, user }) {
  if (!orderReference) {
    return { status: 400, body: { error: 'order_reference requis' } };
  }
  if (!user?.id || !user?.role) {
    throw new Error('[createStripeOrderIntent] user requis');
  }

  const { rows } = await db.query(
    'SELECT * FROM orders WHERE reference = $1',
    [orderReference]
  );
  if (!rows.length) return { status: 404, body: { error: 'Commande introuvable' } };

  const order = rows[0];

  if (!PRIVILEGED_ROLES.includes(user.role) && String(order.user_id) !== String(user.id)) {
    return { status: 403, body: { error: 'Acces refuse a cette commande' } };
  }

  if (order.payment_mode !== 'stripe_eur') {
    return { status: 400, body: { error: "Cette commande n'utilise pas Stripe" } };
  }
  if (order.payment_status === 'paid') {
    return { status: 400, body: { error: 'Commande déjà payée' } };
  }

  const amountCents = Math.round(parseFloat(order.total_eur) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { status: 400, body: { error: 'Montant Stripe invalide' } };
  }

  let intent = null;

  if (order.stripe_payment_id) {
    try {
      const existing = await stripe.paymentIntents.retrieve(order.stripe_payment_id);
      if (existing && !['canceled', 'succeeded'].includes(existing.status)) {
        intent = existing;
      }
    } catch (e) {
      log.warn({ err: e }, '[STRIPE-INTENT] existing intent retrieve failed:');
    }
  }

  if (!intent) {
    intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      metadata: {
        order_reference: order.reference,
        order_id: order.id,
        komerce: 'true',
      },
      description: `Komerce — Commande ${order.reference}`,
    }, {
      idempotencyKey: `pi_order_${order.id}`,
    });

    await setStripePaymentId(db, {
      orderId: order.id,
      stripePaymentId: intent.id,
      onlyIfEmptyOrSame: true,
    });
  }

  return {
    status: 200,
    body: {
      client_secret: intent.client_secret,
      amount_eur: order.total_eur,
      amount_cents: amountCents,
      order_reference: order.reference,
      stripe_payment_id: intent.id,
      reused: Boolean(order.stripe_payment_id && order.stripe_payment_id === intent.id),
    },
  };
}

module.exports = { createStripeOrderIntent };
