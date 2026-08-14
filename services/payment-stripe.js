/**
 * @komerce-arch
 * @role          stripe-payment-service
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        payment_intent, stripe_event, order_reference, metadata
 * @outputs       payment_confirmation, processed_event, stock_transition, notifications
 * @depends       services/order-payment-confirmation.js, services/notification-service.js, services/loyalty-service.js, routes/pickup-secret.js
 * @used-by       routes/payments.js, stripe_webhooks
 * @db-read       orders
 * @db-write      alerts, orders, stripe_events_processed
 * @db-txn        stripe_event_idempotency, payment_to_stock_single_entry
 * @doctrine      idempotence_stripe, payment_to_stock_single_entry, raw_body_webhook_intact, wallet_non_modifie_ici
 * @impact-areas  payments, orders, stock, pickup, notifications, loyalty, sourcing
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — services/payment-stripe.js  (R5)
 *
 * Logique métier Stripe extraite de routes/payments.js.
 * La route reste une façade : auth + validate + appel service + réponse.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  Invariants respectés                                               ║
 * ║  I-01 : toute transition passe par order-status-machine            ║
 * ║  I-02 : confirmPaymentCycle = seul point d'entrée paiement→stock   ║
 * ║  I-05 : wallet non modifié ici (géré par order-payment-confirmation)║
 * ║  I-07 : idempotence Stripe via stripe_events_processed             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Exports :
 *   createStripeIntent(order, stripe)
 *   handleStripeSucceeded(event, intent, db, stripe)
 *   handleStripePaymentFailed(event, intent, db)
 *   markStripeEventProcessed(event, payloadSummary, db)
 */

const { confirmPaymentCycle }    = require('./order-payment-confirmation');
const { markFailed }             = require('./payment-service');
// O7.2 (Cycle B) : importait auparavant routes/pickup-secret.js (une route,
// pas une boundary de feature). Voir docs/O7_2_CYCLE_ANALYSIS.md, Cycle B.
const { generateAndStoreSecret, cacheCodeForReveal } = require('./pickup-secret-service');
const { createAlert } = require('../utils/alerts');
const log = require('../utils/logger').child({ module: 'payment-stripe' });

// ─── createStripeIntent ───────────────────────────────────────────────────────
/**
 * Crée ou réutilise un Stripe PaymentIntent pour une commande.
 *
 * @param {object} order   — ligne orders complète
 * @param {object} stripe  — instance Stripe initialisée
 * @returns {{ client_secret, amount_eur, amount_cents, order_reference, reused? }}
 * @throws si Stripe échoue
 */
async function createStripeIntent(order, stripe, db) {
  // Idempotence : réutiliser un intent existant si réutilisable
  if (order.stripe_payment_id) {
    try {
      const existing = await stripe.paymentIntents.retrieve(order.stripe_payment_id);
      const REUSABLE = ['requires_payment_method', 'requires_confirmation', 'requires_action'];
      if (REUSABLE.includes(existing.status)) {
        log.info({ intent_id: existing.id, status: existing.status },
          '[STRIPE] PaymentIntent existant réutilisé');
        return {
          client_secret:   existing.client_secret,
          amount_eur:      order.total_eur,
          amount_cents:    existing.amount,
          order_reference: order.reference,
          reused:          true,
        };
      }
      log.warn({ intent_id: existing.id, status: existing.status },
        '[STRIPE] PaymentIntent non-réutilisable — nouvel intent créé');
    } catch (retrieveErr) {
      log.warn({ err: retrieveErr, intent_id: order.stripe_payment_id },
        '[STRIPE] Échec retrieve — nouvel intent créé');
    }
  }

  const amount_cents  = Math.round(parseFloat(order.total_eur) * 100);
  const idempotencyKey = `order_pi_${order.id}`;

  const intent = await stripe.paymentIntents.create({
    amount:   amount_cents,
    currency: 'eur',
    metadata: {
      order_reference: order.reference,
      order_id:        order.id,
      komerce:         'true',
    },
    description: `Komerce — Commande ${order.reference}`,
  }, { idempotencyKey });

  await db.query(
    'UPDATE orders SET stripe_payment_id = $1 WHERE id = $2',
    [intent.id, order.id]
  );

  return {
    client_secret:   intent.client_secret,
    amount_eur:      order.total_eur,
    amount_cents,
    order_reference: order.reference,
  };
}

// ─── handleStripeSucceeded ────────────────────────────────────────────────────
/**
 * Gère payment_intent.succeeded.
 * 8 chemins de sortie documentés. Retourne { received, idempotent?, ignored?, rejected?, stockBlocked? }
 * pour que la route construise sa réponse HTTP.
 *
 * @param {object} event   — objet Stripe Event complet
 * @param {object} intent  — event.data.object (PaymentIntent)
 * @param {object} db      — module db (pool)
 * @param {Function} triggerPurchasing — fire-and-forget (route/purchasing)
 * @returns {object} payload de réponse
 */
