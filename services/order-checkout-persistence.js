/**
 * @komerce-arch
 * @role          orders-checkout-persistence
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/order-status-machine.js, services/wallet-service.js,
 *                services/pickup-secret-service.js, services/local-stock-service.js,
 *                services/order-payment-confirmation.js, services/customs-classification.js,
 *                services/order-cost-snapshot.js
 * @used-by       services/order-checkout-service.js
 * @db-read       orders
 * @db-write      order_items, order_status_history, orders
 * @db-txn        participant (reçoit le client transactionnel de l'appelant, ne BEGIN/COMMIT/ROLLBACK jamais lui-même)
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-08 (extrait de order-checkout-service.js, refactoring checkout réel)
 */

'use strict';

/**
 * order-checkout-persistence.js
 *
 * Extrait de services/order-checkout-service.js (refactoring réel du
 * checkout, post-audit domaine 4/5). Porte les écritures transactionnelles
 * du checkout, dans l'ordre où order-checkout-service.js les appelle :
 * INSERT order, historique initial, wallet debit transactionnel, INSERT
 * order_items (avec classification douanière figée — I-DOUANE-1 — et
 * allocation local_stock dans la MÊME transaction), complétion du cycle de
 * paiement wallet-100%, snapshot économique figé (non-bloquant).
 *
 * ⚠️ Ce module ne possède AUCUNE transaction : il reçoit le `client` déjà
 * ouvert par order-checkout-service.js (BEGIN posé par l'appelant) et ne
 * fait JAMAIS de BEGIN/COMMIT/ROLLBACK lui-même. Sur erreur métier
 * (stock insuffisant au moment de la confirmation wallet), il renvoie
 * { ok: false, status, body } SANS rollback — c'est order-checkout-
 * service.js qui reste seul propriétaire du ROLLBACK/COMMIT et de l'ordre
 * global des étapes. Copie exacte du comportement d'origine : mêmes
 * requêtes SQL, même ordre, mêmes messages/codes — seul le point
 * d'exécution du ROLLBACK a changé de fichier.
 *
 * Exports (appelés par order-checkout-service.js, dans cet ordre) :
 *   insertOrderRow(client, params)                → order (row complet)
 *   recordInitialHistory(client, orderId, userId)  → void
 *   applyWalletDebit(client, { userId, amountKmf, orderId, orderReference }) → void
 *   insertOrderItemsWithStock(client, { items, productMap, order, relais }) → void
 *   completeWalletFullPayment(client, { order, user })
 *     → { ok: true, walletPickupCode, order } | { ok: false, status, body }
 *   lockCostSnapshot(client, order)                → void (non-bloquant)
 */

const { randomUUID: uuidv4 } = require('crypto');
const { appendOrderHistoryNote } = require('./order-status-machine');
const { ensureSecretGenerated } = require('./pickup-secret-service');
const walletService = require('./wallet-service');
const { allocateForOrderItem } = require('./local-stock-service');
const log = require('../utils/logger').child({ module: 'order-checkout-persistence' });

