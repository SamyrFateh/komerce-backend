/**
 * @komerce-arch
 * @role          orders-checkout-orchestrator
 * @domain        orders
 * @layer         service
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/market-transport-sale-rates.js, services/order-fx-snapshot.js, db.js, services/cart-share-service.js,
 *                services/order-post-commit-hooks.js, services/order-checkout-item-resolution.js,
 *                services/order-checkout-persistence.js, services/local-stock-service.js,
 *                services/market-local-price-resolution-service.js
 * @used-by       routes/orders/create.js
 * @db-read       market_transport_sale_rates, orders, product_skus, product_variants, products, recipients, relais, markets, shared_cart_items, shared_carts
 * @db-write      order_items, order_status_history, orders, recipients
 * @doctrine-note cart_shares n'est plus écrit ici directement (campagne WRITER-NOT-OWNER
 *                2026-08) — voir services/cart-share-service.js markShareConvertedToOrder
 * @db-txn        owns_full_transaction
 * @doctrine      docs/doctrine/DOCTRINE_FULFILLMENT_MIXTE.md, explicit_relay_market_anchor, resolve_before_behavior_change, only_LOCAL_ACTIVE_is_buyer_effective
 * @impact-areas  orders, checkout, shared-cart, local-stock, market-autonomy
 * @version       2026-09 (LOCAL_STOCK/IMPORT + market-local commercial price cutover)
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
 * le relais explicite est l'ancre serveur du market_id, du routing, du prix
 * commercial LOCAL_ACTIVE et du verdict LOCAL_STOCK/IMPORT.
 *
 * Résultat renvoyé à l'appelant (jamais de res.status/res.json ici) :
 *   { ok: true, order, creditApplied, relais }
 *   { ok: false, status, body }
 *   throws sur erreur inattendue.
 */

const db      = require('../db');
const { assignOrderSimulationScope } = require('./simulation-scope-service');
const {verifyMarkedG6Buyer}=require('./g6-staging-buyer-identity-guard');
const { reserveRct1OrderReference, expectedProductTotalKmf, isAllowedRct1Reference } = require('./rct1-checkout-reference-guard');
const { reserveHubFixtureReference, isAllowedHubFixtureReference, assertHubFixtureOwnership } = require('./hub-v1-fixture-checkout-guard');
const { getLoyaltyDiscount }             = require('./loyalty-service');
const { getRates } = require('../utils/rates');
const { getRule }                        = require('../utils/rules');
const { getUniqueRef, generateCashCode } = require('./order-service');
const walletService = require('./wallet-service');
const { resolveRoutingFromRelais, RoutingError } = require('./routing');
const { resolveOrderItemTransportRail, TransportPricingError } = require('./transport-pricing');
const { resolveDisplaySnapshot } = require('./order-display-snapshot');
const { runOrderPostCommitHooks } = require('./order-post-commit-hooks');
const { claimCheckout, completeCheckout } = require('./order-checkout-idempotency');
const { resolveCheckoutItems } = require('./order-checkout-item-resolution');
const { applyActiveMarketPricesToCheckoutItems } = require('./market-local-price-resolution-service');
const { MarketCommercialPriceError } = require('./market-commercial-price-service');
const { assertCentralCollectionAllowed } = require('./market-payment-collection-gate');
const { buildOrderFxSnapshot } = require('./order-fx-snapshot');
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

