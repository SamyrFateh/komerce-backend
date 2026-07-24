/**
 * @komerce-arch
 * @role          orders-create
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*, services/product-admin-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, product_skus, product_variants, products, recipients, relais
 * @db-write      cart_shares, order_items, order_status_history, orders, recipients
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — POST /api/orders
 *
 * Créer une commande (client authentifié).
 */

const express = require('express');
const router  = express.Router();
const { randomUUID: uuidv4 } = require('crypto');
const db      = require('../../db');
const { authenticate }                   = require('../../middleware/auth');
const { authenticateOrCreateGuest }      = require('../../middleware/auth-guest');
// O7.3 (provider loyalty) : importait auparavant '../loyalty' (routes/loyalty.js,
// une route — pas une boundary de feature). Voir docs/O7_3_BOUNDARY_ANALYSIS.md.
const { getLoyaltyDiscount }             = require('../../services/loyalty-service');
const { getRule }                        = require('../../utils/rules');
const { appendOrderHistoryNote }         = require('../../services/order-status-machine');
const { getRates }                       = require('../../utils/rates');
const { validate }                       = require('../../middleware/validate');
const { orders }                         = require('../../validators');
const { getUniqueRef, generateCashCode, generatePickupCode } = require('../../services/order-service');
const walletService = require('../../services/wallet-service');
const { resolveRoutingFromRelais, RoutingError } = require('../../services/routing');
const { notifyOrderCreated }             = require('../../services/notification-service');
const productAdminService                = require('../../services/product-admin-service');
const log = require('../../utils/logger').child({ module: 'create' });

// MODULE_TYPES — sous-types pour le module couture uniquement
const MODULE_TYPES = ['ready_made', 'fabric_only', 'custom_from_fabric'];

