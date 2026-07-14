/**
 * @komerce-arch
 * @role          payment-to-stock-single-entry
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        orderId, actor, source, dbClient
 * @outputs       confirmed_order, ordered_transition, stock_decrement, stockBlocked
 * @depends       services/order-status-machine.js, db.js
 * @used-by       services/payment-stripe.js, services/payment-cash-confirm.js, services/shared-cart-engine.js, paypal-flows, wallet-full-order-flows
 * @db-read       order_items, product_skus, product_variants, products
 * @db-write      alerts
 * @db-write-via:product-admin-service products, product_variants, product_skus
 * @db-txn        caller_transaction_required, stock_for_update, confirmPaymentCycle_unique
 * @doctrine      transaction_existante_obligatoire, confirmPaymentCycle_unique, stock_for_update, cash_rollback_vs_stripe_alert, inventory_model_dispatch_no_fallback
 * @impact-areas  orders, stock, payments, shared-cart, wallet, sourcing, loyalty
 * @version       2026-06
 */

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
 * @param {string}  opts.source     — 'stripe_webhook' | 'cash_confirm'
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
const { adjustStock }           = require('./product-admin-service');
const log = require('../utils/logger').child({ module: 'order-payment-confirmation' });
const db  = require('../db');
const { createAlert } = require('../utils/alerts');

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
    log.warn(`[confirmPaymentCycle] ⚠ confirmed→ordered rejeté (non-fatal): ${orderResult.error} — order=${orderId}`);
    // R5 FIX — Alerte opérationnelle : commande bloquée en 'confirmed' sans sourcing déclenché
    createAlert(db, {
      type: 'payment_cycle_confirmed_to_ordered_rejected',
      entityType: 'order',
      entityId: orderId,
      severity: 'medium',
      title: `confirmed→ordered rejeté — order ${orderId}`,
      description: `error=${orderResult.error}`,
    }).catch(e => log.error({ err: e }, '[confirmPaymentCycle] Échec INSERT alerte confirmed→ordered:'));
  }

  // ── Étape 3 : vérification stock + décrémentage (FOR UPDATE atomique) ─────
  //
  // Une seule requête JOIN avec FOR UPDATE OF p pour verrouiller tous les
  // produits concernés en une fois (évite les deadlocks par acquisition séquentielle).
  //
  // PDC-7 (Lot 7) — Deux moteurs de stock STRICTEMENT séparés par
  // p.inventory_model, jamais mélangés pour un même item :
  //   • inventory_model = 'SKU'            → verrouillage + validation
  //     exclusivement sur product_skus, via oi.sku_id. products.stock et
  //     product_variants.stock ne sont jamais lus ni écrits pour ces items.
  //     oi.sku_id absent = erreur bloquante immédiate (jamais de fallback legacy).
  //   • inventory_model = 'LEGACY_VARIANTS' → chemin historique inchangé
  //     (products.stock, puis product_variants.stock si has_variants + combo).
  //     Produits avec stock IS NULL = stock non géré = on ne les vérifie pas.
  const { rows: items } = await dbClient.query(
    `SELECT
       oi.product_id,
       oi.quantity,
       oi.variant_combo,
       oi.sku_id,
       p.stock,
       p.has_variants,
       p.inventory_model,
       p.name AS product_name
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1
     FOR UPDATE OF p`,
    [orderId]
  );

  const insufficientItems = [];
  const legacyItems = [];
  const skuItems = [];

  for (const item of items) {
    if (item.inventory_model === 'SKU') {
      if (!item.sku_id) {
        // Bug de résolution en amont (création de commande) — jamais un
        // fallback silencieux vers products.stock. On arrête tout net.
        throw new Error(
          `[confirmPaymentCycle] Produit "${item.product_name}" (${item.product_id}) est en ` +
          `inventory_model='SKU' mais order_items.sku_id est absent — order=${orderId}. ` +
          `Aucune lecture/écriture de products.stock ou product_variants.stock n'est autorisée pour cet item.`
        );
      }
      skuItems.push(item);
    } else {
      legacyItems.push(item);
    }
  }

  // ── Chemin legacy : vérification stock global (produits gérés uniquement) ──
  for (const item of legacyItems) {
    if (item.stock === null || item.stock === undefined) continue; // non géré
    if (item.stock < item.quantity) {
      insufficientItems.push({
        product_id:   item.product_id,
        product_name: item.product_name,
        available:    item.stock,
        needed:       item.quantity,
      });
    }
  }

  // Vérification stock par variante (legacy uniquement — VAGUE 3).
  // Pour chaque item avec combo, on lock + vérifie chaque ligne product_variants.
  for (const item of legacyItems) {
    if (!item.has_variants || !item.variant_combo) continue;
    for (const [vType, vValue] of Object.entries(item.variant_combo)) {
      const { rows: [variant] } = await dbClient.query(
        `SELECT id, stock
           FROM product_variants
          WHERE product_id = $1 AND variant_type = $2 AND variant_value = $3
          FOR UPDATE`,
        [item.product_id, vType, vValue]
      );
      // Variante introuvable → on alerte mais on ne bloque pas (la commande
      // existe déjà, blocage à l'étape de création). C'est un état anormal.
      if (!variant) {
        log.warn(`[confirmPaymentCycle] ⚠ variante introuvable au paiement: ${item.product_id} ${vType}=${vValue} — order=${orderId}`);
        continue;
      }
      // stock NULL = "non géré par cette variante" (retombe sur stock global déjà vérifié)
      if (variant.stock !== null && variant.stock < item.quantity) {
        insufficientItems.push({
          product_id:   item.product_id,
          product_name: `${item.product_name} (${vType}: ${vValue})`,
          available:    variant.stock,
          needed:       item.quantity,
        });
      }
    }
  }

  // ── Chemin SKU : verrouillage + validation sur le SKU exact uniquement ──
  for (const item of skuItems) {
    const { rows: [sku] } = await dbClient.query(
      `SELECT id, stock
         FROM product_skus
        WHERE id = $1 AND product_id = $2
        FOR UPDATE`,
      [item.sku_id, item.product_id]
    );
    if (!sku) {
      throw new Error(
        `[confirmPaymentCycle] SKU introuvable (sku_id=${item.sku_id}, product_id=${item.product_id}) — order=${orderId}`
      );
    }
    if (sku.stock < item.quantity) {
      insufficientItems.push({
        product_id:   item.product_id,
        product_name: item.product_name,
        available:    sku.stock,
        needed:       item.quantity,
      });
    }
  }

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
  // (produits + variantes dans la même TX — VAGUE 3, via product-admin-service)
  await adjustStock(dbClient, items, 'decrement');

  // LOY-01 : hook fidélité branché en post-commit dans chaque chemin de paiement
  // (payment-stripe, payment-paypal ×2, payment-cash-confirm, routes/cash,
  //  routes/shared-cart, routes/orders/create wallet-full).
  // Ne pas appeler recalculateLoyalty ici : mauvais système (System B tiers)
  // et déjà présent dans scan-operations + verify-qr-collection.
  return { success: true, noop: false, stockBlocked: false, insufficientItems: [] };
}

module.exports = { confirmPaymentCycle };