// previewOnly : même calcul que la création (prix, transport, remise, wallet) puis ROLLBACK avant toute écriture
// de commande — source unique du total présenté au client (aucun recalcul côté navigateur).
async function runOrderCheckout({ user, body, internalSimulation = null, previewOnly = false, idempotencyKey = null }) {
  // Paramètre serveur uniquement : routes/orders/create.js ne transmet jamais ce contexte.
  // Validation avant tout accès DB ; un payload client simulation_scope n'est jamais lu.
  const hubFixture = internalSimulation !== null && internalSimulation.scope === 'E2E-HUB-V1';
  if (internalSimulation !== null) {
    if (process.env.KOMERCE_ENV !== 'staging' ||
        (internalSimulation.scope !== 'RCT1' && internalSimulation.scope !== 'E2E-HUB-V1') ||
        !internalSimulation.actorId || !internalSimulation.reason ||
        typeof internalSimulation.reason !== 'string' ||
        (internalSimulation.scope === 'RCT1' && !isAllowedRct1Reference(internalSimulation.reference)) ||
        (hubFixture && (!isAllowedHubFixtureReference(internalSimulation.reference) ||
          !Number.isSafeInteger(internalSimulation.expectedProductTotalKmf) ||
          internalSimulation.expectedProductTotalKmf <= 0))) {
      const code = hubFixture ? 'HUB_V1_INTERNAL_CHECKOUT_FORBIDDEN' : 'RCT1_INTERNAL_CHECKOUT_FORBIDDEN';
      throw Object.assign(new Error(code), { code });
    }
  }
  // FA-03 : ne jamais persister une référence Stripe issue du navigateur,
  // y compris via un appel service direct qui contournerait le validateur HTTP.
  // Le PaymentIntent est créé/rattaché uniquement par payment-stripe.js avec
  // metadata.order_id et contrat montant/devise vérifiés.
  if (Object.prototype.hasOwnProperty.call(body || {}, 'stripe_payment_intent')) {
    return fail(400, {
      code: 'STRIPE_INTENT_CLIENT_FORBIDDEN',
      error: 'La référence Stripe est exclusivement attribuée par le serveur.',
    });
  }
  // FA-22 : toute création réelle exige une clé anti-doublon (le rejeu d'un même
  // payload renvoie la commande initiale, un payload divergent est refusé 409).
  // Les aperçus et les fixtures de recette internes ont leur propre garde.
  if (!previewOnly && !internalSimulation && !idempotencyKey) {
    throw Object.assign(new Error('Clé anti-doublon (Idempotency-Key) obligatoire pour créer une commande.'),
      { code: 'idempotency_key_required', status: 400 });
  }
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Rejoindre l'ordre existant AVANT tout calcul, wallet ou allocation.
    // L'unicité (user_id, key) arbitre les requêtes concurrentes au niveau PG.
    // Les fixtures de recette ont leur propre verrou de référence.
    const checkoutClaim = (!previewOnly && !internalSimulation && idempotencyKey)
      ? await claimCheckout(client, { userId: user.id, key: idempotencyKey, body })
      : null;
    if (checkoutClaim?.replayed) {
      await client.query('ROLLBACK');
      return { ok: true, ...checkoutClaim.snapshot, replayed: true };
    }

    if (internalSimulation) {
      // Verrou transactionnel + controle du scope, avant toute autre ecriture.
      const reservation = hubFixture
        ? await reserveHubFixtureReference(client, internalSimulation.reference)
        : await reserveRct1OrderReference(client, internalSimulation.reference);
      if (hubFixture) {
        // Buyer, produits et relais dédiés ; aucune commande commerciale réelle.
        await assertHubFixtureOwnership(client, {
          reference: internalSimulation.reference, actorId: internalSimulation.actorId,
          user, body,
        });
      }
      if (reservation.already) {
        await client.query('ROLLBACK');
        return fail(409, { code: hubFixture ? 'HUB_V1_ORDER_ALREADY_EXISTS' : 'RCT1_ORDER_ALREADY_EXISTS',
          reference: internalSimulation.reference,
          error: hubFixture ? 'Commande de recette Hub V1 deja creee' : 'Commande RCT1 deja creee : utiliser la reference existante' });
      }
    }

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

    // Owner-provisioned G6 browser identities are explicitly marked in DB,
    // and only in staging. Set their simulation scope in the SAME checkout
    // transaction, so no post-commit notification can run.
    const g6Buyer=await verifyMarkedG6Buyer(client,user);
    if (g6Buyer && (payment_mode!=='cash_relais'||use_wallet||
        stripe_payment_intent||share_token||pickup_code_recipient!=='buyer'||
        !Array.isArray(items)||items.length!==1||Number(items[0]?.quantity)!==1||
        (tracking_phone && tracking_phone!==user.phone))) {
      await client.query('ROLLBACK');
      return fail(409,{code:'G6_FIXTURE_CASH_SINGLE_PRODUCT_ONLY',
        error:'Ce client de recette est réservé à une commande cash unitaire sans prestataire externe'});
    }

    if (!Array.isArray(items) || items.length === 0) {
      await client.query('ROLLBACK');
      return fail(400, { error: 'items[] obligatoire (tableau, min 1 article)' });
    }

    if (!['stripe_eur', 'cash_relais', 'paypal_eur', 'mobile_money'].includes(payment_mode)) {
      await client.query('ROLLBACK');
      return fail(400, { error: 'payment_mode invalide — valeurs : stripe_eur | cash_relais | paypal_eur | mobile_money' });
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

    const { rows: [checkoutMarket] } = await client.query(
      'SELECT lifecycle_status, code, currency FROM markets WHERE id=$1::uuid LIMIT 1',
      [relais.market_id]
    );
    if (!checkoutMarket || checkoutMarket.lifecycle_status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      if (checkoutMarket && checkoutMarket.lifecycle_status === 'SUSPENDED') {
        return fail(409, {
          error: 'Ce marché est temporairement suspendu.',
          code: 'MARKET_SUSPENDED',
        });
      }
      return fail(409, {
        error: 'Ce marché n’est pas ouvert aux commandes.',
        code: 'MARKET_NOT_ACTIVE',
      });
    }

    // Livraison au relais : l'existence du relais actif rattaché au marché
    // ouvert est la condition métier. Une attestation de transporteur ou
    // un historique de livraison ne sont PAS requis pour le checkout.
    // Les vérifications ci-dessus sont identiques en recette et production.

    // Moyen d'encaissement central (Stripe/PayPal EUR) : autorisé explicitement par marché, sinon refus.
    // Doctrine « le Market encaisse » : aucun encaissement sur le compte central par défaut.
    try {
      await assertCentralCollectionAllowed(client, relais.market_id, payment_mode);
    } catch (e) {
      if (e && e.code === 'PAYMENT_MODE_NOT_ALLOWED_FOR_MARKET') {
        await client.query('ROLLBACK');
        return fail(409, { error: e.message, code: e.code });
      }
      throw e;
    }

    let routing = { destination_island: null, routing_mode: null, transit_hub: null };

    try {
      routing = resolveRoutingFromRelais(relais, { marketCode: checkoutMarket.code });
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
      maxQty, fretPerKg, customsPct, cashTimeout,
    ] = await Promise.all([
      getRule('MAX_QUANTITY_PER_ITEM', 100),
      getRule('FREIGHT_KMF_PER_KG', 65),
      getRule('CUSTOMS_DEFAULT_PCT', 20),
      getRule('CASH_PAYMENT_TIMEOUT_HOURS', 36),
    ]);

    // ── Résolution des items : produit, SKU/legacy, stock, prix canonique,
    // claim shared_cart_item_id — cf. order-checkout-item-resolution.js.
    // Ce sous-service ne fait JAMAIS de ROLLBACK lui-même : sur échec, il
    // renvoie { ok:false, status, body } et c'est cet orchestrateur qui
    // exécute le ROLLBACK ci-dessous, comme avant l'extraction.
    // Taux AED→KMF de l'autorité FX (estimation de coût uniquement) : absent = estimation inconnue, pas de repli 138.
    let aedKmf = null;
    try { aedKmf = (await getRates()).toJSON().aed_kmf; } catch (_) { aedKmf = null; }
    const itemsResolved = await resolveCheckoutItems({
      client,
      items,
      maxQty,
      fretPerKg,
      aedKmf,
      customsPct,
      pickupCodeRecipient: pickup_code_recipient,
      userId: user.id,
    });
    if (!itemsResolved.ok) {
      await client.query('ROLLBACK');
      return fail(itemsResolved.status, itemsResolved.body);
    }
    const { productMap, cost_estimated, pickupCodeRecipientUserId } = itemsResolved;

    // Prix pays : uniquement LOCAL_ACTIVE et uniquement depuis market_id du
    // relais résolu côté serveur. Cette boundary recalcule aussi le total à
    // partir des prix effectifs (global/SKU quand aucun override, local actif
    // sinon) avant transport, fidélité, wallet et snapshot order_items.
    let marketPricing;
    try {
      marketPricing = await applyActiveMarketPricesToCheckoutItems(client, {
        marketId: relais?.market_id || null,
        items,
        productMap,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      if (e instanceof MarketCommercialPriceError) {
        // Sans ce catch, l'erreur (ex: 409 market_price_not_purchasable)
        // remonte au error-handler générique, qui ne reconnaît pas les codes
        // métier hors Postgres et la reclasse en 'unknown' — le client perd
        // le code et reçoit "Erreur interne du serveur" pour un refus légitime.
        return fail(e.status || 409, { error: e.message, code: e.code });
      }
      throw e;
    }
    let total_kmf = marketPricing.total_kmf;

    // ── Fulfillment mixte — Lots B/C/D ────────────────────────────────
    // Résolution serveur, sous la transaction orders déjà ouverte. Le owner
    // local-stock acquiert les FOR UPDATE dans un ordre déterministe et les
    // conserve jusqu'au COMMIT/ROLLBACK. Le frontend n'est jamais autorité.
    // Le verdict est ensuite persisté sur order_items (Lot C).
    // Aucun supplément transport commercial sur le maritime (#3936).
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

    // Décision propriétaire #3936 : maritime inclus dans les prix catalogue,
    // donc aucun supplément transport n'est ajouté au client, y compris pour
    // les lignes IMPORT. Les coûts internes fret/douane restent inchangés.
    // La validation du rail reste stricte : AIR_EXPRESS non commercialisable
    // ne doit jamais devenir une option autorisée par ce prix à zéro.
    const transport_price_kmf = 0;
    const transportPricingSnapshot = null;
    try {
      for (const item of items) {
        if (item.requested_transport_rail || item._fulfillment_source === FULFILLMENT_SOURCE.IMPORT) {
          resolveOrderItemTransportRail(item.requested_transport_rail ?? null);
        }
      }
    } catch (e) {
      await client.query('ROLLBACK');
      if (e instanceof TransportPricingError) {
        return fail(409, { error: e.message, code: e.code });
      }
      throw e;
    }

    const margin_est = cost_estimated == null ? null : (total_kmf > 0
      ? ((total_kmf - cost_estimated) / total_kmf * 100).toFixed(2)
      : 0);

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

    // Wallet : seul le solde dans la devise du marché règle la commande (KMF → KMF, XAF → XAF).
    // Débit en devise du marché ; équivalent KMF (reste à payer) par fx-authority ; aucune conversion entre soldes.
    let walletPlan = null;
    if (use_wallet && user?.id) {
      const marketCcy = String(checkoutMarket?.currency || 'KMF').toUpperCase();
      try {
        if (marketCcy === 'KMF') {
          const walletBalance = await walletService.getBalanceInTx(client, user.id, 'KMF');
          const spend = Math.min(walletBalance, total_kmf);
          walletPlan = { currency: 'KMF', debit: spend, equivKmf: spend };
        } else {
          walletPlan = await walletService.planWalletSpend(client, {
            userId: user.id, currency: marketCcy, remainingKmf: total_kmf,
          });
        }
      } catch (err) {
        if (err.code !== 'WALLET_FX_PARITY_UNAVAILABLE') throw err;
        await client.query('ROLLBACK');
        return fail(409, { error: err.message, code: err.code });
      }
      if (walletPlan.debit > 0) {
        creditApplied = walletPlan.equivKmf;
        total_kmf -= creditApplied;
      }
    }

    if (previewOnly) {
      // Même prix/SKU, exposition marché, quantité et transport que la commande,
      // mais aucun événement métier : toutes les écritures sont annulées.
      // Les libellés/variantes des documents doivent provenir du serveur.
      const previewItems = items.map(item => {
        const product = productMap[item.product_id];
        const qty = Number(item.quantity);
        const unit = Number(item._effective_unit_price_kmf);
        return {
          product_id: item.product_id,
          product_name: product?.name || product?.name_fr || 'Produit',
          quantity: qty,
          variant_combo: item.variant_combo || null,
          requested_transport_rail: item.requested_transport_rail || null,
          unit_price_kmf: unit,
          line_total_kmf: unit * qty,
        };
      });
      await client.query('ROLLBACK');
      return {
        ok: true,
        preview: {
          items: previewItems,
          relais_name: relais.name,
          market_code: checkoutMarket.code,
          items_total_kmf: marketPricing.total_kmf,
          transport_price_kmf,
          discount_pct: discountPct,
          discount_kmf: discountKmf,
          credit_applied_kmf: creditApplied,
          total_kmf,
        },
      };
    }

    // Le prix annoncé par le devis serveur doit être explicitement accepté.
    // Montant AVANT débit wallet (mais APRES remise) pour ne pas forcer le client
    // à accepter un nouveau prix lorsque seul son solde wallet a changé.
    // Jamais de création silencieuse au nouveau prix (L3/N06) : la clé étant obligatoire (FA-22),
    // tout appelant réel doit porter le total accepté, issu de l'aperçu (POST /api/orders/preview).
    const expectedTotal = body.expected_total_kmf;
    if (!internalSimulation && checkoutClaim && expectedTotal == null) {
      await client.query('ROLLBACK');
      return fail(428, { code: 'price_confirmation_required',
        error: 'Actualisez le récapitulatif et confirmez le total avant de commander.' });
    }
    if (!internalSimulation && expectedTotal != null &&
        (!Number.isSafeInteger(Number(expectedTotal)) ||
          Number(expectedTotal) !== Number(total_kmf) + Number(creditApplied))) {
      await client.query('ROLLBACK');
      return fail(409, { code: 'price_changed',
        error: 'Le prix a changé. Consultez le nouveau total et confirmez à nouveau.',
        expected_total_kmf: Number(expectedTotal),
        current_total_kmf: Number(total_kmf) + Number(creditApplied) });
    }

    // RCT1 : ni remise ni crédit ; prix produit sans supplément maritime,
    // coûts internes fret/douane distincts. Échec = rollback avant insertion.
    if (internalSimulation) {
      const expectedProductTotal = hubFixture
        ? internalSimulation.expectedProductTotalKmf
        : expectedProductTotalKmf(internalSimulation.reference);
      if (payment_mode !== 'cash_relais' || Number(total_kmf) - Number(transport_price_kmf) !== expectedProductTotal ||
          Number(discountKmf) !== 0 || Number(creditApplied) !== 0) {
        await client.query('ROLLBACK');
        return fail(409, { code: hubFixture ? 'HUB_V1_CHECKOUT_TOTAL_MISMATCH' : 'RCT1_CHECKOUT_TOTAL_MISMATCH',
          expected_product_total_kmf: expectedProductTotal,
          observed_total_kmf: total_kmf, transport_price_kmf });
      }
    }

    const cash_ref_code = payment_mode === 'cash_relais'
      ? generateCashCode()
      : null;

    const reference = internalSimulation ? internalSimulation.reference : await getUniqueRef(db);

    // ── P3 : snapshot du montant PRÉSENTÉ au client (freeze 22-08-2026) ──
    // Logique complète dans services/order-display-snapshot.js (extraite
    // pour rester testable indépendamment des ~15 services orchestrés
    // ici). Ne throw jamais, ne bloque jamais la création de commande.
    const displaySnapshot = await resolveDisplaySnapshot({
      totalKmf: total_kmf,
      displayMarketCode: display_market_code,
      relaisMarketId: relais?.market_id || null,
    });

    // Une seule vérité monétaire de transaction : montant EUR autorisé, montant confirmé en devise du marché du
    // relais (serveur) et jambes de taux, figés ici ; paiements et remboursements les lisent, sans reconversion.
    // Aucun taux approuvé = refus 503 fx_rate_unavailable (jamais de repli).
    let fxSnapshotBuilt;
    try {
      fxSnapshotBuilt = await buildOrderFxSnapshot({
        totalKmf: total_kmf, marketId: relais?.market_id || null, marketCurrency: checkoutMarket.currency, client,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      if (e && e.code === 'fx_rate_unavailable') return fail(503, { error: e.message, code: e.code });
      if (e && (e.code === 'fx_currency_unsupported' || e.code === 'ORDER_MARKET_CURRENCY_MISSING')) {
        return fail(409, { error: e.message, code: e.code });
      }
      throw e;
    }

    const order = await insertOrderRow(client, {
      reference, userId: user.id, recipientId: recipient_id, relaisId: relais?.id || null,
      trackingPhone: tracking_phone,
      totalKmf: total_kmf, totalEur: fxSnapshotBuilt.totalEur,
      paymentMode: payment_mode, stripePaymentIntent: null, cashRefCode: cash_ref_code,
      confectionType: confection_type, confectionInstructions: confection_instructions,
      confectionDelayDays: confection_delay_days, confectionArtisanId: confection_artisan_id,
      moduleType: module_type, moduleFabricId: module_fabric_id, moduleFabricType: module_fabric_type,
      moduleSize: module_size, moduleRetouche: module_retouche, moduleQtyMeters: module_qty_meters,
      moduleAccessories: module_accessories, orderOccasion: order_occasion,
      costEstimatedKmf: cost_estimated, marginEstimatedPct: margin_est,
      discountPct, discountKmf, loyaltyLabel,
      destinationIsland: routing.destination_island, routingMode: routing.routing_mode, transitHub: routing.transit_hub,
      transportPriceKmf: transport_price_kmf, transportPricingSnapshot, fxSnapshot: fxSnapshotBuilt.snapshot,
      pickupCodeRecipient: pickup_code_recipient, pickupCodeRecipientUserId,
      displayAmount: displaySnapshot.amount, displayCurrency: displaySnapshot.currency, displayMeta: displaySnapshot.meta,
      marketId: relais?.market_id || null,
    });

    // Dans la MEME transaction que la naissance de la commande : aucune
    // fenêtre de visibilité comme activité réelle avant le COMMIT.
    if (internalSimulation !== null) {
      await assignOrderSimulationScope(client, {
        orderId: order.id, scope: internalSimulation.scope, actorId: internalSimulation.actorId,
        reason: internalSimulation.reason, env: { KOMERCE_ENV: 'staging' },
      });
      order.simulation_scope = internalSimulation.scope;
    } else if (g6Buyer) {
      await assignOrderSimulationScope(client, {
        orderId:order.id,scope:'G6-BUYER',actorId:user.id,
        reason:'G6 staged Chromium owner-provisioned test customer; no external side effects',
        env:{KOMERCE_ENV:'staging'},
      });
      order.simulation_scope='G6-BUYER';
    }
    await recordInitialHistory(client, order.id, user.id);

    if (creditApplied > 0) {
      await applyWalletDebit(client, {
        userId: user.id,
        amountKmf: creditApplied,
        walletDebit: walletPlan.debit,
        walletCurrency: walletPlan.currency,
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
    // Snapshot strictement atomique avec la commande, son wallet et son stock.
    if (checkoutClaim) await completeCheckout(client, checkoutClaim, { order, creditApplied, relais });

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
    if (err && typeof err.code === 'string' && err.code.startsWith('idempotency_')) {
      return fail(err.status || 409, { code: err.code, error: err.message });
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