router.post('/', authenticateOrCreateGuest, validate(orders.create), async (req, res, next) => {
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
      recipient_name,
      recipient_phone,
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
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'items[] obligatoire (tableau, min 1 article)' });
    }

    if (!['stripe_eur', 'cash_relais', 'paypal_eur'].includes(payment_mode)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'payment_mode invalide — valeurs : stripe_eur | cash_relais | paypal_eur' });
    }

    if (module_type && !MODULE_TYPES.includes(module_type)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `module_type invalide. Valeurs : ${MODULE_TYPES.join(', ')}` });
    }

    let relais = null;

    if (relais_id) {
      const { rows: [r] } = await client.query(
        'SELECT * FROM relais WHERE id = $1 AND is_active = TRUE',
        [relais_id]
      );
      if (!r) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Relais introuvable' });
      }
      relais = r;
    } else {
      const { rows: [r] } = await client.query(
        'SELECT * FROM relais WHERE is_active = TRUE ORDER BY id LIMIT 1'
      );
      relais = r;
    }

    let routing = { destination_island: null, routing_mode: null, transit_hub: null };

    if (relais) {
      try {
        routing = resolveRoutingFromRelais(relais);
      } catch (e) {
        if (e instanceof RoutingError) {
          await client.query('ROLLBACK');
          return res.status(e.statusCode || 400).json({ error: e.message, code: e.code });
        }
        throw e;
      }
    }

    let recipient_id = null;
    const rName  = recipient_name  || req.user.full_name;
    const rPhone = recipient_phone || req.user.phone;

    if (rName && rPhone) {
      const { rows: [existingRc] } = await client.query(
        'SELECT id FROM recipients WHERE user_id = $1 AND phone = $2 AND relais_id = $3 LIMIT 1',
        [req.user.id, rPhone, relais?.id || null]
      );

      if (existingRc) {
        recipient_id = existingRc.id;
      } else {
        const { rows: [newRc] } = await client.query(
          'INSERT INTO recipients (user_id, full_name, phone, relais_id, is_default) VALUES ($1,$2,$3,$4,FALSE) RETURNING id',
          [req.user.id, rName, rPhone, relais?.id || null]
        );
        recipient_id = newRc.id;
      }
    }

    const productIds = items.map(i => i.product_id);

    const { rows: products } = await client.query(
      'SELECT * FROM products WHERE id = ANY($1) AND is_active = TRUE FOR UPDATE',
      [productIds]
    );
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    const [maxQty, fretPerKg, aedFallback, customsPct, cashTimeout] = await Promise.all([
      getRule('MAX_QUANTITY_PER_ITEM', 100),
      getRule('FREIGHT_KMF_PER_KG', 65),
      getRule('AED_KMF_FALLBACK', 138),
      getRule('CUSTOMS_DEFAULT_PCT', 20),
      getRule('CASH_PAYMENT_TIMEOUT_HOURS', 36),
    ]);

    let total_kmf = 0;
    let cost_estimated = 0;

    for (const item of items) {
      if (!item.product_id || typeof item.product_id !== 'string') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'product_id invalide' });
      }

      const product = productMap[item.product_id];
      if (!product) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Produit introuvable : ${item.product_id}` });
      }

      const qty = parseInt(item.quantity, 10) || 1;

      if (qty < 1 || qty > maxQty) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Quantité invalide pour ${item.product_id}: min 1, max ${maxQty}` });
      }

      if (product.inventory_model === 'SKU') {
        // ── Lot 3 — chemin SKU exclusif ────────────────────────────────
        // Doctrine migration 104 : un produit en mode SKU ne lit/écrit
        // JAMAIS products.stock ni product_variants.stock. Le stock et la
        // disponibilité viennent uniquement de product_skus, résolu via
        // resolveActiveSku (services/product-admin-service.js).
        const comboRaw = (item.variant_combo && typeof item.variant_combo === 'object' && !Array.isArray(item.variant_combo))
          ? item.variant_combo
          : null;

        let resolvedSku;
        try {
          resolvedSku = await productAdminService.resolveActiveSku(client, item.product_id, comboRaw);
        } catch (e) {
          await client.query('ROLLBACK');
          return res.status(e.status || 400).json({ error: e.message });
        }

        if (!resolvedSku) {
          await client.query('ROLLBACK');
          const comboLabel = comboRaw
            ? ' : ' + Object.entries(comboRaw).map(([k, v]) => `${k}=${v}`).join(', ')
            : '';
          return res.status(409).json({
            error: `Combinaison indisponible pour ${product.name}${comboLabel}`,
          });
        }

        if (resolvedSku.stock < qty) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: `Stock insuffisant pour ${product.name} — disponible : ${resolvedSku.stock}`,
            available_stock: resolvedSku.stock,
          });
        }

        item.variant_combo = comboRaw;
        item._resolved_sku_id = resolvedSku.id;
      } else {
        // ── Chemin legacy (LEGACY_VARIANTS, défaut) — inchangé ──────────
        if (product.stock !== null && product.stock < qty) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: `Stock insuffisant pour ${product.name} — disponible : ${product.stock}`,
            available_stock: product.stock,
          });
        }

        // ── VAGUE 3 — Validation stock par variante ────────────────────────
        // Si l'item porte un variant_combo, on vérifie le stock de chaque
        // variante constituante. Le frontend ne devrait pas envoyer une combo
        // si le produit n'a pas has_variants=true, mais on protège quand même.
        if (item.variant_combo && typeof item.variant_combo === 'object' && !Array.isArray(item.variant_combo)) {
          if (!product.has_variants) {
            // Combo envoyée mais le produit n'a pas de variantes → on ignore
            // silencieusement (rétrocompat) plutôt que de planter une commande.
            item.variant_combo = null;
          } else {
            for (const [vType, vValue] of Object.entries(item.variant_combo)) {
              if (typeof vType !== 'string' || typeof vValue !== 'string') {
                await client.query('ROLLBACK');
                return res.status(400).json({
                  error: `variant_combo invalide pour ${item.product_id} : ${vType}=${vValue}`,
                });
              }
              const { rows: [variant] } = await client.query(
                `SELECT stock FROM product_variants
                  WHERE product_id = $1 AND variant_type = $2 AND variant_value = $3`,
                [item.product_id, vType, vValue]
              );
              if (!variant) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                  error: `Variante inconnue pour ${product.name} : ${vType}=${vValue}`,
                });
              }
              if (variant.stock !== null && variant.stock < qty) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                  error: `Stock insuffisant pour ${product.name} — ${vType}: ${vValue} — disponible : ${variant.stock}`,
                  available_stock: variant.stock,
                });
              }
            }
          }
        }
      }

      total_kmf += product.price_kmf * qty;

      const fret_kmf = (product.weight_kg || 0.5) * qty * fretPerKg;
      const base_aed_kmf = (product.price_aed || 0) * aedFallback * qty;
      const customs_est = base_aed_kmf * (customsPct / 100) * (product.customs_risk_coeff || 1.0);
      cost_estimated += base_aed_kmf + fret_kmf + customs_est;
    }

    const margin_est = total_kmf > 0
      ? ((total_kmf - cost_estimated) / total_kmf * 100).toFixed(2)
      : 0;

    let discountPct = 0;
    let discountKmf = 0;
    let loyaltyLabel = null;

    if (req.user?.id) {
      const ld = await getLoyaltyDiscount(db, req.user.id);
      discountPct = ld.discountPct || 0;
      loyaltyLabel = ld.discountLabel || null;
      discountKmf = Math.round(total_kmf * discountPct / 100);
      total_kmf = total_kmf - discountKmf;
    }

    let creditApplied = 0;

    if (use_wallet && req.user?.id) {
      const walletBalance = await walletService.getBalanceInTx(client, req.user.id);
      if (walletBalance > 0) {
        creditApplied = Math.min(walletBalance, total_kmf);
        total_kmf -= creditApplied;
      }
    }

    const cash_ref_code = payment_mode === 'cash_relais'
      ? generateCashCode()
      : null;

    const pickup_code = generatePickupCode();
    const reference = await getUniqueRef(db);

    const { rows: [order] } = await client.query(
     
  `INSERT INTO orders (
     id, reference, user_id, recipient_id, relais_id,
     tracking_phone,
     total_kmf, total_eur,
     payment_mode, payment_status, stripe_payment_id,
     cash_ref_code, pickup_code,
     status,
     confection_type, confection_instructions,
     confection_delay_days, confection_artisan_id,
     module_type, module_fabric_id, module_fabric_type,
     module_size, module_retouche, module_qty_meters, module_accessories,
     order_occasion,
     cost_estimated_kmf, margin_estimated_pct,
     discount_pct, discount_kmf, loyalty_label,
     destination_island, routing_mode, transit_hub
   ) VALUES (
     $1,$2,$3,$4,$5,
     $6,
     $7,$8,
     $9,$10,$11,
     $12,$13,
     'pending',
     $14,$15,
     $16,$17,
     $18,$19,$20,
     $21,$22,$23,$24,
     $25,
     $26,$27,
     $28,$29,$30,
     $31,$32,$33
   ) RETURNING *`,
  [
    uuidv4(), reference, req.user.id, recipient_id, relais?.id || null,
    tracking_phone || null,
    total_kmf, parseFloat((total_kmf / eurKmfFinal).toFixed(2)),
    payment_mode,
    // PATCH P2-4 : toujours créer en 'pending'. Si wallet couvre 100%,
    // confirmPaymentCycle (appelé plus bas) transite vers 'paid' via la machine.
    // L'ancien pre-write 'paid' ici contournait la machine et était redondant.
    'pending',
    stripe_payment_intent || null,
    cash_ref_code,
    pickup_code,
    confection_type,
    confection_instructions || null,
    confection_delay_days,
    confection_artisan_id || null,
    module_type || null,
    module_fabric_id || null,
    module_fabric_type || null,
    module_size || null,
    module_retouche,
    module_qty_meters || null,
    module_accessories ? JSON.stringify(module_accessories) : null,
    order_occasion || null,
    Math.round(cost_estimated),
    Number(margin_est),
    discountPct,
    discountKmf,
    loyaltyLabel,
    routing.destination_island,
    routing.routing_mode,
    routing.transit_hub,
  ]
);

    await appendOrderHistoryNote(client, order.id, 'pending',
      'Commande créée', req.user.id);

    if (creditApplied > 0) {
      await walletService.debit(client, {
        userId: req.user.id,
        amountKmf: creditApplied,
        reason: 'checkout',
        referenceId: order.id,
        idempotencyKey: `checkout_${order.id}`,
        note: `Wallet appliqué à commande ${order.reference}`,
      });

      await client.query(
        'UPDATE orders SET wallet_applied_kmf = $1 WHERE id = $2',
        [creditApplied, order.id]
      );
    }

    const { resolveFrozenClassification } = require('../../services/customs-classification');

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
           requested_transport_rail
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          order.id,
          item.product_id,
          qty,
          product.price_kmf,
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
        ]
      );
    }

    // ── Wallet couvre 100% → cycle paiement complet (state machine + stock) ──
    // Sans cet appel : status reste 'pending', stock non décrémenté, machine contournée.
    if (creditApplied > 0 && total_kmf === 0) {
      const { confirmPaymentCycle } = require('../../services/order-payment-confirmation');
      const cycleResult = await confirmPaymentCycle({
        orderId: order.id,
        actor:   { id: req.user.id, role: req.user.role || 'user' },
        source:  'wallet_full_payment',
        dbClient: client,
        note:    'Paiement intégral par wallet',
      });
      if (cycleResult.stockBlocked) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Stock insuffisant pour finaliser la commande',
          items: cycleResult.insufficientItems,
        });
      }
      // Rafraîchir order : status / confirmed_at à jour dans la réponse API
      const { rows: [refreshed] } = await client.query(
        'SELECT * FROM orders WHERE id = $1', [order.id]
      );
      if (refreshed) Object.assign(order, refreshed);
    }

    // ─── PHASE B — Snapshot economique fige (P3 doctrine) ────────────────
    // Appelle pricing-engine.recommend() sur chaque order_item et stocke
    // l'estime dans order_item_cost_imputations (immuable).
    // No-op si ORDER_COST_SNAPSHOT_ACTIVE != true (rollout progressif).
    // Idempotent (ON CONFLICT order_item_id DO NOTHING).
    try {
      const orderCostSnapshot = require('../../services/order-cost-snapshot');
      await orderCostSnapshot.lockEstimatedCostsForOrder(order.id, client, { source: 'pricing-engine' });
    } catch (snapErr) {
      // Non-bloquant : si le snapshot échoue, la commande est quand même créée.
      // L'erreur est loggée pour traitement admin (alerts table possible plus tard).
      log.error('[ORDER-CREATE] cost snapshot failed for', order.reference, snapErr.message);
    }

    await client.query('COMMIT');

    // ── Lier le partage à la commande si share_token présent (fire-and-forget) ──
    if (share_token) {
      db.query(
        `UPDATE cart_shares
         SET converted_order_id = $1,
             converted_at       = NOW()
         WHERE share_token = $2
           AND converted_order_id IS NULL`,
        [order.id, share_token]
      ).catch(e => log.error({ err: e }, '[SHARES] linkShareToOrder error:'));
    }

    // ── Notifications post-commit (multi-numéros) ──────────────────────────