async function insertOrderRow(client, params) {
  const {
    reference, userId, recipientId, relaisId, trackingPhone,
    totalKmf, totalEur, paymentMode, stripePaymentIntent, cashRefCode,
    confectionType, confectionInstructions, confectionDelayDays, confectionArtisanId,
    moduleType, moduleFabricId, moduleFabricType, moduleSize, moduleRetouche,
    moduleQtyMeters, moduleAccessories, orderOccasion,
    costEstimatedKmf, marginEstimatedPct, discountPct, discountKmf, loyaltyLabel,
    destinationIsland, routingMode, transitHub, transportPriceKmf,
    pickupCodeRecipient, pickupCodeRecipientUserId,
    displayAmount, displayCurrency, displayMeta, marketId,
  } = params;

  const { rows: [order] } = await client.query(

  `INSERT INTO orders (
     id, reference, user_id, recipient_id, relais_id,
     tracking_phone,
     total_kmf, total_eur,
     payment_mode, payment_status, stripe_payment_id,
     cash_ref_code,
     status,
     confection_type, confection_instructions,
     confection_delay_days, confection_artisan_id,
     module_type, module_fabric_id, module_fabric_type,
     module_size, module_retouche, module_qty_meters, module_accessories,
     order_occasion,
     cost_estimated_kmf, margin_estimated_pct,
     discount_pct, discount_kmf, loyalty_label,
     destination_island, routing_mode, transit_hub,
     transport_price_kmf,
     pickup_code_recipient, pickup_code_recipient_user_id,
     display_total_amount, display_currency, display_parity_snapshot,
     market_id
   ) VALUES (
     $1,$2,$3,$4,$5,
     $6,
     $7,$8,
     $9,$10,$11,
     $12,
     'pending',
     $13,$14,
     $15,$16,
     $17,$18,$19,
     $20,$21,$22,$23,
     $24,
     $25,$26,
     $27,$28,$29,
     $30,$31,$32,
     $33,
     $34,$35,
     $36,$37,$38,
     $39
   ) RETURNING *`,
  [
    uuidv4(), reference, userId, recipientId, relaisId || null,
    trackingPhone || null,
    totalKmf, totalEur,
    paymentMode,
    // PATCH P2-4 : toujours créer en 'pending'. Si wallet couvre 100%,
    // confirmPaymentCycle (appelé plus bas) transite vers 'paid' via la machine.
    // L'ancien pre-write 'paid' ici contournait la machine et était redondant.
    'pending',
    stripePaymentIntent || null,
    cashRefCode,
    confectionType,
    confectionInstructions || null,
    confectionDelayDays,
    confectionArtisanId || null,
    moduleType || null,
    moduleFabricId || null,
    moduleFabricType || null,
    moduleSize || null,
    moduleRetouche,
    moduleQtyMeters || null,
    moduleAccessories ? JSON.stringify(moduleAccessories) : null,
    orderOccasion || null,
    Math.round(costEstimatedKmf),
    Number(marginEstimatedPct),
    discountPct,
    discountKmf,
    loyaltyLabel,
    destinationIsland,
    routingMode,
    transitHub,
    transportPriceKmf,
    pickupCodeRecipient,
    pickupCodeRecipientUserId,
    displayAmount,
    displayCurrency,
    displayMeta ? JSON.stringify(displayMeta) : null,
    marketId || null,
  ]
);

  return order;
}

async function recordInitialHistory(client, orderId, userId) {
  await appendOrderHistoryNote(client, orderId, 'pending', 'Commande créée', userId);
}

async function applyWalletDebit(client, { userId, amountKmf, orderId, orderReference }) {
  await walletService.debit(client, {
    userId,
    amountKmf,
    reason: 'checkout',
    referenceId: orderId,
    idempotencyKey: `checkout_${orderId}`,
    note: `Wallet appliqué à commande ${orderReference}`,
  });

  await client.query(
    'UPDATE orders SET wallet_applied_kmf = $1 WHERE id = $2',
    [amountKmf, orderId]
  );
}

