/**
 * @komerce-arch
 * @role          orders-checkout-orchestrator
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, services/cart-share-service.js,
 *                services/order-post-commit-hooks.js, services/order-checkout-item-resolution.js,
 *                services/order-checkout-persistence.js, services/local-stock-service.js
 * @used-by       routes/orders/create.js
 * @db-read       orders, product_skus, product_variants, products, recipients, relais, shared_cart_items, shared_carts
 * @db-write      order_items, order_status_history, orders, recipients
 * @doctrine-note cart_shares n'est plus écrit ici directement (campagne WRITER-NOT-OWNER
 *                2026-08) — voir services/cart-share-service.js markShareConvertedToOrder
 * @db-txn        owns_full_transaction
 * @doctrine      docs/doctrine/DOCTRINE_FULFILLMENT_MIXTE.md, explicit_relay_market_anchor, resolve_before_behavior_change
 * @impact-areas  orders, checkout, shared-cart, local-stock
 * @version       2026-09 (LOCAL_STOCK/IMPORT + transport commercial IMPORT-only)
 */

'use strict';

/**
 * order-checkout-service.js
 *
 * Extrait de routes/orders/create.js (domaine 4/5, refactoring classe A).
 * Nettoyage architectural ultérieur (audit Phase 1, 3 warnings I-BACK-2) :
 * la résolution ligne-par-ligne du panier (produit, SKU/legacy, stock, prix
 * canonique, claim shared_cart_item_id) a été extraite vers
 * services/order-checkout-item-resolution.js, et les écritures
 * transactionnelles (INSERT order, historique, wallet debit, INSERT
 * order_items, classification douanière figée, allocation local_stock,
 * cycle wallet 100%, snapshot coût) vers services/order-checkout-persistence.js.
 *
 * Ce fichier reste le SEUL orchestrateur TRANSACTIONNEL du checkout : lui
 * seul acquiert/relâche le client, pose BEGIN/COMMIT/ROLLBACK, décide de
 * l'ordre global des étapes, et traduit les erreurs transactionnelles
 * finales (23505 shared_cart_item, local_stock_insufficient) en résultat.
 * Les sous-services reçoivent le même `client` transactionnel et ne font
 * JAMAIS de BEGIN/COMMIT/ROLLBACK eux-mêmes.
 *
 * Fulfillment mixte — Lots B/C/D : après résolution canonique produit/SKU/prix,
 * l'orchestrateur demande au owner local-stock de classifier sous verrou la
 * quantité agrégée de chaque Product en LOCAL_STOCK ou IMPORT. Le verdict est
 * snapshoté sur order_items par order-checkout-persistence.js. Pour le devis
 * commercial, seules les lignes IMPORT sont transmises à transport-pricing :
 * LOCAL_STOCK contribue donc exactement 0 au transport international, sans
 * introduire de connaissance local-stock dans le moteur de transport.
 *
 * Invariant marché : relais_id est obligatoire ici, y compris pour les appels
 * service directs. Le service ne choisit jamais un relais actif « par défaut » :
 * le relais explicite est l'ancre serveur du market_id, du routing et du
 * verdict LOCAL_STOCK/IMPORT.
 *
 * Résultat renvoyé à l'appelant (jamais de res.status/res.json ici) :
 *   { ok: true, order, creditApplied, relais }
 *   { ok: false, status, body }
 *   throws sur erreur inattendue.
 */

const db      = require('../db');
const { getLoyaltyDiscount }             = require('./loyalty-service');
const { getRule }                        = require('../utils/rules');
const { getRates }                       = require('../utils/rates');
const { getUniqueRef, generateCashCode } = require('./order-service');
const walletService = require('./wallet-service');
const { resolveRoutingFromRelais, RoutingError } = require('./routing');
const { quoteTransportPriceForOrder, TransportPricingError } = require('./transport-pricing');
const { resolveDisplaySnapshot } = require('./order-display-snapshot');
const { runOrderPostCommitHooks } = require('./order-post-commit-hooks');
const { resolveCheckoutItems } = require('./order-checkout-item-resolution');
const {
  FULFILLMENT_SOURCE,
  resolveCheckoutFulfillmentSources,
} = require('./local-stock-service');
const {
  insertOrderRow,
  recordInitialHistory,
  applyWalletDebit,
  insertOrderItemsWithStock,
  completeWalletFullPayment,
  lockCostSnapshot,
} = require('./order-checkout-persistence');
const log = require('../utils/logger').child({ module: 'order-checkout-service' });