async function handleStripeSucceeded(event, intent, db, triggerPurchasing) {
  const orderId        = intent.metadata?.order_id;
  const orderReference = intent.metadata?.order_reference;

  // Chemin 1 : PI sans order_id metadata
  if (!orderId) {
    log.warn({ intent_id: intent.id }, '[STRIPE-WEBHOOK] PI sans order_id metadata, ignored');
    await markStripeEventProcessed(event, { ignored: 'no_metadata' }, db);
    return { received: true, ignored: true };
  }

  // Chemins 2-3 : commande introuvable ou déjà paid
  const { rows: [existing] } = await db.query(
    'SELECT payment_status FROM orders WHERE id = $1', [orderId]
  );
  if (!existing) {
    log.warn({ order_id: orderId }, '[STRIPE-WEBHOOK] order_id not found');
    await markStripeEventProcessed(event, { ignored: 'order_not_found', order_id: orderId }, db);
    return { received: true, ignored: true };
  }
  if (existing.payment_status === 'paid') {
    log.info({ order_id: orderId }, '[STRIPE-WEBHOOK] order already paid, skipping');
    await markStripeEventProcessed(event, { ignored: 'already_paid', order_id: orderId }, db);
    return { received: true, idempotent: true };
  }

  let processedOk          = false;
  let triggerPurchasingFor = null;
  let smsContext           = null;
  let stockBlocked         = false;
  let revealCode           = null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Cycle central I-02
    const cycleResult = await confirmPaymentCycle({
      orderId,
      actor:    { id: null, role: 'system' },
      source:   'stripe_webhook',
      dbClient: client,
    });

    // Chemin 4 : noop
    if (cycleResult.noop) {
      await client.query('COMMIT');
      await markStripeEventProcessed(event, { noop: 'confirm', order_id: orderId }, db);
      return { received: true, idempotent: true };
    }

    // Chemin 5 : cycle rejeté
    if (!cycleResult.success) {
      log.error({ cycle_error: cycleResult.error }, '[STRIPE] Cycle rejected');
      await client.query('ROLLBACK');
      await markStripeEventProcessed(event, { rejected: 'confirm', error: cycleResult.error, order_id: orderId }, db);
      return { received: true, rejected: true };
    }

    // Chemin 6 : stockBlocked
    if (cycleResult.stockBlocked) {
      stockBlocked = true;
      const insufficientItems = cycleResult.insufficientItems;

      const incidentNote = '\n[INCIDENT paid_but_stock_blocked] ' +
        insufficientItems.map(i => `${i.product_name}: dispo=${i.available}, besoin=${i.needed}`).join('; ');
      await client.query(
        `UPDATE orders SET notes = COALESCE(notes,'') || $1 WHERE id = $2`,
        [incidentNote, orderId]
      );

      // SAVEPOINT dédié : createAlert() persiste dans le contrat physique réel
      // et ne devrait normalement jamais échouer pour une raison de schéma,
      // mais l'alerte reste non-bloquante par doctrine (P0-A) — un incident
      // DB inattendu sur CET insert ne doit jamais empoisonner le client
      // transactionnel dont dépendent les queries suivantes (SELECT relais_id,
      // pickup secret, COMMIT).
      try {
        await client.query('SAVEPOINT alert_stock_blocked');
        await createAlert(client, {
          type: 'paid_but_stock_blocked',
          entityType: 'order',
          entityId: orderId,
          severity: 'high',
          title: `Paiement Stripe encaissé mais stock bloqué — ${orderReference}`,
          description: `Stripe webhook ${event.id} (payment_intent ${intent.id}) : ` +
            insufficientItems.map(i => `${i.product_name} dispo=${i.available} besoin=${i.needed}`).join('; '),
        });
        await client.query('RELEASE SAVEPOINT alert_stock_blocked');
      } catch (alertErr) {
        await client.query('ROLLBACK TO SAVEPOINT alert_stock_blocked').catch(() => {});
        log.error({ err: alertErr, order_reference: orderReference },
          '[STRIPE-WEBHOOK] FAILED TO INSERT ALERT');
      }

      log.error(`[STRIPE-WEBHOOK] ⛔ paid_but_stock_blocked: ${orderReference} — ${insufficientItems.length} produit(s) en rupture`);
    }

    // Code secret retrait Western Union
    const { rows: [orderRow] } = await client.query(
      'SELECT relais_id FROM orders WHERE id = $1', [orderId]
    );

    let stripeBillingName = null;
    let stripeCardLast4   = null;
    let stripeEmail       = intent.receipt_email || null;
    try {
      const charge = intent.latest_charge && typeof intent.latest_charge === 'object'
        ? intent.latest_charge : null;
      if (charge) {
        stripeBillingName = charge.billing_details?.name || null;
        stripeCardLast4   = charge.payment_method_details?.card?.last4 || null;
        stripeEmail       = charge.billing_details?.email || stripeEmail;
      }
    } catch (_) { /* non-bloquant */ }

    try {
      const genResult = await generateAndStoreSecret({
        orderId,
        relaisId:  orderRow?.relais_id || null,
        channel:   'stripe',
        dbClient:  client,
        extraUpdates: {
          stripe_billing_name:  stripeBillingName,
          stripe_card_last4:    stripeCardLast4,
          stripe_receipt_email: stripeEmail,
        },
      });
      revealCode = genResult.code;
    } catch (genErr) {
      log.error({ err: genErr }, '[STRIPE-WEBHOOK] génération code échouée');
    }

    // Marquer event traité dans la même tx
    await client.query(
      `INSERT INTO stripe_events_processed (stripe_event_id, event_type, payload_summary)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, JSON.stringify({
        order_id:      orderId,
        order_reference: orderReference,
        stock_blocked: stockBlocked,
      })]
    );

    await client.query('COMMIT');
    processedOk = !stockBlocked;
    smsContext  = { order_id: orderId, order_reference: orderReference };
    if (processedOk) triggerPurchasingFor = orderId;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // cacheCodeForReveal uses db.query (pool), NOT the tx client.
  // Must run AFTER COMMIT to avoid FK lock contention on orders row.
  if (revealCode) {
    try {
      await cacheCodeForReveal(orderId, revealCode);
    } catch (cacheErr) {
      log.error({ err: cacheErr }, '[STRIPE-WEBHOOK] cacheCodeForReveal échouée');
    }
  }

  // LOY-01 — Hook fidélité gros panier (fire-and-forget, non-bloquant)
  if (processedOk && smsContext?.order_id) {
    try {
      const loyaltyService = require('./loyalty-service');
      loyaltyService.handleOrderConfirmed({ orderId: smsContext.order_id })
        .then(r => { if (r && !r.skipped) log.info({ orderId: smsContext.order_id }, '[loyalty] hook OK:', r); })
        .catch(e => log.warn({ err: e }, '[loyalty] hook error:'));
    } catch (_) { /* non-bloquant */ }
  }

  // Post-commit : notifications + sourcing (fire-and-forget)
  if (smsContext) {
    log.info(`✅ Paiement Stripe confirmé : ${smsContext.order_reference}${stockBlocked ? ' (STOCK BLOCKED)' : ''}`);
    if (processedOk) {
      try {
        const notifSvc = require('./notification-service');
        notifSvc.notifyPaymentConfirmed(smsContext.order_id, smsContext.order_reference)
          .catch(e => log.error({ err: e }, '[STRIPE-NOTIF] notification failed'));
        require('./invoice-service').issueInvoice(smsContext.order_id)
          .catch(e => log.error({ err: e }, '[STRIPE-INVOICE] private PDF generation failed'));
      } catch (e) { log.error({ err: e }, '[STRIPE-NOTIF] require error'); }
    }
  }

  if (triggerPurchasingFor && triggerPurchasing) {
    triggerPurchasing(triggerPurchasingFor)
      .then(() => log.info({ order_reference: smsContext?.order_reference }, '[PURCHASING] Stripe trigger OK'))
      .catch(async (e) => {
        log.error({ err: e, order_reference: smsContext?.order_reference }, '[PURCHASING] Stripe trigger error');
        try {
          await createAlert(db, {
            type: 'purchasing_trigger_failed',
            entityType: 'order',
            entityId: triggerPurchasingFor,
            severity: 'medium',
            title: `triggerPurchasing failed — ${smsContext?.order_reference || triggerPurchasingFor}`,
            description: `Stripe webhook ${event.id} : ${e.message}`,
          });
        } catch (alertErr) {
          log.error({ err: alertErr }, '[PURCHASING] alert insert failed');
        }
      });
  }

  return { received: true };
}

// ─── handleStripePaymentFailed ────────────────────────────────────────────────
/**
 * Gère payment_intent.payment_failed.
 * Guard strict : ne jamais écraser un statut 'paid'.
 */
async function handleStripePaymentFailed(event, intent, db) {
  const orderId = intent.metadata?.order_id;

  if (!orderId) {
    log.warn({ intent_id: intent.id }, '[STRIPE-WEBHOOK] payment_failed sans order_id, ignored');
    await markStripeEventProcessed(event, { ignored: 'no_metadata_failed' }, db);
    return;
  }

  const upd = await markFailed(orderId, { client: db });
  if (!upd.changed) {
    log.warn(`[STRIPE-WEBHOOK] payment_failed ignored (already paid or unknown): ${intent.metadata?.order_reference}`);
  } else {
    log.info(`❌ Paiement Stripe échoué : ${intent.metadata?.order_reference}`);
  }

  await markStripeEventProcessed(event, { event: 'failed', order_id: orderId, applied: upd.rowCount > 0 }, db);
}

// ─── markStripeEventProcessed ─────────────────────────────────────────────────
/**
 * Marque un event Stripe traité (idempotence). Hors transaction principale.
 * Erreur loggée mais non bloquante.
 */
async function markStripeEventProcessed(event, payloadSummary, db) {
  try {
    await db.query(
      `INSERT INTO stripe_events_processed (stripe_event_id, event_type, payload_summary)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, JSON.stringify(payloadSummary || {})]
    );
  } catch (e) {
    log.warn({ err: e }, '[STRIPE-WEBHOOK] markStripeEventProcessed failed');
  }
}

module.exports = {
  createStripeIntent,
  handleStripeSucceeded,
  handleStripePaymentFailed,
  markStripeEventProcessed,
};
