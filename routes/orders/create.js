'use strict';

/**
 * KOMERCE — POST /api/orders
 *
 * Créer une commande (client authentifié).
 */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const db      = require('../../db');
const { authenticate }                   = require('../../middleware/auth');
const { authenticateOrCreateGuest }      = require('../../middleware/auth-guest');
const { getLoyaltyDiscount }             = require('../loyalty');
const { getRule }                        = require('../../utils/rules');
const { getRates }                       = require('../../utils/rates');
const { validate }                       = require('../../middleware/validate');
const { orders }                         = require('../../validators');
const { getUniqueRef, generateCashCode, generatePickupCode } = require('../../services/order-service');
const walletService = require('../../services/wallet-service');
const { resolveRoutingFromRelais, RoutingError } = require('../../services/routing');
const { notifyOrderCreated }             = require('../../services/notification-service');

// MODULE_TYPES — sous-types pour le module couture uniquement
const MODULE_TYPES = ['ready_made', 'fabric_only', 'custom_from_fabric'];

router.post('/', authenticateOrCreateGuest, validate(orders.create), async (req, res, next) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const rates = await getRates();
    const eurKmf = rates?.eur_kmf || 492;

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

    if (!['stripe_eur', 'cash_relais'].includes(payment_mode)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'payment_mode invalide — valeurs : stripe_eur | cash_relais' });
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

      if (product.stock !== null && product.stock < qty) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Stock insuffisant pour ${product.name} — disponible : ${product.stock}`,
          available_stock: product.stock,
        });
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
    total_kmf, parseFloat((total_kmf / eurKmf).toFixed(2)),
    payment_mode,
    creditApplied > 0 && total_kmf === 0 ? 'paid' : 'pending',
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

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'pending', 'Commande créée', $2)`,
      [order.id, req.user.id]
    );

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

    for (const item of items) {
      const product = productMap[item.product_id];
      const qty = parseInt(item.quantity, 10) || 1;

      await client.query(
        `INSERT INTO order_items (
           order_id, product_id, quantity, price_kmf,
           module_type, module_fabric_id, module_fabric_type,
           module_size, module_retouche, module_qty_meters, module_accessories
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
        ]
      );
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
      console.error('[ORDER-CREATE] cost snapshot failed for', order.reference, snapErr.message);
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
      ).catch(e => console.error('[SHARES] linkShareToOrder error:', e.message));
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

console.log('[DEBUG][ORDER-CREATED] localPhone =', localPhone);
console.log('[DEBUG][ORDER-CREATED] diasporaPhone =', diasporaPhone);
console.log('[DEBUG][ORDER-CREATED] tracking_phone =', tracking_phone);
console.log('[DEBUG][ORDER-CREATED] smsPhones =', smsPhones);
console.log('[DEBUG][ORDER-CREATED] req.user.id =', req.user?.id);
console.log('[DEBUG][ORDER-CREATED] req.user.phone =', req.user?.phone);
console.log('[DEBUG][ORDER-CREATED] recipient_phone =', recipient_phone);
console.log('[DEBUG][ORDER-SAVED] order.tracking_phone =', order.tracking_phone);


notifyOrderCreated(order, smsPhones, userEmail, emailItems, relais, cashSmsText)
  .catch(err => console.error('[ORDER-CREATED] ❌', err.message));

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