/**
 * KOMERCE — POST /api/orders
 *
 * Créer une commande (client authentifié).
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const db      = require('../../db');
const { authenticate }                   = require('../../middleware/auth');
const { getLoyaltyDiscount }             = require('../loyalty');
const { getRule }                        = require('../../utils/rules');
const { getRates }                       = require('../../utils/rates');
const { validate }                       = require('../../middleware/validate');
const { orders }                         = require('../../validators');
const { getUniqueRef, generateCashCode, generatePickupCode } = require('../../services/order-service');
const walletService = require('../../services/wallet-service');
const { notifyOrderCreated }             = require('../../services/notification-service');

// MODULE_TYPES — sous-types pour le module couture uniquement
const MODULE_TYPES = ['ready_made', 'fabric_only', 'custom_from_fabric'];

// ─── POST /api/orders ─────────────────────────────────────────────────────────
// Corps attendu :
//   items[]              → [{ product_id, quantity, module_type?,
//                             module_fabric_id?, module_fabric_type?,
//                             module_size?, module_retouche?,
//                             module_qty_meters?, module_accessories? }]
//   relais_id            → UUID relais de livraison
//   payment_mode         → 'stripe_eur' | 'cash_relais'
//   recipient_name       → nom du destinataire
//   recipient_phone      → téléphone du destinataire
//   confection_type      → 'aucun' | 'couture_standard' | 'sur_mesure' | 'retouche_locale' | 'broderie' | 'lunettes_vue' | 'lunettes_solaires'
//   confection_instructions, confection_delay_days, confection_artisan_id
//   module_type  → si commande cérémonie globale
//   module_*     → autres champs module au niveau commande

router.post('/', authenticate, validate(orders.create), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Taux de change actuels — utilisés pour total_eur et cost_estimated
    const rates  = await getRates();
    // BUG-002 fix: fallback si getRates() échoue ou retourne 0/null
    const eurKmf = rates?.eur_kmf || 492;

    const {
      items                 = [],
      relais_id,
      payment_mode,
      stripe_payment_intent,
      recipient_name,
      recipient_phone,
      // Module spécialisé niveau commande
      confection_type           = 'aucun',
      confection_instructions,
      confection_delay_days     = 0,
      confection_artisan_id,
      // Module spécialisé niveau commande (optionnel — sinon porté par items)
      module_type,
      module_fabric_id,
      module_fabric_type,
      module_size,
      module_retouche         = false,
      module_qty_meters,
      module_accessories,
      // Spec §11 : capturer dès MVP pour fidélisation Phase 2
      // Valeurs : mariage · cadeau · personnel · construction · rentree · ramadan · aid · autre
      order_occasion        = null,
    } = req.body;

    // ── Validation ──────────────────────────────────────────────────────────
    // BUG-009 fix: validation Array.isArray pour éviter crash sur input malformé
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items[] obligatoire (tableau, min 1 article)' });
    }
    if (!['stripe_eur', 'cash_relais'].includes(payment_mode)) {
      return res.status(400).json({ error: 'payment_mode invalide — valeurs : stripe_eur | cash_relais' });
    }
    if (module_type && !MODULE_TYPES.includes(module_type)) {
      return res.status(400).json({ error: `module_type invalide. Valeurs : ${MODULE_TYPES.join(', ')}` });
    }

    // ── Résoudre relais ─────────────────────────────────────────────────────
    let relais = null;
    if (relais_id) {
      const { rows: [r] } = await client.query(
        'SELECT * FROM relais WHERE id = $1 AND is_active = TRUE', [relais_id]
      );
      if (!r) return res.status(404).json({ error: 'Relais introuvable' });
      relais = r;
    } else {
      const { rows: [r] } = await client.query(
        'SELECT * FROM relais WHERE is_active = TRUE ORDER BY id LIMIT 1'
      );
      relais = r;
    }

    // ── Créer ou réutiliser le recipient ────────────────────────────────────
    let recipient_id = null;
    const rName  = recipient_name  || req.user.full_name;
    const rPhone = recipient_phone || req.user.phone;
    if (rName && rPhone) {
      // Chercher un recipient existant pour cet utilisateur + relais
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

    // ── Charger les produits en une seule requête ───────────────────────────
    const productIds = items.map(i => i.product_id);
    // BUG-008 fix: FOR UPDATE pour verrouiller les lignes et empêcher la survente
    const { rows: products } = await client.query(
      'SELECT * FROM products WHERE id = ANY($1) AND is_active = TRUE FOR UPDATE',
      [productIds]
    );
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    // ── Charger toutes les règles métier en parallèle (Tâche 6 — optimisation) ──
    const [maxQty, fretPerKg, aedFallback, customsPct, cashTimeout] = await Promise.all([
      getRule('MAX_QUANTITY_PER_ITEM', 100),
      getRule('FREIGHT_KMF_PER_KG', 65),
      getRule('AED_KMF_FALLBACK', 138),
      getRule('CUSTOMS_DEFAULT_PCT', 20),
      getRule('CASH_PAYMENT_TIMEOUT_HOURS', 36),
    ]);

    // ── Vérifier stock + calculer totaux ────────────────────────────────────
    let total_kmf      = 0;
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
      const qty = parseInt(item.quantity) || 1;
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

      // Estimation coût : sourcing + fret + douane estimée
      const fret_kmf     = (product.weight_kg || 0.5) * qty * fretPerKg;
      const base_aed_kmf = (product.price_aed || 0) * aedFallback * qty;
      const customs_est  = base_aed_kmf * (customsPct / 100) * (product.customs_risk_coeff || 1.0);
      cost_estimated    += base_aed_kmf + fret_kmf + customs_est;
    }

    const margin_est = total_kmf > 0
      ? ((total_kmf - cost_estimated) / total_kmf * 100).toFixed(2)
      : 0;

    // ── Loyalty : récupérer le rabais du client connecté ──────────────────
    let discountPct   = 0;
    let discountKmf   = 0;
    let loyaltyLabel  = null;
    if (req.user?.id) {
      const ld      = await getLoyaltyDiscount(db, req.user.id);
      discountPct   = ld.discountPct  || 0;
      loyaltyLabel  = ld.discountLabel || null;
      discountKmf   = Math.round(total_kmf * discountPct / 100);
      total_kmf     = total_kmf - discountKmf;
    }

    // ── Wallet — appliquer si solde disponible ─────────────────────────────
    let creditApplied = 0;
    if (req.user?.id) {
      const walletBalance = await walletService.getBalanceInTx(client, req.user.id);
      if (walletBalance > 0) {
        creditApplied = Math.min(walletBalance, total_kmf);
        total_kmf    -= creditApplied;
        // Débit wallet effectif après INSERT order (besoin de order.id)
      }
    }

    // ── Code cash 6 chiffres (v7.7) — lisible oralement ─────────────────────
    // Ex: "482917" au lieu de "0c92c35b321fb02b"
    // Le client dicte le code à l'agent relais en 3 secondes.
    const cash_ref_code = payment_mode === 'cash_relais'
      ? generateCashCode()
      : null;

    // Code de retrait 6 caractères alphanumériques (crypto)
    const pickup_code = generatePickupCode();

    const reference = await getUniqueRef(db);

    const { rows: [order] } = await client.query(
      `INSERT INTO orders (
         id, reference, user_id, recipient_id, relais_id,
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
         discount_pct, discount_kmf, loyalty_label
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,
         $8,$9,$10,
         $11,$12,
         'confirmed',
         $13,$14,
         $15,$16,
         $17,$18,$19,
         $20,$21,$22,$23,
         $24,
         $25,$26,
         $27,$28,$29
       ) RETURNING *`,
      [
        uuidv4(), reference, req.user.id, recipient_id, relais?.id || null,
        total_kmf, parseFloat((total_kmf / eurKmf).toFixed(2)),
        payment_mode,
        'pending',
        stripe_payment_intent || null,
        cash_ref_code,
        pickup_code,
        confection_type,
        confection_instructions || null,
        confection_delay_days,
        confection_artisan_id || null,
        module_type        || null,
        module_fabric_id   || null,
        module_fabric_type || null,
        module_size        || null,
        module_retouche,
        module_qty_meters  || null,
        module_accessories ? JSON.stringify(module_accessories) : null,
        order_occasion     || null,
        Math.round(cost_estimated),
        Number(margin_est),
        discountPct,
        discountKmf,
        loyaltyLabel,
      ]
    );

    // ── Historiser statut initial ───────────────────────────────────────────
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'confirmed', 'Commande créée', $2)`,
      [order.id, req.user.id]
    );

    // ── Wallet : débit effectif FIFO (après INSERT pour avoir order.id) ──────
    if (creditApplied > 0) {
      await walletService.debit(client, {
        userId:         req.user.id,
        amountKmf:      creditApplied,
        reason:         'checkout',
        referenceId:    order.id,
        idempotencyKey: `checkout_${order.id}`,
        note:           `Wallet appliqué à commande ${order.reference}`,
      });
      await client.query(
        'UPDATE orders SET wallet_applied_kmf = $1 WHERE id = $2',
        [creditApplied, order.id]
      );
    }

    // ── Créer les order_items ───────────────────────────────────────────────
    for (const item of items) {
      const product = productMap[item.product_id];
      const qty     = parseInt(item.quantity) || 1;

      await client.query(
        `INSERT INTO order_items (
           order_id, product_id, quantity, price_kmf,
           module_type, module_fabric_id, module_fabric_type,
           module_size, module_retouche, module_qty_meters, module_accessories
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          order.id, item.product_id, qty, product.price_kmf,
          item.module_type        || null,
          item.module_fabric_id   || null,
          item.module_fabric_type || null,
          item.module_size        || null,
          item.module_retouche    || false,
          item.module_qty_meters  || null,
          item.module_accessories ? JSON.stringify(item.module_accessories) : null,
        ]
      );

      // Décrémenter stock uniquement pour cash_relais
      // (pour stripe_eur, le webhook payments.js gère la décrémentation après confirmation)
      if (product.stock !== null && payment_mode === 'cash_relais') {
        await client.query(
          'UPDATE products SET stock = stock - $1 WHERE id = $2',
          [qty, item.product_id]
        );
      }
    }

    await client.query('COMMIT');

    // ── SMS + email confirmation (non bloquant) ─────────────────────────────
    const smsPhone  = req.user.phone;
    const userEmail = req.user.email || req.body.email;

    let cashSmsText = null;
    if (payment_mode === 'cash_relais') {
      const totalStr = Number(order.total_kmf).toLocaleString('fr-FR');
      cashSmsText = `Komerce : Commande ${reference} enregistree ! Rendez-vous au ${relais?.name || 'relais'} pour payer ${totalStr} KMF. Code : ${cash_ref_code}. Vous avez ${cashTimeout}h.`;
    }

    const emailItems = items.map(i => ({
      name:      productMap[i.product_id]?.name || 'Produit',
      qty:       parseInt(i.quantity) || 1,
      price_kmf: productMap[i.product_id]?.price_kmf || 0,
    }));

    notifyOrderCreated(order, smsPhone, userEmail, emailItems, relais, cashSmsText);

    res.status(201).json({
      discount_pct:       order.discount_pct    || 0,
      discount_kmf:       order.discount_kmf    || 0,
      loyalty_label:      order.loyalty_label   || null,
      credit_applied_kmf: creditApplied,
      order: {
        id:             order.id,
        reference:      order.reference,
        status:         order.status,
        total_kmf:      order.total_kmf,
        total_eur:      order.total_eur,
        payment_mode:   order.payment_mode,
        payment_status: order.payment_status,
        cash_ref_code:  order.cash_ref_code,
        confection_type: order.confection_type,
        module_type:    order.module_type,
        relais: relais ? { id: relais.id, name: relais.name, address: relais.address } : null,
        created_at:     order.created_at,
      },
    });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
