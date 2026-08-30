/**
 * @komerce-arch
 * @role          orders-post-commit-hooks
 * @domain        orders
 * @layer         service
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       side_effects
 * @depends       services/pickup-secret-service.js, services/cart-share-service.js,
 *                services/notification-service.js, services/loyalty-service.js
 * @used-by       services/order-checkout-service.js
 * @db-read       none
 * @db-write      none
 * @doctrine-note toutes ces actions sont fire-and-forget, exécutées APRÈS le
 *                COMMIT de la commande — un échec ici ne doit jamais faire
 *                échouer ou re-rollback la commande déjà actée en DB.
 * @impact-areas  orders, checkout, notifications, loyalty
 * @version       2026-08
 */

'use strict';

/**
 * order-post-commit-hooks.js
 *
 * Extrait de routes/orders/create.js (domaine 4/5, refactoring classe A).
 *
 * Regroupe les actions post-commit de la création de commande, TOUTES
 * fire-and-forget (aucune n'est attendue par l'appelant, aucune n'a de valeur
 * de retour exploitée) :
 *   - cacheCodeForReveal (code de retrait wallet-100%)
 *   - markShareConvertedToOrder (liaison au partage — WRITER-NOT-OWNER)
 *   - notifyOrderCreated (SMS + email)
 *   - loyaltyService.handleOrderConfirmed (hook fidélité gros panier wallet)
 *
 * Doit être appelé APRÈS le COMMIT de la transaction (jamais avant, jamais
 * avec le client de transaction — ces actions utilisent le pool global db,
 * pas client).
 *
 * Exports :
 *   runOrderPostCommitHooks({ order, relais, items, productMap, payment_mode,
 *     cash_ref_code, reference, cashTimeout, tracking_phone, rPhone, user,
 *     bodyEmail, creditApplied, total_kmf, walletPickupCode, share_token })
 *     → void (aucune valeur de retour exploitée, aucune promesse attendue)
 */

const { cacheCodeForReveal } = require('./pickup-secret-service');
const { notifyOrderCreated } = require('./notification-service');
const log = require('../utils/logger').child({ module: 'order-post-commit-hooks' });

function runOrderPostCommitHooks({
  order,
  relais,
  items,
  productMap,
  payment_mode,
  cash_ref_code,
  reference,
  cashTimeout,
  tracking_phone,
  rPhone,
  user,
  bodyEmail,
  creditApplied,
  total_kmf,
  walletPickupCode,
  share_token,
}) {
  // ── Code de retrait wallet-100% : cache pour révélation one-shot ────────
  // Fait après COMMIT (comme Stripe/PayPal) : pickup_reveal_codes n'est pas
  // transactionnel avec la commande, un échec ici ne doit pas la faire échouer.
  if (walletPickupCode) {
    cacheCodeForReveal(order.id, walletPickupCode)
      .catch(e => log.error({ err: e }, '[ORDER-CREATE] cacheCodeForReveal (wallet) error:'));
  }

  // ── Lier le partage à la commande si share_token présent (fire-and-forget) ──
  // Campagne WRITER-NOT-OWNER (2026-08) : plus de SQL direct sur cart_shares
  // (table propriétaire de shared-cart) — passe par la frontière publique
  // du domaine shared-cart. Voir services/cart-share-service.js.
  if (share_token) {
    require('./cart-share-service')
      .markShareConvertedToOrder(share_token, order.id)
      .catch(e => log.error({ err: e }, '[SHARES] linkShareToOrder error:'));
  }

  // ── Notifications post-commit (multi-numéros) ──────────────────────────

  const localPhone = rPhone || null;
  const diasporaPhone = tracking_phone || user?.phone || null;
  const smsPhones = [...new Set([localPhone, diasporaPhone].filter(Boolean))];

  const userEmail = user?.email || bodyEmail || null;

  let cashSmsText = null;
  if (payment_mode === 'cash_relais') {
    const totalStr = Number(order.total_kmf).toLocaleString('fr-FR');
    cashSmsText = `Komerce : Commande ${reference} enregistree ! Rendez-vous au ${relais?.name || 'relais'} pour payer ${totalStr} KMF. Code : ${cash_ref_code}. Vous avez ${cashTimeout}h.`;
  }

  const emailItems = items.map(i => {
    const p = productMap[i.product_id] || {};
    const qty = parseInt(i.quantity, 10) || 1;
    // GAP-07 — l'email de confirmation doit refléter le même prix effectif
    // que order_items/total_kmf, jamais le prix générique product.price_kmf
    // (sinon un SKU en promo affiche un prix différent de celui facturé).
    const unitPrice = i._effective_unit_price_kmf != null ? i._effective_unit_price_kmf : (p.price_kmf || 0);
    return {
      name: p.name || 'Produit',
      qty,
      price_kmf: unitPrice * qty,
    };
  });

  notifyOrderCreated(order, smsPhones, userEmail, emailItems, relais, cashSmsText)
    .catch(err => log.error({ err }, '[ORDER-CREATED] ❌'));

  // LOY-01 — Hook fidélité gros panier (wallet full payment, fire-and-forget)
  if (creditApplied > 0 && total_kmf === 0 && order.id) {
    try {
      const loyaltyService = require('./loyalty-service');
      loyaltyService.handleOrderConfirmed({ orderId: order.id })
        .then(r => { if (r && !r.skipped) log.info({ orderId: order.id }, '[loyalty] wallet hook OK:', r); })
        .catch(e => log.warn({ err: e }, '[loyalty] wallet hook error:'));
    } catch (_) { /* non-bloquant */ }
  }
}

module.exports = { runOrderPostCommitHooks };