// MODULE_TYPES — sous-types pour le module couture uniquement
const MODULE_TYPES = ['ready_made', 'fabric_only', 'custom_from_fabric'];

function fail(status, body) {
  return { ok: false, status, body };
}

async function runOrderCheckout({ user, body }) {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const rates = await getRates();
    const eurKmf = rates?.eur_kmf;
    // PATCH P2-3 : log explicite si le taux EUR/KMF est indisponible en DB.
    // Un prix EUR calculé sur un taux stale peut provoquer une divergence comptable.
    if (!eurKmf) {
      log.error('[ORDER-CREATE] getRates() n\'a pas retourné eur_kmf — fallback 492 utilisé. Prix EUR potentiellement inexact.');
    }
    const eurKmfFinal = eurKmf || 492;

    const {
      items = [],
      relais_id,
      payment_mode,
      stripe_payment_intent,
      tracking_phone,

      confection_type = 'aucun',
      confection_instructions,
      confection_delay_days = 0,
      confection_artisan_id,

      module_type,
      module_fabric_id,
      module_fabric_type,
      module_size,
      module_retouche = false,
      module_qty_meters,
      module_accessories,

      order_occasion = null,
      use_wallet = false,
      share_token,
      pickup_code_recipient = 'buyer',
      display_market_code = null,
      email: bodyEmail = null,
    } = body;

    if (!Array.isArray(items) || items.length === 0) {
      await client.query('ROLLBACK');
      return fail(400, { error: 'items[] obligatoire (tableau, min 1 article)' });
    }

    if (!['stripe_eur', 'cash_relais', 'paypal_eur'].includes(payment_mode)) {
      await client.query('ROLLBACK');
      return fail(400, { error: 'payment_mode invalide — valeurs : stripe_eur | cash_relais | paypal_eur' });
    }

    if (module_type && !MODULE_TYPES.includes(module_type)) {
      await client.query('ROLLBACK');
      return fail(400, { error: `module_type invalide. Valeurs : ${MODULE_TYPES.join(', ')}` });
    }

    if (!relais_id) {
      await client.query('ROLLBACK');
      return fail(400, {
        error: 'relais_id obligatoire — le checkout exige un relais explicite',
        code: 'relay_required',
      });
    }

    const { rows: [relais] } = await client.query(
      'SELECT * FROM relais WHERE id = $1 AND is_active = TRUE',
      [relais_id]
    );
    if (!relais) {
      await client.query('ROLLBACK');
      return fail(404, { error: 'Relais introuvable' });
    }

    let routing = { destination_island: null, routing_mode: null, transit_hub: null };

    try {
      routing = resolveRoutingFromRelais(relais);
    } catch (e) {
      if (e instanceof RoutingError) {
        await client.query('ROLLBACK');
        return fail(e.statusCode || 400, { error: e.message, code: e.code });
      }
      throw e;
    }

    let recipient_id = null;
    // Lot 3 (checkout) : plus de « qui récupère ? » dans le formulaire — le
    // backend n'accepte aucune identité de retrait alternative depuis le
    // payload de création. Le compte acheteur (WhatsApp vérifié) est la
    // seule source.
    const rName  = user.full_name;
    const rPhone = user.phone;

    if (rName && rPhone) {
      const { rows: [existingRc] } = await client.query(
        'SELECT id FROM recipients WHERE user_id = $1 AND phone = $2 AND relais_id = $3 LIMIT 1',
        [user.id, rPhone, relais?.id || null]
      );

      if (existingRc) {
        recipient_id = existingRc.id;
      } else {
        const { rows: [newRc] } = await client.query(
          'INSERT INTO recipients (user_id, full_name, phone, relais_id, is_default) VALUES ($1,$2,$3,$4,FALSE) RETURNING id',
          [user.id, rName, rPhone, relais?.id || null]
        );
        recipient_id = newRc.id;
      }
    }

    const [
      maxQty, fretPerKg, aedFallback, customsPct, cashTimeout,
      seaKmfPerKgCommercial, airKmfPerKgTaxable, airVolumetricDivisor,
    ] = await Promise.all([
      getRule('MAX_QUANTITY_PER_ITEM', 100),
      getRule('FREIGHT_KMF_PER_KG', 65),
      getRule('AED_KMF_FALLBACK', 138),
      getRule('CUSTOMS_DEFAULT_PCT', 20),
      getRule('CASH_PAYMENT_TIMEOUT_HOURS', 36),
      // §8 — tarifs commerciaux transport (distincts du coût interne fretPerKg)
      getRule('SEA_KMF_PER_KG_COMMERCIAL', 65),
      getRule('AIR_KMF_PER_KG_TAXABLE', 2500),
      getRule('AIR_VOLUMETRIC_DIVISOR', 6000),
    ]);
    const transportRates = {
      SEA_KMF_PER_KG_COMMERCIAL: seaKmfPerKgCommercial,
      AIR_KMF_PER_KG_TAXABLE: airKmfPerKgTaxable,
      AIR_VOLUMETRIC_DIVISOR: airVolumetricDivisor,
    };

    // ── Résolution des items : produit, SKU/legacy, stock, prix canonique,
    // claim shared_cart_item_id — cf. order-checkout-item-resolution.js.
    // Ce sous-service ne fait JAMAIS de ROLLBACK lui-même : sur échec, il
    // renvoie { ok:false, status, body } et c'est cet orchestrateur qui
    // exécute le ROLLBACK ci-dessous, comme avant l'extraction.
    const itemsResolved = await resolveCheckoutItems({
      client,
      items,
      maxQty,
      fretPerKg,
      aedFallback,
      customsPct,
      pickupCodeRecipient: pickup_code_recipient,
      userId: user.id,
    });
    if (!itemsResolved.ok) {
      await client.query('ROLLBACK');
      return fail(itemsResolved.status, itemsResolved.body);
    }
    const { productMap, cost_estimated, pickupCodeRecipientUserId } = itemsResolved;
    let total_kmf = itemsResolved.total_kmf;

    // ── Fulfillment mixte — Lots B/C/D ────────────────────────────────
    // Résolution serveur, sous la transaction orders déjà ouverte. Le owner
    // local-stock acquiert les FOR UPDATE dans un ordre déterministe et les
    // conserve jusqu'au COMMIT/ROLLBACK. Le frontend n'est jamais autorité.
    // Le verdict est ensuite persisté sur order_items (Lot C) et sert ici à
    // construire la seule collection éligible au transport import (Lot D).
    const fulfillmentSources = await resolveCheckoutFulfillmentSources(client, {
      marketId: relais?.market_id || null,
      demands: items.map(item => ({
        productId: item.product_id,
        quantity: parseInt(item.quantity, 10) || 1,
      })),
    });
    for (const item of items) {
      item._fulfillment_source =
        fulfillmentSources[item.product_id] || FULFILLMENT_SOURCE.IMPORT;
    }

    const importTransportItems = items.filter(
      item => item._fulfillment_source === FULFILLMENT_SOURCE.IMPORT
    );

    // §8 — devis transport commercial. Seules les lignes IMPORT sont
    // transmises au moteur : LOCAL_STOCK contribue exactement 0 au transport
    // international. `transport-pricing` reste volontairement ignorant de la
    // notion local-stock. Les coûts d'acquisition historiques déjà présents
    // dans cost_estimated restent inchangés : ce lot ne modifie que le prix
    // commercial du transport de cette commande.
    let transport_price_kmf = 0;
    try {
      const transportQuote = quoteTransportPriceForOrder({
        items: importTransportItems.map(item => {
          const product = productMap[item.product_id];
          return {
            product_id: item.product_id,
            requested_transport_rail: item.requested_transport_rail ?? null,
            weight_kg: product?.weight_kg,
            volume_cm3: product?.volume_cm3,
            quantity: item.quantity,
          };
        }),
        rates: transportRates,
      });
      transport_price_kmf = transportQuote.transport_price_kmf;
    } catch (e) {
      await client.query('ROLLBACK');
      if (e instanceof TransportPricingError) {
        return fail(409, { error: e.message, code: e.code });
      }
      throw e;
    }
    total_kmf += transport_price_kmf;

    const margin_est = total_kmf > 0
      ? ((total_kmf - cost_estimated) / total_kmf * 100).toFixed(2)
      : 0;

    let discountPct = 0;
    let discountKmf = 0;
    let loyaltyLabel = null;

    if (user?.id) {
      const ld = await getLoyaltyDiscount(db, user.id);
      discountPct = ld.discountPct || 0;
      loyaltyLabel = ld.discountLabel || null;
      discountKmf = Math.round(total_kmf * discountPct / 100);
      total_kmf = total_kmf - discountKmf;
    }
    let creditApplied = 0;

    if (use_wallet && user?.id) {
      const walletBalance = await walletService.getBalanceInTx(client, user.id);
      if (walletBalance > 0) {
        creditApplied = Math.min(walletBalance, total_kmf);
        total_kmf -= creditApplied;
      }
    }

    const cash_ref_code = payment_mode === 'cash_relais'
      ? generateCashCode()
      : null;

    const reference = await getUniqueRef(db);

    // ── P3 : snapshot du montant PRÉSENTÉ au client (freeze 22-08-2026) ──
    // Logique complète dans services/order-display-snapshot.js (extraite
    // pour rester testable indépendamment des ~15 services orchestrés
    // ici). Ne throw jamais, ne bloque jamais la création de commande.
    const displaySnapshot = await resolveDisplaySnapshot({
      totalKmf: total_kmf,
      displayMarketCode: display_market_code,
      relaisMarketId: relais?.market_id || null,
    });

    const order = await insertOrderRow(client, {
      reference, userId: user.id, recipientId: recipient_id, relaisId: relais?.id || null,
      trackingPhone: tracking_phone,
      totalKmf: total_kmf, totalEur: parseFloat((total_kmf / eurKmfFinal).toFixed(2)),
      paymentMode: payment_mode, stripePaymentIntent: stripe_payment_intent, cashRefCode: cash_ref_code,
      confectionType: confection_type, confectionInstructions: confection_instructions,
      confectionDelayDays: confection_delay_days, confectionArtisanId: confection_artisan_id,
      moduleType: module_type, moduleFabricId: module_fabric_id, moduleFabricType: module_fabric_type,
      moduleSize: module_size, moduleRetouche: module_retouche, moduleQtyMeters: module_qty_meters,
      moduleAccessories: module_accessories, orderOccasion: order_occasion,
      costEstimatedKmf: cost_estimated, marginEstimatedPct: margin_est,
      discountPct, discountKmf, loyaltyLabel,
      destinationIsland: routing.destination_island, routingMode: routing.routing_mode, transitHub: routing.transit_hub,
      transportPriceKmf: transport_price_kmf,
      pickupCodeRecipient: pickup_code_recipient, pickupCodeRecipientUserId,
      displayAmount: displaySnapshot.amount, displayCurrency: displaySnapshot.currency, displayMeta: displaySnapshot.meta,
      marketId: relais?.market_id || null,
    });

    await recordInitialHistory(client, order.id, user.id);

    if (creditApplied > 0) {
      await applyWalletDebit(client, {
        userId: user.id,
        amountKmf: creditApplied,
        orderId: order.id,
        orderReference: order.reference,
      });
    }

    await insertOrderItemsWithStock(client, { items, productMap, order, relais });

    // ── Wallet couvre 100% → cycle paiement complet (state machine + stock) ──
    // Sans cet appel : status reste 'pending', stock non décrémenté, machine contournée.
    let walletPickupCode = null;
    if (creditApplied > 0 && total_kmf === 0) {
      const walletCycle = await completeWalletFullPayment(client, { order, user, relais });
      if (!walletCycle.ok) {
        await client.query('ROLLBACK');
        return fail(walletCycle.status, walletCycle.body);
      }
      walletPickupCode = walletCycle.walletPickupCode;
    }

    await lockCostSnapshot(client, order);

    await client.query('COMMIT');

    runOrderPostCommitHooks({
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
    });

    return {
      ok: true,
      order,
      creditApplied,
      relais,
    };

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // no-op
    }
    // Boutique First (D2) — conflit de réclamation sur un article de liste
    // partagée : le premier paiement confirmé gagne, arbitré par l'index
    // unique order_items_shared_cart_item_id_unique (migration 123). Le
    // second appelant reçoit une erreur claire, jamais un état intermédiaire.
    if (err.code === '23505' && err.constraint === 'order_items_shared_cart_item_id_unique') {
      return fail(409, {
        error: 'Cet article de la liste vient déjà d\'être pris par quelqu\'un d\'autre.',
        code: 'shared_cart_item_already_claimed',
      });
    }
    // Fulfillment mixte — conflit résolu AVANT pricing/allocation si une lane
    // locale exposée ne peut plus tenir la quantité demandée. Le même code
    // protège aussi la revalidation d'allocation plus bas dans la transaction.
    if (err.code === 'local_stock_insufficient') {
      return fail(409, {
        error: 'Ce produit n\'est plus disponible en quantité suffisante localement.',
        code: 'local_stock_insufficient',
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runOrderCheckout };
