'use strict';

/**
 * KOMERCE — services/order-payment-confirmation.js  (LOT 1)
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  Point d'entrée UNIQUE pour le cycle paiement → stock.             ║
 * ║                                                                      ║
 * ║  Avant LOT 1, cette logique était copiée-collée dans :             ║
 * ║    • routes/payments.js — webhook Stripe                           ║
 * ║    • routes/payments.js — POST /cash/confirm                       ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Ce service centralise les 3 étapes invariantes :
 *   1. pending → confirmed  (via state machine — idempotent)
 *   2. confirmed → ordered  (via state machine — non-fatal si noop)
 *   3. Vérification + décrémentage stock (FOR UPDATE — atomique)
 *
 * ⚠️  CONTRAT STRICT :
 *   - Ce service opère DANS une transaction existante (dbClient).
 *   - Il ne fait jamais BEGIN / COMMIT / ROLLBACK.
 *   - L'appelant est responsable du cycle de transaction.
 *   - Si stockBlocked=true, l'appelant décide : ROLLBACK (cash) ou
 *     COMMIT+alerte (Stripe, paiement déjà encaissé).
 *
 * Différences préservées entre cash et Stripe :
 *   - cash   : stockBlocked → appelant fait ROLLBACK + retourne 409
 *   - stripe : stockBlocked → appelant insère alerte + COMMIT
 *   Ces différences restent dans routes/payments.js — ce service
 *   ne prend pas de décision de transaction.
 *
 * @param {object}  opts
 * @param {string}  opts.orderId    — UUID de la commande
 * @param {object}  opts.actor      — { id, role } de l'initiateur
 * @param {string}  opts.source     — 'stripe_webhook' | 'cash_confirm' | 'wallet_full_payment' | 'shared_cart_full_payment'
 * @param {object}  opts.dbClient   — Client de transaction actif (pool.connect())
 * @param {string}  [opts.note]     — Note optionnelle pour l'historique
 *
 * @returns {Promise<{
 *   success:          boolean,
 *   noop:             boolean,
 *   stockBlocked:     boolean,
 *   insufficientItems: Array<{product_id:string, product_name:string, available:number, needed:number}>,
 *   error?:           string
 * }>}
 */

const { transitionOrderStatus } = require('./order-status-machine');

async function confirmPaymentCycle({ orderId, actor, source, dbClient, note }) {
  if (!dbClient) {
    throw new Error('[confirmPaymentCycle] dbClient requis — le service doit opérer dans une transaction active');
  }
  if (!orderId) {
    throw new Error('[confirmPaymentCycle] orderId requis');
  }

  const actor_ = actor || { id: null, role: 'system' };

  // ── Étape 1 : pending → confirmed ─────────────────────────────────────────
  // La state machine positionne payment_status='paid' et confirmed_at=NOW()
  // (migration 060) via COALESCE. Idempotent si déjà confirmed.
  const confirmNote = note
    || (source === 'stripe_webhook'
      ? 'Paiement Stripe reçu'
      : source === 'wallet_full_payment'
        ? 'Paiement intégral par wallet'
        : source === 'shared_cart_full_payment'
          ? 'Paiement intégral via panier partagé'
          : 'Paiement espèces confirmé par agent relais');

  const confirmResult = await transitionOrderStatus({
    orderId,
    newStatus: 'confirmed',
    actor:     actor_,
    source,
    note:      confirmNote,
    dbClient,
  });

  if (confirmResult.noop) {
    // Transition déjà effectuée (idempotence) → pas d'erreur mais rien à faire
    return { success: true, noop: true, stockBlocked: false, insufficientItems: [] };
  }
  if (!confirmResult.success) {
    return {
      success: false,
      noop: false,
      stockBlocked: false,
      insufficientItems: [],
      error: confirmResult.error,
    };
  }

  // ── Étape 2 : confirmed → ordered ─────────────────────────────────────────
  // Non-fatal : si la machine refuse (ex. déjà ordered), on continue.
  // L'ordre est déjà confirmé — le stock doit quand même être traité.
  const orderedNote = source === 'stripe_webhook'
    ? 'Commande lancée automatiquement après paiement Stripe'
    : source === 'wallet_full_payment'
      ? 'Commande lancée après paiement intégral par wallet'
      : source === 'shared_cart_full_payment'
        ? 'Commande lancée après financement complet du panier partagé'
        : 'Commande lancée après paiement cash';

  const orderResult = await transitionOrderStatus({
    orderId,
    newStatus: 'ordered',
    actor:     actor_,
    source:    'system',
    note:      orderedNote,
    dbClient,
  });

  if (!orderResult.success && !orderResult.noop) {
    // Log explicite mais non-bloquant : la commande est confirmed, le stock doit quand même bouger
    console.warn(`[confirmPaymentCycle] ⚠ confirmed→ordered rejeté (non-fatal): ${orderResult.error} — order=${orderId}`);
  }

  // ── Étape 3 : vérification stock + décrémentage (FOR UPDATE atomique) ─────
  //
  // Une seule requête JOIN avec FOR UPDATE OF p pour verrouiller tous les
  // produits concernés en une fois (évite les deadlocks par acquisition séquentielle).
  //
  // Produits avec stock IS NULL = stock non géré = on ne les vérifie pas.
  const { rows: items } = await dbClient.query(
    `SELECT
       oi.product_id,
       oi.quantity,
       p.stock,
       p.name AS product_name
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1
       AND p.stock IS NOT NULL
     FOR UPDATE OF p`,
    [orderId]
  );

  // Identifier les produits en rupture
  const insufficientItems = items
    .filter(i => i.stock < i.quantity)
    .map(i => ({
      product_id:   i.product_id,
      product_name: i.product_name,
      available:    i.stock,
      needed:       i.quantity,
    }));

  if (insufficientItems.length > 0) {
    // Retourner le flag — l'appelant décide :
    //   • cash   → ROLLBACK + 409 (paiement pas encore pris)
    //   • stripe → COMMIT + alerte (paiement déjà encaissé, traitement manuel)
    return {
      success:          true,
      noop:             false,
      stockBlocked:     true,
      insufficientItems,
    };
  }

  // Stock suffisant pour tous les articles → décrémenter
  for (const item of items) {
    await dbClient.query(
      'UPDATE products SET stock = stock - $1 WHERE id = $2',
      [item.quantity, item.product_id]
    );
  }

  return { success: true, noop: false, stockBlocked: false, insufficientItems: [] };
}

module.exports = { confirmPaymentCycle };