async function insertOrderItemsWithStock(client, { items, productMap, order, relais }) {
  const { resolveFrozenClassification } = require('./customs-classification');

  for (const item of items) {
    const product = productMap[item.product_id];
    const qty = parseInt(item.quantity, 10) || 1;

    // Gel de la classification douanière — I-DOUANE-1
    const clf = await resolveFrozenClassification(client, product.category);

    await client.query(
      `INSERT INTO order_items (
         order_id, product_id, quantity, price_kmf,
         module_type, module_fabric_id, module_fabric_type,
         module_size, module_retouche, module_qty_meters, module_accessories,
         variant_combo, sku_id,
         customs_category_key, sh_code, douane_pct, tva_pct, taxe_add_pct,
         classification_defaulted,
         requested_transport_rail,
         shared_cart_item_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        order.id,
        item.product_id,
        qty,
        item._effective_unit_price_kmf,
        item.module_type || null,
        item.module_fabric_id || null,
        item.module_fabric_type || null,
        item.module_size || null,
        item.module_retouche || false,
        item.module_qty_meters || null,
        item.module_accessories ? JSON.stringify(item.module_accessories) : null,
        // VAGUE 3 : combo de variantes choisie côté frontend (taille, couleur...)
        // Stockée en jsonb pour rester autonome (= valide même si la variante
        // est supprimée plus tard côté admin). Voir 063_product_variants.sql.
        item.variant_combo && typeof item.variant_combo === 'object' && !Array.isArray(item.variant_combo)
          ? JSON.stringify(item.variant_combo)
          : null,
        // Lot 3 : FK vers product_skus, posée uniquement pour les produits
        // en inventory_model = 'SKU' (resolveActiveSku plus haut). NULL pour
        // tout produit LEGACY_VARIANTS — variant_combo reste la référence
        // d'affichage/historique dans ce cas, comme avant.
        item._resolved_sku_id || null,
        clf.customs_category_key,
        clf.sh_code,
        clf.douane_pct,
        clf.tva_pct,
        clf.taxe_add_pct,
        clf.classification_defaulted,
        // Code canonique du rail demandé par le client (null = aucun choix explicite).
        // L'orchestrateur logistique assigne le rail réel dans assigned_transport_rail.
        item.requested_transport_rail ?? null,
        // Boutique First (D2/D4) — rattachement à un article de liste
        // partagée. Optionnel : null pour tout achat hors contexte liste.
        // L'unicité est arbitrée par un index unique en base (migration 123),
        // pas par une vérification applicative : deux participants qui
        // achètent le même article de liste au même instant produisent une
        // seule commande gagnante, l'autre reçoit une violation de
        // contrainte que ce bloc convertit en 409 explicite plus bas.
        item.shared_cart_item_id || null,
      ]
    );

    // Vague 2 D2 — engage ce stock local AVANT tout paiement, dans la
    // MÊME transaction que la commande (client, pas db global) : le
    // verrou FOR UPDATE posé par allocateForOrderItem tient jusqu'au
    // COMMIT/ROLLBACK de cette requête, sérialisant deux checkouts
    // concurrents sur le même produit. No-op silencieux (retourne null)
    // pour l'immense majorité des produits, qui n'ont pas de ligne
    // local_stock — la logique d'allocation reste entièrement dans
    // local-stock-service.js, cette route n'en est que l'appelante.
    await allocateForOrderItem(client, {
      productId: item.product_id,
      marketId:  relais?.market_id || null,
      orderId:   order.id,
      quantity:  qty,
    });
  }
}

// ── Wallet couvre 100% → cycle paiement complet (state machine + stock) ──
// Sans cet appel : status reste 'pending', stock non décrémenté, machine contournée.
async function completeWalletFullPayment(client, { order, user, relais }) {
  const { confirmPaymentCycle } = require('./order-payment-confirmation');
  const cycleResult = await confirmPaymentCycle({
    orderId: order.id,
    actor:   { id: user.id, role: user.role || 'user' },
    source:  'wallet_full_payment',
    dbClient: client,
    note:    'Paiement intégral par wallet',
  });
  if (cycleResult.stockBlocked) {
    return {
      ok: false, status: 409,
      body: {
        error: 'Stock insuffisant pour finaliser la commande',
        items: cycleResult.insufficientItems,
      },
    };
  }

  // Code de retrait canonique — généré ici, à la confirmation du paiement
  // (jamais à la création). Même transaction que le cycle de paiement.
  const secretResult = await ensureSecretGenerated({
    orderId:  order.id,
    relaisId: relais?.id || null,
    channel:  'wallet_full_payment',
    dbClient: client,
  });
  const walletPickupCode = secretResult.code || null;

  // Rafraîchir order : status / confirmed_at à jour dans la réponse API
  const { rows: [refreshed] } = await client.query(
    'SELECT * FROM orders WHERE id = $1', [order.id]
  );
  if (refreshed) Object.assign(order, refreshed);

  return { ok: true, walletPickupCode, order };
}

// ─── PHASE B — Snapshot economique fige (P3 doctrine) ────────────────
// Appelle pricing-engine.recommend() sur chaque order_item et stocke
// l'estime dans order_item_cost_imputations (immuable).
// No-op si ORDER_COST_SNAPSHOT_ACTIVE != true (rollout progressif).
// Idempotent (ON CONFLICT order_item_id DO NOTHING).
async function lockCostSnapshot(client, order) {
  try {
    const orderCostSnapshot = require('./order-cost-snapshot');
    await orderCostSnapshot.lockEstimatedCostsForOrder(order.id, client, { source: 'pricing-engine' });
  } catch (snapErr) {
    // Non-bloquant : si le snapshot échoue, la commande est quand même créée.
    // L'erreur est loggée pour traitement admin (alerts table possible plus tard).
    log.error('[ORDER-CREATE] cost snapshot failed for', order.reference, snapErr.message);
  }
}

module.exports = {
  insertOrderRow,
  recordInitialHistory,
  applyWalletDebit,
  insertOrderItemsWithStock,
  completeWalletFullPayment,
  lockCostSnapshot,
};
