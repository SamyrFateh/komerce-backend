/**
 * KOMERCE â POST /api/orders
 *
 * CrÃ©er une commande (client authentifiÃ©).
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
const { getUniqueRef, generateCashCode, generatePickupCode, getAvailableCredits } = require('../../services/order-service');
const { notifyOrderCreated }             = require('../../services/notification-service');

// MODULE_TYPES â sous-types pour le module couture uniquement
const MODULE_TYPES = ['ready_made', 'fabric_only', 'custom_from_fabric'];

// âââ POST /api/orders âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Corps attendu :
//   items[]              â [{ product_id, quantity, module_type?,
//                             module_fabric_id?, module_fabric_type?,
//                             module_size?, module_retouche?,
//                             module_qty_meters?, module_accessories? }]
//   relais_id            â UUID relais de livraison
//   payment_mode         â 'stripe_eur' | 'cash_relais'
//   recipient_name       â nom du destinataire
//   recipient_phone      â tÃ©lÃ©phone du destinataire
//   confection_type      â 'aucun' | 'couture_standard' | 'sur_mesure' | 'retouche_locale' | 'broderie' | 'lunettes_vue' | 'lunettes_solaires'
//   confection_instructions, confection_delay_days, confection_artisan_id
//   module_type  â si commande cÃ©rÃ©monie globale
//   module_*     â autres champs module au niveau commande

router.post('/', authenticate, validate(orders.create), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Taux de change actuels â utilisÃ©s pour total_eur et cost_estimated
    const rates  = await getRates();
    // BUG-002 fix: fallback si getRates() Ã©choue ou retourne 0/null
    const eurKmf = rates?.eur_kmf || 492;

    const {
      items                 = [],
      relais_id,
      payment_mode,
      stripe_payment_intent,
      recipient_name,
      recipient_phone,
      // Module spÃ©cialisÃ© niveau commande
      confection_type           = 'aucun',
      confection_instructions,
      confection_delay_days     = 0,
      confection_artisan_id,
      // Module spÃ©cialisÃ© niveau commande (optionnel â sinon portÃ© par items)
      module_type,
      module_fabric_id,
      module_fabric_type,
      module_size,
      module_retouche         = false,
      module_qty_meters,
      module_accessories,
      // Spec Â§11 : capturer dÃ¨s MVP pour fidÃ©lisation Phase 2
      // Valeurs : mariage Â· cadeau Â· personnel Â· construction Â· rentree Â· ramadan Â· aid Â· autre
      order_occasion        = null,
    } = req.body;

    // ââ Validation ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    // BUG-009 fix: validation Array.isArray pour Ã©viter crash sur input malformÃ©
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items[] obligatoire (tableau, min 1 article)' });
    }
    if (!['stripe_eur', 'cash_relais'].includes(payment_mode)) {
      return res.status(400).json({ error: 'payment_mode invalide â valeurs : stripe_eur | cash_relais' });
    }
    if (module_type && !MODULE_TYPES.includes(module_type)) {
      return res.status(400).json({ error: `module_type invalide. Valeurs : ${MODULE_TYPES.join(', ')}` });
    }

    // ââ RÃ©soudre relais âââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

    // ââ CrÃ©er ou rÃ©utiliser le recipient ââââââââââââââââââââââââââââââââââââ
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

    // ââ Charger les produits en une seule requÃªte âââââââââââââââââââââââââââ
    const productIds = items.map(i => i.product_id);
    // BUG-008 fix: FOR UPDATE pour verrouiller les lignes et empÃªcher la survente
    const { rows: products } = await client.query(
      'SELECT * FROM products WHERE id = ANY($1) AND is_active = TRUE FOR UPDATE',
      [productIds]
    );
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    // ââ Charger toutes les rÃ¨gles mÃ©tier en parallÃ¨le (TÃ¢che 6 â optimisation) ââ
    const [maxQty, fretPerKg, aedFallback, customsPct, cashTimeout] = await Promise.all([
      getRule('MAX_QUANTITY_PER_ITEM', 100),
      getRule('FREIGHT_KMF_PER_KG', 65),
      getRule('AED_KMF_FALLBACK', 138),
      getRule('CUSTOMS_DEFAULT_PCT', 20),
      getRule('CASH_PAYMENT_TIMEOUT_HOURS', 36),
    ]);

    // ââ VÃ©rifier stock + calculer totaux ââââââââââââââââââââââââââââââââââââ
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
        return res.status(400).json({ error: `QuantitÃ© invalide pour ${item.product_id}: min 1, max ${maxQty}` });
      }
      if (product.stock !== null && product.stock < qty) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Stock insuffisant pour ${product.name} â disponible : ${product.stock}`,
          available_stock: product.stock,
        });
      }
      total_kmf += product.price_kmf * qty;

      // Estimation coÃ»t : sourcing + fret + douane estimÃ©e
      const fret_kmf     = (product.weight_kg || 0.5) * qty * fretPerKg;
      const base_aed_kmf = (product.price_aed || 0) * aedFallback * qty;
      const customs_est  = base_aed_kmf * (customsPct / 100) * (product.customs_risk_coeff || 1.0);
      cost_estimated    += base_aed_kmf + fret_kmf + customs_est;
    }

    const margin_est = total_kmf > 0
      ? ((total_kmf - cost_estimated) / total_kmf * 100).toFixed(2)
      : 0;

    // ââ Loyalty : rÃ©cupÃ©rer le rabais du client connectÃ© ââââââââââââââââââ
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

    // ââ CrÃ©dits boutique â appliquer si disponibles ââââââââââââââââââââââââââ
    let creditApplied = 0;
    if (req.user?.id) {
      const creditsData = await getAvailableCredits(client, req.user.id);
      if (creditsData.total_kmf > 0) {
        creditApplied = Math.min(creditsData.total_kmf, total_kmf);
        total_kmf    -= creditApplied;

        // DÃ©crÃ©menter les crÃ©dits dans l'ordre FIFO
        const { rows: credits } = await client.query(
          `SELECT id, remaining_kmf FROM store_credits
           WHERE user_id = $1 AND remaining_kmf > 0
             AND (expires_at IS NULL OR expires_at > NOW())
           ORDER BY created_at ASC`,
          [req.user.id]
        );
        let toApply = creditApplied;
        for (const credit of credits) {
          if (toApply <= 0) break;
          const used = Math.min(credit.remaining_kmf, toApply);
          await client.query(
            'UPDATE store_credits SET remaining_kmf = remaining_kmf - $1 WHERE id = $2',
            [used, credit.id]
          );
          toApply -= used;
        }
      }
    }

    // ââ Code cash 6 chiffres (v7.7) â lisible oralement âââââââââââââââââââââ
    // Ex: "482917" au lieu de "0c92c35b321fb02b"
    // Le client dicte le code Ã  l'agent relais en 3 secondes.
    const cash_ref_code = payment_mode === 'cash_relais'
      ? generateCashCode()
      : null;

    // Code de retrait 6 caractÃ¨res alphanumÃ©riques (crypto)
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

    // ââ Historiser statut initial âââââââââââââââââââââââââââââââââââââââââââ
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'confirmed', 'Commande crÃ©Ã©e', $2)`,
      [order.id, req.user.id]
    );

    // ââ CrÃ©er les order_items âââââââââââââââââââââââââââââââââââââââââââââââ
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

      // DÃ©crÃ©menter stock uniquement pour cash_relais
      // (pour stripe_eur, le webhook payments.js gÃ¨re la dÃ©crÃ©mentation aprÃ¨s confirmation)
      if (product.stock !== null && payment_mode === 'cash_relais') {
        await client.query(
          'UPDATE products SET stock = stock - $1 WHERE id = $2',
          [qty, item.product_id]
        );
      }
    }

    await client.query('COMMIT');

    // ââ SMS + email confirmation (non bloquant) âââââââââââââââââââââââââââââ
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
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;