const localPhone = rPhone || null;
const diasporaPhone = tracking_phone || req.user?.phone || null;
const smsPhones = [...new Set([localPhone, diasporaPhone].filter(Boolean))];

const userEmail = req.user?.email || req.body?.email || null;

let cashSmsText = null;
if (payment_mode === 'cash_relais') {
  const totalStr = Number(order.total_kmf).toLocaleString('fr-FR');
  cashSmsText = `Komerce : Commande ${reference} enregistree ! Rendez-vous au ${relais?.name || 'relais'} pour payer ${totalStr} KMF. Code : ${cash_ref_code}. Vous avez ${cashTimeout}h.`;
}

const emailItems = items.map(i => {
  const p = productMap[i.product_id] || {};
  const qty = parseInt(i.quantity, 10) || 1;
  return {
    name: p.name || 'Produit',
    qty,
    price_kmf: (p.price_kmf || 0) * qty,
  };
});


notifyOrderCreated(order, smsPhones, userEmail, emailItems, relais, cashSmsText)
  .catch(err => log.error({ err }, '[ORDER-CREATED] ❌'));

// LOY-01 — Hook fidélité gros panier (wallet full payment, fire-and-forget)
if (creditApplied > 0 && total_kmf === 0 && order.id) {
  try {
    const loyaltyService = require('../../services/loyalty-service');
    loyaltyService.handleOrderConfirmed({ orderId: order.id })
      .then(r => { if (r && !r.skipped) log.info({ orderId: order.id }, '[loyalty] wallet hook OK:', r); })
      .catch(e => log.warn({ err: e }, '[loyalty] wallet hook error:'));
  } catch (_) { /* non-bloquant */ }
}

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
        payment_mode: order.payment_mode,
        payment_status: order.payment_status,
        cash_ref_code: order.cash_ref_code,
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

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // no-op
    }
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;