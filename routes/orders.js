/**
 * KOMERCE — Commandes v7.5
 *
 * POST  /api/orders               → créer une commande (client authentifié)
 * GET   /api/orders               → liste des commandes du client connecté
 * GET   /api/orders/:ref          → détail + suivi public par référence
 * PATCH /api/orders/:id/status    → changer statut (admin/agent_hub/agent_relais)
 * PATCH /api/orders/:id/cost      → saisir le coût réel (admin)
 * GET   /api/orders/:id/history   → historique statuts
 *
 * Changelog v7.6 vs v7.5 :
 *   · PATCH /api/orders/:id/cost : ajout supplier_name + supplier_invoice_url
 *   · Traçabilité achat fournisseur — champs optionnels, mise à jour dynamique
 *
 * Changelog v7.5 vs v7.2 :
 *   · ceremony_* renommé module_* — champs génériques pour tous les modules spécialisés
 *   · CEREMONY_TYPES remplacé par MODULE_TYPES — extensible sans migration DB
 *   · confection_type étendu : 'couture_standard' | 'sur_mesure' | 'lunettes_vue' | ...
 *   · Commentaires alignés sur Brand Truth v7 (local d'abord, modules spécialisés)
 *
 * Changelog v7.7 :
 *   · cash_ref_code : code 6 chiffres lisibles (ex: 482917) au lieu de hex 16 chars
 *     → plus facile à dicter oralement par le client à l'agent relais
 *
 * Changelog v8.0 :
 *   · Pipeline simplifié à 6 étapes : confirmed→ordered→preparation→shipped→available→collected
 *   · Supprimé : draft, paid, purchasing, hub_preparation, transit_comores
 *   · Fix désynchronisation DB ↔ Code (bug enum violation)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { getLoyaltyDiscount, recalculateLoyalty } = require('./loyalty');
const { sendSMS }  = require('../utils/sms');
const { getRates } = require('../utils/rates');
const { getRule, getRuleNumber } = require('../utils/rules');
const { generateParcelRef } = require('../utils/reference');
const { sendOrderConfirmation } = require('../utils/email');
const { validate } = require('../middleware/validate');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { orders } = require('../validators');

// ─── Constantes — pipeline MVP 6 étapes (v8.0) ──────────────────────────────
//
// confirmed   → commande créée, paiement en attente
// ordered     → paiement validé (cash relais par agent_relais, ou webhook Stripe)
// preparation → [SCAN Hub] colis reçu, emballé au hub
// shipped     → départ maritime
// available   → [SCAN Relais] colis reçu au relais → SMS client
// collected   → [SCAN QR] remis au client
// cancelled / refunded → admin

const ORDER_STATUSES = [
  'confirmed',    // commande créée
  'ordered',      // paiement validé → commande lancée
  'preparation',  // SCAN Hub — emballage
  'shipped',      // remis au transitaire à Dubai
  'in_transit',   // 🚢 embarqué — confirmation transitaire
  'available',    // SCAN Relais — colis reçu
  'collected',    // SCAN QR — remis au client
  'cancelled',
  'refunded',
];

// Matrice de transitions valides — pipeline MVP 7 étapes (v9.0)
// Les admins peuvent toujours basculer vers cancelled/refunded depuis n'importe quel statut.
const VALID_TRANSITIONS = {
  confirmed:   ['ordered', 'cancelled'],
  ordered:     ['preparation', 'cancelled'],
  preparation: ['shipped', 'cancelled'],
  shipped:     ['in_transit', 'cancelled'],
  in_transit:  ['available', 'cancelled'],
  available:   ['collected', 'cancelled'],
  collected:   [],
  cancelled:   ['refunded'],
  refunded:    [],
};

// Rôles autorisés par transition — pipeline MVP 7 étapes (v9.0)
const TRANSITION_ROLES = {
  ordered:     ['admin', 'agent_relais'],  // cash validé par agent_relais, ou webhook Stripe
  preparation: ['admin', 'agent_hub'],     // SCAN Hub
  shipped:     ['admin', 'agent_hub'],     // remis au transitaire
  in_transit:  ['admin'],                  // confirmation embarquement transitaire
  available:   ['admin', 'agent_relais'],  // SCAN Relais — arrivée
  collected:   ['admin', 'agent_relais'],  // SCAN QR
  cancelled:   ['admin'],
  refunded:    ['admin'],
};

// confection_type — extensible sans migration DB (champ TEXT en base)
const CONFECTION_TYPES = [
  'aucun', 'couture_standard', 'sur_mesure', 'retouche_locale', 'broderie',
  'lunettes_vue', 'lunettes_solaires',
  'construction_devis', 'cosmetiques_devis', // Phase 2-3
];

// MODULE_TYPES — sous-types pour le module couture uniquement
// Les autres modules (lunettes, construction, cosmetiques) n'ont pas de sous-type
const MODULE_TYPES = ['ready_made', 'fabric_only', 'custom_from_fabric'];

// SMS déclenchés par changement de statut — pipeline MVP 7 étapes (v9.0)
// Seuls les statuts visibles client reçoivent un SMS
const STATUS_SMS = {
  ordered:     (ref) => `Komerce : Commande ${ref} lancée ! Votre article est en cours de traitement.`,
  preparation: (ref) => `Komerce : Commande ${ref} — colis reçu au Hub, contrôle qualité en cours.`,
  shipped:     (ref) => `Komerce : Commande ${ref} — votre colis est prêt, remis au transitaire à Dubai.`,
  in_transit:  (ref) => `Komerce : Commande ${ref} — votre colis est embarqué sur le bateau ! 🚢 Arrivée estimée 3–5 semaines.`,
  available:   (ref, relais) => `Komerce : Commande ${ref} disponible au relais ${relais || ''}. Venez le récupérer !`,
  collected:   (ref) => `Komerce : Commande ${ref} remise. Merci de votre confiance ! 🎉`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { randomBytes } = crypto;

function generateRef() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  // randomBytes génère des octets non biaisés — rejet des valeurs hors plage
  // pour éviter un biais de modulo (36 ne divise pas 256 uniformément)
  const result = [];
  while (result.length < 6) {
    const byte = randomBytes(1)[0];
    // Rejeter les valeurs > 251 pour éviter le biais de modulo (252 = 7 × 36)
    if (byte < 252) result.push(chars[byte % 36]);
  }
  return 'K' + result.join('');
}

async function getUniqueRef() {
  // La colonne `reference` a une contrainte UNIQUE en DB.
  // En cas de collision (extrêmement rare), on retente jusqu'à 5 fois.
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = generateRef();
    const { rows } = await db.query('SELECT id FROM orders WHERE reference = $1', [ref]);
    if (!rows.length) return ref;
  }
  throw new Error('Impossible de générer une référence unique après 5 tentatives');
}

/**
 * generateCashCode — Code cash 6 chiffres crypto-safe (v7.7)
 *
 * Génère un code numérique à 6 chiffres (000000–999999) sans biais de modulo.
 * Valeurs 250–255 rejetées car 250 = 25×10 → division uniforme parfaite.
 *
 * Exemple : "482917"
 *
 * Remplacement du hash hex 16 chars (ex: 0c92c35b321fb02b) — illisible oralement.
 * Un code 6 chiffres se dicte en 3 secondes, sans risque d'erreur.
 *
 * Espace de 1 000 000 codes — largement suffisant pour des commandes en attente simultanées.
 * L'unicité est garantie par la contrainte DB unique sur (cash_ref_code, payment_status='pending').
 */
function generateCashCode() {
  const digits = [];
  while (digits.length < 6) {
    const b = randomBytes(1)[0];
    // Rejeter 250–255 pour éviter le biais de modulo (250 = 25 × 10)
    if (b < 250) digits.push(b % 10);
  }
  return digits.join('');
}

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
//   module_*          → autres champs module au niveau commande

router.post('/', authenticate, validate(orders.create), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Taux de change actuels — utilisés pour total_eur et cost_estimated
    const rates = await getRates();
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

    // ── Vérifier stock + calculer totaux ────────────────────────────────────
    let total_kmf        = 0;
    let cost_estimated   = 0;

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
      const maxQty = await getRule('MAX_QUANTITY_PER_ITEM', 100);
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

      // Estimation coût : sourcing + fret + douane estimée (valeurs depuis business_rules)
      const fretPerKg    = await getRule('FREIGHT_KMF_PER_KG', 65);
      const fret_kmf     = (product.weight_kg || 0.5) * qty * fretPerKg;
      const aedFallback  = await getRule('AED_KMF_FALLBACK', 138);
      const base_aed_kmf = (product.price_aed || 0) * aedFallback * qty;
      const customsPct   = await getRule('CUSTOMS_DEFAULT_PCT', 20) / 100;
      const customs_est  = base_aed_kmf * customsPct * (product.customs_risk_coeff || 1.0);
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
      const ld = await getLoyaltyDiscount(db, req.user.id);
      discountPct  = ld.discountPct  || 0;
      loyaltyLabel = ld.discountLabel || null;
      discountKmf  = Math.round(total_kmf * discountPct / 100);
      total_kmf    = total_kmf - discountKmf;
    }

    // ── Crédits boutique — appliquer si disponibles ──────────────────────────
    let creditApplied = 0;
    let creditRows = [];
    if (req.user?.id) {
      const creditsData = await getAvailableCredits(client, req.user.id);
      if (creditsData.total_kmf > 0) {
        creditApplied = Math.min(creditsData.total_kmf, total_kmf);
        total_kmf -= creditApplied;

        // Décrémenter les crédits dans l'ordre FIFO
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

    // ── Code cash 6 chiffres (v7.7) — lisible oralement ─────────────────────
    // Ex: "482917" au lieu de "0c92c35b321fb02b"
    // Le client dicte le code à l'agent relais en 3 secondes.
    const cash_ref_code = payment_mode === 'cash_relais'
      ? generateCashCode()
      : null;

    // Code de retrait 6 caractères alphanumériques (crypto)
    const PICKUP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const pickup_code = Array.from({ length: 6 }, () => {
      let b;
      do { b = randomBytes(1)[0]; } while (b >= 216); // 216 = 6 × 36
      return PICKUP_CHARS[b % 36];
    }).join('');

    const reference = await getUniqueRef();

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
        module_type || null,
        module_fabric_id  || null,
        module_fabric_type || null,
        module_size        || null,
        module_retouche,
        module_qty_meters  || null,
        module_accessories ? JSON.stringify(module_accessories) : null,
        order_occasion || null,
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
          item.module_type || null,
          item.module_fabric_id  || null,
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

    // ── SMS confirmation ────────────────────────────────────────────────────
    const smsPhone = req.user.phone;
    if (smsPhone) {
      if (payment_mode === 'cash_relais') {
        // Cash relais : informer le client d'aller au relais pour payer
        const cashTimeout = await getRule('CASH_PAYMENT_TIMEOUT_HOURS', 36);
        const totalStr = Number(order.total_kmf).toLocaleString('fr-FR');
        const cashSms = `Komerce : Commande ${reference} enregistree ! Rendez-vous au ${relais?.name || 'relais'} pour payer ${totalStr} KMF. Code : ${cash_ref_code}. Vous avez ${cashTimeout}h.`;
        sendSMS(smsPhone, cashSms, 'cash_relais_confirm', order.id)
          .catch(console.error);
      } else {
        sendSMS(smsPhone, STATUS_SMS.ordered(reference), 'confirmation', order.id)
          .catch(console.error);
      }
    }

    // ── Email confirmation (D2/BUG-017) ─────────────────────────────────────
    const userEmail = req.user.email || req.body.email;
    if (userEmail) {
      const emailItems = items.map(i => ({
        name: productMap[i.product_id]?.name || 'Produit',
        qty: parseInt(i.quantity) || 1,
        price_kmf: productMap[i.product_id]?.price_kmf || 0,
      }));
      sendOrderConfirmation(
        { reference, total_kmf, relais_name: relais?.name },
        userEmail,
        emailItems
      ).catch(err => console.error('[EMAIL] Order confirmation error:', err.message));
    }

    res.status(201).json({
        discount_pct:     order.discount_pct || 0,
        discount_kmf:     order.discount_kmf || 0,
        loyalty_label:    order.loyalty_label || null,
        credit_applied_kmf: creditApplied,
      order: {
        id:               order.id,
        reference:        order.reference,
        status:           order.status,
        total_kmf:        order.total_kmf,
        total_eur:        order.total_eur,
        payment_mode:     order.payment_mode,
        payment_status:   order.payment_status,
        cash_ref_code:    order.cash_ref_code,
        confection_type:  order.confection_type,
        module_type: order.module_type,
        relais:           relais ? { id: relais.id, name: relais.name, address: relais.address } : null,
        created_at:       order.created_at,
      },
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create order error:', err.message);
    res.status(500).json({ error: 'Erreur création commande' });
  } finally {
    client.release();
  }
});

// ─── GET /api/orders — liste client ──────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;

    const conditions = ['o.user_id = $1'];
    const params     = [req.user.id];
    let   pi         = 2;

    if (status) {
      conditions.push(`o.status = $${pi++}`);
      params.push(status);
    }

    const where = conditions.join(' AND ');

    // Jointure via order_items pour récupérer le premier article
    const { rows } = await db.query(
      `SELECT
         o.id, o.reference, o.status, o.total_kmf,
         o.payment_mode, o.payment_status,
         o.confection_type, o.module_type,
         o.created_at,
         r.name AS relais_name,
         -- Premier article de la commande (pour affichage)
         (
           SELECT p.name FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = o.id
           ORDER BY oi.created_at ASC LIMIT 1
         ) AS product_name,
         (
           SELECT p.image_url FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = o.id
           ORDER BY oi.created_at ASC LIMIT 1
         ) AS product_image_url,
         (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS items_count
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE ${where}
       ORDER BY o.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, Number(limit), Number(offset)]
    );

    res.json(rows);
  } catch (err) {
    console.error('List orders error:', err.message);
    res.status(500).json({ error: 'Erreur liste commandes' });
  }
});

// ─── GET /api/orders/relais ───────────────────────────────────────────────────
// Liste les commandes disponibles (status = 'available') au relais de l'agent connecté.
// Inclut aussi les commandes en transit vers ce relais (statut shipped / transit_comores).
// Inclut les commandes cash en attente de paiement (status='confirmed', payment_mode='cash_relais').
// Rôles : admin, agent_relais
//
// INSÉRER AVANT router.get('/:ref', ...)
router.get('/relais', authenticate, requireRole(['admin', 'agent_relais']), async (req, res) => {
  try {
    const relais_id = req.user.relais_id;
    if (!relais_id && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Aucun relais associé à cet agent' });
    }

    const conditions = relais_id
      ? `o.relais_id = $1`
      : `1=1`; // admin voit tout

    const params = relais_id ? [relais_id] : [];

    const { rows } = await db.query(
      `SELECT
         o.id,
         o.reference,
         o.status,
         o.total_kmf,
         o.payment_mode,
         o.payment_status,
         o.pickup_code,
         o.qr_token,
         o.qr_expires_at,
         o.available_at,
         o.shipped_at,
         o.created_at,
         o.cash_ref_code,
         rc.full_name  AS recipient_name,
         rc.phone      AS recipient_phone,
         r.name        AS relais_name,
         -- Nombre d'articles
         (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS items_count,
         -- Premier article (pour affichage)
         (
           SELECT p.name FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = o.id
           ORDER BY oi.created_at ASC LIMIT 1
         ) AS product_name
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       WHERE ${conditions}
         AND (
           o.status IN ('shipped', 'available')
           OR (o.status = 'confirmed' AND o.payment_mode = 'cash_relais' AND o.payment_status = 'pending')
         )
         AND o.status NOT IN ('collected', 'cancelled', 'refunded')
       ORDER BY
         CASE o.status
           WHEN 'available' THEN 1
           WHEN 'shipped'   THEN 2
           WHEN 'confirmed' THEN 3
         END,
         o.available_at ASC NULLS LAST,
         o.created_at   ASC`,
      params
    );

    // Calculer alertes (colis disponibles non retirés — seuil configurable)
    const alertHours = await getRule('ORDER_ALERT_48H_AVAILABLE', 48);
    const now = Date.now();
    const enriched = rows.map(o => ({
      ...o,
      alert_48h: o.status === 'available' && o.available_at
        ? (now - new Date(o.available_at).getTime()) > alertHours * 60 * 60 * 1000
        : false,
      hours_waiting: o.available_at
        ? Math.floor((now - new Date(o.available_at).getTime()) / (60 * 60 * 1000))
        : null,
    }));

    const summary = {
      en_attente:    enriched.filter(o => o.status === 'available').length,
      en_transit:    enriched.filter(o => o.status === 'shipped').length,
      alertes_48h:   enriched.filter(o => o.alert_48h).length,
      cash_pending:  enriched.filter(o => o.status === 'confirmed' && o.payment_mode === 'cash_relais').length,
    };

    res.json({ summary, orders: enriched });
  } catch (err) {
    console.error('[orders/relais] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur récupération commandes relais' });
  }
});

// ─── GET /api/orders/problems ─────────────────────────────────────────────────
// Détecte les commandes problématiques du relais courant (ou tous si admin).
// 10 règles de détection alignées sur la spec v8.2.
// Rôles : admin, agent_relais, agent_hub
//
// INSÉRER AVANT router.get('/:ref', ...)
router.get('/problems', authenticate, requireRole(['admin', 'agent_relais', 'agent_hub']), async (req, res) => {
  try {
    const relais_id = req.user.relais_id;

    // Build relais filter safely — parameterized to prevent SQL injection
    const params = [];
    let relaisFilter = '';
    if (relais_id && req.user.role !== 'admin') {
      params.push(relais_id);
      relaisFilter = `AND o.relais_id = $${params.length}`;
    }

    // Seuils problèmes — configurables via business_rules (safe cast via getRuleNumber)
    const prepDays     = await getRuleNumber('PROBLEM_PREP_BLOCKED_DAYS', 4);
    const transitDays  = await getRuleNumber('PROBLEM_TRANSIT_MAX_DAYS', 12);
    const waitDays     = await getRuleNumber('PROBLEM_WAITING_MAX_DAYS', 7);
    const noNotifHours = await getRuleNumber('PROBLEM_NO_NOTIF_HOURS', 1);
    const stalledDays  = await getRuleNumber('PROBLEM_STALLED_DAYS', 30);

    // Add threshold params for parameterized query
    const prepDaysIdx     = params.length + 1;
    params.push(prepDays);
    const transitDaysIdx  = params.length + 1;
    params.push(transitDays);
    const waitDaysIdx     = params.length + 1;
    params.push(waitDays);
    const noNotifHoursIdx = params.length + 1;
    params.push(noNotifHours);
    const stalledDaysIdx  = params.length + 1;
    params.push(stalledDays);

    // 10 règles de détection — chaque règle retourne des commandes avec problem_type
    const { rows } = await db.query(
      `SELECT DISTINCT ON (o.id)
         o.id,
         o.reference,
         o.status,
         o.total_kmf,
         o.payment_mode,
         o.payment_status,
         o.created_at,
         o.available_at,
         o.shipped_at,
         o.purchasing_at,
         o.preparation_at,
         rc.full_name AS recipient_name,
         rc.phone     AS recipient_phone,
         r.name       AS relais_name,
         CASE
           -- Règle 1 : paiement confirmé mais pas de BC (bon de commande)
           WHEN o.payment_status = 'paid'
            AND o.status IN ('confirmed', 'ordered')
            AND o.purchasing_at IS NULL
            THEN 'payment_no_bc'

           -- Règle 2 : double paiement suspect (vérifier en DB via stripe)
           -- (nécessite table payments — à implémenter si besoin)

           -- Règle 3 : préparation bloquée >4 jours
           WHEN o.status = 'preparation'
            AND o.preparation_at < NOW() - INTERVAL '1 day' * ${prepDaysIdx}
            THEN 'preparation_too_long'

           -- Règle 4 : transit >12 jours
           WHEN o.status = 'shipped'
            AND o.shipped_at < NOW() - INTERVAL '1 day' * ${transitDaysIdx}
            THEN 'transit_too_long'

           -- Règle 5 : disponible depuis >7 jours (non retiré)
           WHEN o.status = 'available'
            AND o.available_at < NOW() - INTERVAL '1 day' * ${waitDaysIdx}
            THEN 'waiting_too_long'

           -- Règle 6 : disponible sans notification (qr_token NULL après 1h)
           WHEN o.status = 'available'
            AND o.available_at < NOW() - INTERVAL '1 hour' * ${noNotifHoursIdx}
            AND o.qr_token IS NULL
            THEN 'no_notification'

           -- Règle 7 : commande active depuis >30 jours sans avancement
           WHEN o.status = 'ordered'
            AND o.created_at < NOW() - INTERVAL '1 day' * ${stalledDaysIdx}
            THEN 'stalled'

           -- Règle 8 : paiement cash non soldé après collecte (si possible à détecter)
           -- (nécessite table cash_settlements — Phase 2)

           -- Règle 9 : commande active sans relais assigné
           WHEN o.relais_id IS NULL
            AND o.status NOT IN ('confirmed', 'cancelled', 'refunded')
            THEN 'no_relais'

           ELSE 'other'
         END AS problem_type,

         -- Ancienneté en heures pour triage
         EXTRACT(EPOCH FROM (NOW() - GREATEST(
           o.available_at, o.shipped_at, o.preparation_at, o.purchasing_at, o.created_at
         ))) / 3600 AS hours_since_last_event

       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       WHERE o.status NOT IN ('collected', 'cancelled', 'refunded')
         ${relaisFilter}
         AND (
           -- Règle 1
           (o.payment_status = 'paid' AND o.status IN ('confirmed', 'ordered') AND o.purchasing_at IS NULL)
           -- Règle 3
           OR (o.status = 'preparation' AND o.preparation_at < NOW() - INTERVAL '1 day' * ${prepDaysIdx})
           -- Règle 4
           OR (o.status = 'shipped' AND o.shipped_at < NOW() - INTERVAL '1 day' * ${transitDaysIdx})
           -- Règle 5
           OR (o.status = 'available' AND o.available_at < NOW() - INTERVAL '1 day' * ${waitDaysIdx})
           -- Règle 6
           OR (o.status = 'available' AND o.available_at < NOW() - INTERVAL '1 hour' * ${noNotifHoursIdx} AND o.qr_token IS NULL)
           -- Règle 7
           OR (o.status = 'ordered' AND o.created_at < NOW() - INTERVAL '1 day' * ${stalledDaysIdx})
           -- Règle 9
           OR (o.relais_id IS NULL AND o.status NOT IN ('confirmed', 'cancelled', 'refunded'))
         )
       ORDER BY o.id, hours_since_last_event DESC`,
      params
    );

    // Score santé global (0-100)
    // Formule : 100 - (nb_problèmes * 5), min 0
    const health_score = Math.max(0, 100 - rows.length * 5);

    // Regrouper par catégorie
    const by_category = {
      finance:    rows.filter(r => ['payment_no_bc'].includes(r.problem_type)).length,
      logistique: rows.filter(r => ['transit_too_long', 'preparation_too_long', 'no_relais'].includes(r.problem_type)).length,
      client:     rows.filter(r => ['waiting_too_long', 'no_notification'].includes(r.problem_type)).length,
      donnees:    rows.filter(r => ['stalled', 'other'].includes(r.problem_type)).length,
    };

    res.json({
      health_score,
      total: rows.length,
      by_category,
      problems: rows,
    });

  } catch (err) {
    console.error('[orders/problems] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur récupération problèmes' });
  }
});

// ─── GET /api/orders/credits — crédits boutique disponibles ──────────────────
// Retourne la somme des crédits boutique disponibles pour le client connecté.
// Rôles : client (ses propres crédits) ou admin (tous les crédits d'un user)

router.get('/credits', authenticate, async (req, res) => {
  try {
    const userId = req.query.user_id && req.user.role === 'admin'
      ? req.query.user_id
      : req.user.id;

    const { rows } = await db.query(
      `SELECT
         id, amount_kmf, remaining_kmf, reason, source_order_id,
         expires_at, created_at
       FROM store_credits
       WHERE user_id = $1
         AND remaining_kmf > 0
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC`,
      [userId]
    );

    const total_kmf = rows.reduce((sum, c) => sum + Number(c.remaining_kmf), 0);

    res.json({
      total_kmf,
      credits: rows.map(c => ({
        id:          c.id,
        amount_kmf:  c.amount_kmf,
        remaining_kmf: c.remaining_kmf,
        reason:      c.reason,
        source_order_id: c.source_order_id,
        expires_at:  c.expires_at,
        created_at:  c.created_at,
      })),
    });
  } catch (err) {
    console.error('[CREDITS] Error:', err.message);
    res.status(500).json({ error: 'Erreur récupération crédits boutique' });
  }
});

// ─── POST /api/orders/:id/qr-token ───────────────────────────────────────────
// Génère un token QR unique pour une commande disponible.
// Le token est stocké en DB avec une expiration 48h.
// Rôles : admin, agent_relais
//
// INSÉRER AVANT router.get('/:ref', ...) — mais après router.get('/relais') et router.get('/problems')
router.post('/:id/qr-token', authenticate, requireRole(['admin', 'agent_relais']), async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier que la commande est dans un état compatible (available)
    const { rows: [order] } = await db.query(
      `SELECT o.*, rc.full_name AS recipient_name, r.name AS relais_name
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE o.id = $1`,
      [id]
    );

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    if (order.status !== 'available') {
      return res.status(422).json({
        error: `Impossible de générer un QR — statut actuel : ${order.status} (attendu : available)`,
        current_status: order.status,
      });
    }

    // Générer le token : SHA256(orderId + relaisId + timestamp + QR_SECRET)
    const secret    = process.env.QR_SECRET || 'komerce-qr-default-secret-change-in-prod';
    const timestamp = Date.now().toString();
    const token     = crypto
      .createHash('sha256')
      .update(`${id}-${order.relais_id || 'NO_RELAIS'}-${timestamp}-${secret}`)
      .digest('hex')
      .slice(0, 24); // 24 caractères hex = suffisamment unique et lisible

    const qrHours = await getRule('QR_EXPIRATION_HOURS', 48);
    const expiration = new Date(Date.now() + qrHours * 60 * 60 * 1000);

    // Sauvegarder en DB
    await db.query(
      `UPDATE orders
       SET qr_token = $1, qr_expires_at = $2, updated_at = NOW()
       WHERE id = $3`,
      [token, expiration, id]
    );

    console.log(`[QR-TOKEN] Généré pour ${order.reference} — token: ${token.slice(0, 8)}... expires: ${expiration.toISOString()}`);

    // Payload QR complet — sera encodé en JSON dans le QR code côté frontend
    const qr_payload = {
      orderId:     id,
      reference:   order.reference,
      clientName:  order.recipient_name || 'Client',
      relaisId:    order.relais_id,
      relaisName:  order.relais_name,
      token,
      expiration:  expiration.toISOString(),
    };

    res.json({
      success:    true,
      token,
      expiration: expiration.toISOString(),
      qr_payload, // le frontend encode ce JSON en QR
    });

  } catch (err) {
    console.error('[orders/qr-token] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur génération token QR' });
  }
});

// ─── GET /api/orders/retrait/:token — Page HTML retrait client (publique) ──────
// Affiche le QR code dans une page web que le client peut ouvrir, screenshot ou télécharger.
// Lien envoyé via WhatsApp / email / n'importe quel canal.
// Token validé (non expiré) mais PAS invalidé — l'invalidation se fait au scan (verify-qr).

router.get('/retrait/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { rows: [order] } = await db.query(
      `SELECT o.reference, o.qr_expires_at,
              rc.full_name AS client_name, rc.phone AS client_phone,
              r.name AS relais_name, r.address AS relais_address
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE o.qr_token = $1`,
      [token]
    );

    if (!order) {
      return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Komerce — Lien invalide</title>
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;text-align:center;padding:20px}</style>
        </head><body><div>
          <div style="font-size:48px;margin-bottom:16px">❌</div>
          <h2>Lien invalide ou expiré</h2>
          <p style="color:#94a3b8">Ce lien de retrait n'est plus valide.<br>Contactez votre point relais pour en obtenir un nouveau.</p>
        </div></body></html>`);
    }

    const expires = new Date(order.qr_expires_at);
    const expired = expires < new Date();
    const expiresStr = expires.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

    // Payload QR = le token lui-même (sera vérifié via verify-qr)
    const qrData = JSON.stringify({ token, reference: order.reference });
    const qrDataB64 = Buffer.from(qrData).toString('base64');

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Komerce — Retrait colis</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #1e293b; border-radius: 16px; padding: 28px 24px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    .logo { font-size: 1.4rem; font-weight: 700; color: #6366f1; letter-spacing: 1px; margin-bottom: 4px; }
    .logo-sub { font-size: 0.8rem; color: #64748b; margin-bottom: 20px; }
    .title { font-size: 1.15rem; font-weight: 600; margin-bottom: 4px; }
    .ref { font-family: monospace; font-size: 1rem; color: #6366f1; background: #0f172a; padding: 4px 12px; border-radius: 6px; display: inline-block; margin-bottom: 16px; }
    .qr-wrap { background: white; border-radius: 12px; padding: 16px; display: inline-block; margin: 12px 0 8px; }
    .expired-banner { background: #7f1d1d; color: #fca5a5; border-radius: 8px; padding: 10px 16px; margin: 8px 0 12px; font-size: 0.85rem; font-weight: 600; }
    .info-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #334155; font-size: 0.875rem; }
    .info-row:last-child { border-bottom: none; }
    .info-lbl { color: #94a3b8; }
    .info-val { font-weight: 600; text-align: right; max-width: 55%; }
    .info-block { background: #0f172a; border-radius: 10px; padding: 12px 16px; margin: 14px 0; }
    .btn-dl { display: block; width: 100%; padding: 12px; background: #6366f1; color: white; border: none; border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 14px; text-decoration: none; }
    .btn-dl:hover { background: #4f46e5; }
    .tip { font-size: 0.78rem; color: #475569; margin-top: 14px; line-height: 1.5; }
    .expire-ok { font-size: 0.8rem; color: #34d399; margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">KOMERCE</div>
    <div class="logo-sub">Votre colis vous attend</div>

    <div class="title">📦 Code de retrait</div>
    <div class="ref">${order.reference}</div>

    ${expired ? '<div class="expired-banner">⏰ Ce QR code a expiré — demandez-en un nouveau à votre relais</div>' : ''}

    <div class="qr-wrap" id="qr-container"></div>

    ${!expired ? `<div class="expire-ok">✅ Valable jusqu'au ${expiresStr}</div>` : ''}

    <div class="info-block">
      <div class="info-row"><span class="info-lbl">Client</span><span class="info-val">${order.client_name || '—'}</span></div>
      <div class="info-row"><span class="info-lbl">Point relais</span><span class="info-val">${order.relais_name || '—'}</span></div>
      ${order.relais_address ? `<div class="info-row"><span class="info-lbl">Adresse</span><span class="info-val">${order.relais_address}</span></div>` : ''}
    </div>

    <button class="btn-dl" id="btn-dl" ${expired ? 'disabled style="opacity:0.4"' : ''}>⬇️ Télécharger le QR Code</button>

    <p class="tip">Présentez ce QR code à l'agent relais lors du retrait.<br>Usage unique · ${expired ? 'Expiré' : 'Expire le ' + expiresStr}</p>
  </div>

  <script>
    const qrData = atob('${qrDataB64}');
    const container = document.getElementById('qr-container');

    try {
      new QRCode(container, {
        text: qrData,
        width: 200, height: 200,
        colorDark: '#1e293b', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch(e) {
      container.innerHTML = '<p style="color:#ef4444;font-size:0.8rem">Erreur QR</p>';
    }

    // Téléchargement via canvas
    document.getElementById('btn-dl').addEventListener('click', () => {
      setTimeout(() => {
        const canvas = container.querySelector('canvas');
        if (!canvas) { alert('QR non disponible'); return; }
        const link = document.createElement('a');
        link.download = 'komerce-qr-${order.reference}.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
      }, 200);
    });
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (err) {
    console.error('[orders/retrait] Erreur:', err.message);
    res.status(500).send('<h1>Erreur serveur</h1>');
  }
});

// ─── GET /api/orders/:ref — détail + suivi (public par référence) ─────────────

router.get('/:ref', async (req, res) => {
  try {
    const isUuid = /^[0-9a-f-]{36}$/.test(req.params.ref);

    // Deux requêtes explicites pour éviter l'interpolation de nom de colonne
    const { rows: [order] } = isUuid
      ? await db.query(
          `SELECT o.*, r.name AS relais_name, r.address AS relais_address,
                  r.phone AS relais_phone, r.hours AS relais_hours, r.zone AS relais_zone
           FROM orders o LEFT JOIN relais r ON r.id = o.relais_id WHERE o.id = $1`,
          [req.params.ref]
        )
      : await db.query(
          `SELECT o.*, r.name AS relais_name, r.address AS relais_address,
                  r.phone AS relais_phone, r.hours AS relais_hours, r.zone AS relais_zone
           FROM orders o LEFT JOIN relais r ON r.id = o.relais_id WHERE o.reference = $1`,
          [req.params.ref]
        );

    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Articles de la commande
    const { rows: items } = await db.query(
      `SELECT
         oi.id, oi.quantity, oi.price_kmf,
         oi.module_type, oi.module_fabric_type,
         oi.module_size, oi.module_retouche,
         oi.module_qty_meters, oi.module_accessories,
         p.name AS product_name, p.image_url, p.category, p.has_couture, p.emoji
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at ASC`,
      [order.id]
    );

    // Historique des statuts
    const { rows: history } = await db.query(
      `SELECT status, note, created_at
       FROM order_status_history
       WHERE order_id = $1
       ORDER BY created_at ASC`,
      [order.id]
    );

    // Route publique — req.user est undefined sauf si le middleware authenticate est présent.
    // TODO: Ajouter un middleware « soft-auth » (optionalAuthenticate) pour peupler req.user
    //       sans bloquer la requête quand le token est absent/invalide.
    // cash_ref_code est masqué pour tous les accès publics (toujours false ici).
    // Les agents accèdent aux détails complets via GET /api/admin/orders.
    const isAdmin       = req.user && ['admin', 'agent_relais', 'agent_hub'].includes(req.user.role);
    const isRelaisAdmin = req.user && ['admin', 'agent_relais'].includes(req.user.role);

    // If not authenticated, return minimal public data only
    if (!req.user) {
      return res.json({
        reference: order.reference,
        status: order.status,
        created_at: order.created_at,
      });
    }

    res.json({
      id:                  order.id,
      reference:           order.reference,
      status:              order.status,
      total_kmf:           order.total_kmf,
      total_eur:           order.total_eur,
      payment_mode:        order.payment_mode,
      payment_status:      order.payment_status,
      // cash_ref_code exposé uniquement aux agents et admins
      ...(isAdmin       ? { cash_ref_code: order.cash_ref_code } : {}),
      // pickup_code exposé uniquement à l'admin et l'agent relais (pas au public, pas à l'agent hub)
      ...(isRelaisAdmin ? { pickup_code:   order.pickup_code   } : {}),
      confection_type:       order.confection_type,
      module_type:           order.module_type,
      module_size:           order.module_size,
      module_retouche:       order.module_retouche,
      purchasing_at:         order.purchasing_at,
      shipped_at:            order.shipped_at,
      transit_comores_at:    order.transit_comores_at,
      available_at:          order.available_at,
      collected_at:          order.collected_at,
      created_at:            order.created_at,
      // Traçabilité fournisseur (v7.6) — admin seulement
      ...(req.user?.role === 'admin' ? {
        supplier_name:         order.supplier_name         || null,
        supplier_invoice_url:  order.supplier_invoice_url  || null,
      } : {}),
      items,
      relais: order.relais_name ? {
        name:    order.relais_name,
        address: order.relais_address,
        phone:   order.relais_phone,
        hours:   order.relais_hours,
        zone:    order.relais_zone,
      } : null,
      history,
    });

  } catch (err) {
    console.error('Get order error:', err.message);
    res.status(500).json({ error: 'Erreur récupération commande' });
  }
});

// ─── POST /api/orders/:id/cancel ─────────────────────────────────────────────
// Annulation avec remboursement automatique (Stripe refund ou crédit boutique)
//
// Auth : client (sa propre commande) ou admin (toute commande)
// Body : { reason?: string }
//
// Règles (business_rules) :
//   CANCEL_FREE_WINDOW_HOURS  → fenêtre remboursement 100% (défaut: 24h)
//   CANCEL_PARTIAL_REFUND_PCT → % remboursé hors fenêtre  (défaut: 80%)
//   CANCEL_CUTOFF_STATUS      → statut max pour annulation (défaut: shipped)

router.post('/:id/cancel', authenticate, validate(orders.cancelOrder), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id }     = req.params;
    const { reason } = req.body;

    // ── 1. Récupérer la commande ──────────────────────────────────────────────
    const { rows: [order] } = await client.query(
      `SELECT o.*, u.phone AS user_phone, u.email AS user_email
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [id]
    );

    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // ── 2. Droits d'accès ────────────────────────────────────────────────────
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && order.user_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Accès refusé — commande appartenant à un autre client' });
    }

    // ── 3. Vérifier que la commande n'est pas déjà terminée ──────────────────
    if (['cancelled', 'refunded'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Commande déjà ${order.status} — aucune action possible`,
        current_status: order.status,
      });
    }
    if (order.status === 'collected') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Impossible d\'annuler une commande déjà collectée — contactez le SAV',
        current_status: order.status,
      });
    }

    // ── 4. Vérifier le statut de coupure (CANCEL_CUTOFF_STATUS) ──────────────
    const cutoffStatus = await getRule('CANCEL_CUTOFF_STATUS', 'shipped');
    const STATUS_ORDER = [
      'confirmed', 'ordered', 'preparation',
      'shipped', 'in_transit', 'available', 'collected',
    ];
    const currentIdx = STATUS_ORDER.indexOf(order.status);
    const cutoffIdx  = STATUS_ORDER.indexOf(cutoffStatus);

    if (currentIdx >= cutoffIdx) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Annulation impossible — commande en statut "${order.status}". L'annulation n'est possible que jusqu'au statut "${cutoffStatus}" exclu. Pour un retour, contactez le SAV.`,
        current_status: order.status,
        cutoff_status:  cutoffStatus,
      });
    }

    // ── 5. Calculer le remboursement ──────────────────────────────────────────
    const isPaid         = order.payment_status === 'paid';
    let refundAmountKmf  = 0;
    let refundAmountEur  = 0;
    let refundType       = 'none';
    let refundMethod     = null;
    let inFreeWindow     = false;

    if (isPaid) {
      const freeWindowHours  = await getRule('CANCEL_FREE_WINDOW_HOURS', 24);
      const partialRefundPct = await getRule('CANCEL_PARTIAL_REFUND_PCT', 80);

      // Référence temporelle : ordered_at (moment du paiement réel)
      const paidAt        = order.ordered_at || order.created_at;
      const hoursSincePaid = (Date.now() - new Date(paidAt).getTime()) / (1000 * 60 * 60);
      inFreeWindow         = hoursSincePaid <= freeWindowHours;

      const refundPct    = inFreeWindow ? 100 : partialRefundPct;
      refundAmountKmf    = Math.round(Number(order.total_kmf) * refundPct / 100);

      // Convertir en EUR (pro-rata basé sur total_eur/total_kmf)
      const eurKmfRate   = order.total_eur && order.total_kmf
        ? Number(order.total_kmf) / Number(order.total_eur)
        : 492;
      refundAmountEur    = parseFloat((refundAmountKmf / eurKmfRate).toFixed(2));

      refundType   = inFreeWindow ? 'full' : 'partial';
      refundMethod = order.payment_mode === 'stripe_eur' ? 'stripe' : 'store_credit';
    }

    // ── 6. Exécuter le remboursement Stripe AVANT le COMMIT ──────────────────
    let stripeRefundId = null;
    let storeCreditId  = null;

    if (isPaid && refundAmountKmf > 0 && refundMethod === 'stripe') {
      if (!order.stripe_payment_id) {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: 'Stripe payment ID introuvable — contactez le support',
        });
      }
      try {
        const amountCents  = Math.round(refundAmountEur * 100);
        const stripeRefund = await stripe.refunds.create({
          payment_intent: order.stripe_payment_id,
          amount:         amountCents,
          reason:         'requested_by_customer',
          metadata: {
            order_reference: order.reference,
            refund_type:     refundType,
            komerce:         'true',
          },
        });
        stripeRefundId = stripeRefund.id;
        console.log(`[CANCEL] Stripe refund OK: ${stripeRefundId} — ${refundAmountEur}€ pour ${order.reference}`);
      } catch (stripeErr) {
        await client.query('ROLLBACK');
        console.error('[CANCEL] Stripe refund error:', stripeErr.message);
        return res.status(500).json({
          error: `Annulation impossible — erreur remboursement Stripe: ${stripeErr.message}`,
        });
      }
    }

    // ── 7. Annuler la commande ────────────────────────────────────────────────
    await client.query(
      `UPDATE orders
       SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [reason || null, id]
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'cancelled', $2, $3)`,
      [id, reason ? `Annulation : ${reason}` : 'Annulation client', req.user.id]
    );

    // ── 8. Restaurer le stock ─────────────────────────────────────────────────
    const { rows: items } = await client.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1', [id]
    );
    for (const item of items) {
      await client.query(
        'UPDATE products SET stock = stock + $1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    // ── 9. Crédit boutique (cash relais) ──────────────────────────────────────
    if (isPaid && refundAmountKmf > 0 && refundMethod === 'store_credit') {
      const { rows: [credit] } = await client.query(
        `INSERT INTO store_credits
           (user_id, amount_kmf, remaining_kmf, reason, source_order_id)
         VALUES ($1, $2, $2, 'cancellation_refund', $3)
         RETURNING id`,
        [order.user_id, refundAmountKmf, id]
      );
      storeCreditId = credit.id;
    }

    // ── 10. Enregistrer dans la table refunds ─────────────────────────────────
    if (isPaid && refundAmountKmf > 0) {
      await client.query(
        `INSERT INTO refunds
           (order_id, amount_kmf, amount_eur, refund_type, refund_method,
            stripe_refund_id, store_credit_id, reason, initiated_by, status, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed',NOW())`,
        [
          id, refundAmountKmf, refundAmountEur,
          refundType, refundMethod,
          stripeRefundId, storeCreditId,
          reason || 'Annulation client', req.user.id,
        ]
      );
    }

    await client.query('COMMIT');

    // ── 11. SMS client (non bloquant) ─────────────────────────────────────────
    const userPhone = order.user_phone;
    if (userPhone) {
      let smsText;
      if (!isPaid) {
        smsText = `Komerce : Commande ${order.reference} annulee. Aucun paiement n'a ete preleve.`;
      } else if (refundMethod === 'stripe') {
        smsText = `Komerce : Commande ${order.reference} annulee. Remboursement de ${refundAmountEur.toFixed(2)}EUR en cours (2-5 jours ouvres Stripe).`;
      } else {
        smsText = `Komerce : Commande ${order.reference} annulee. Credit boutique de ${Number(refundAmountKmf).toLocaleString('fr-FR')} KMF credite sur votre compte.`;
      }
      sendSMS(userPhone, smsText, 'cancellation', id).catch(console.error);
    }

    // ── Réponse ───────────────────────────────────────────────────────────────
    const refundInfo = isPaid && refundAmountKmf > 0 ? {
      amount_kmf:      refundAmountKmf,
      amount_eur:      refundAmountEur,
      type:            refundType,
      method:          refundMethod,
      in_free_window:  inFreeWindow,
      stripe_refund_id: stripeRefundId,
      store_credit_id:  storeCreditId,
    } : null;

    let message;
    if (!isPaid) {
      message = 'Commande annulée — aucun prélèvement effectué';
    } else if (refundMethod === 'stripe') {
      message = `Remboursement de ${refundAmountEur.toFixed(2)}€ initié via Stripe (2–5 jours ouvrés)`;
    } else {
      message = `Crédit boutique de ${Number(refundAmountKmf).toLocaleString('fr-FR')} KMF crédité sur votre compte`;
    }

    res.json({
      success:   true,
      reference: order.reference,
      status:    'cancelled',
      refund:    refundInfo,
      message,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[CANCEL] Error:', err.message);
    res.status(500).json({ error: 'Erreur annulation commande' });
  } finally {
    client.release();
  }
});

// ─── PATCH /api/orders/:id/status ────────────────────────────────────────────

router.patch('/:id/status', authenticate, requireRole(['admin', 'agent_hub', 'agent_relais']), validate(orders.updateStatus), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { status, note } = req.body;

    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Statut invalide. Valeurs : ${ORDER_STATUSES.join(', ')}`,
      });
    }

    const { rows: [order] } = await client.query(
      `SELECT o.*, r.name AS relais_name, u.phone AS user_phone
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
       LEFT JOIN users  u ON u.id = o.user_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // ── Valider la transition d'état ─────────────────────────────────────────
    const allowedNext = VALID_TRANSITIONS[order.status] || [];
    if (!allowedNext.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Transition invalide : ${order.status} → ${status}. Transitions autorisées depuis "${order.status}" : ${allowedNext.join(', ') || 'aucune (état terminal)'}`,
        current_status: order.status,
      });
    }

    // Vérifier que le rôle de l'agent est autorisé pour cette transition
    const allowedRoles = TRANSITION_ROLES[status] || ['admin'];
    if (!allowedRoles.includes(req.user.role)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: `Rôle "${req.user.role}" non autorisé pour la transition → ${status}`,
      });
    }

    // agent_relais ne peut passer à 'ordered' que pour les commandes cash_relais
    if (status === 'ordered' && req.user.role === 'agent_relais' && order.payment_mode !== 'cash_relais') {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: "L'agent relais ne peut valider le paiement que pour les commandes cash relais",
      });
    }

    // Timestamp correspondant au statut — aligné spec v7.5 §9.1
    const tsField = {
      ordered:     'ordered_at',
      preparation: 'preparation_at',
      shipped:     'shipped_at',
      available:   'available_at',
      collected:   'collected_at',
      cancelled:   'cancelled_at',
    }[status];

    const tsUpdate = tsField ? `, ${tsField} = NOW()` : '';

    // Si passage à available et pickup_code manquant → en générer un
    let pickupCodeValue = null;
    if (status === 'available' && !order.pickup_code) {
      const PICKUP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const { randomBytes: rb } = require('crypto');
      const newCode = Array.from({ length: 6 }, () => {
        let b;
        do { b = rb(1)[0]; } while (b >= 216);
        return PICKUP_CHARS[b % 36];
      }).join('');
      pickupCodeValue = newCode;
      console.log(`[ORDERS] pickup_code auto-généré pour ${order.reference}: ${newCode}`);
    }

    if (pickupCodeValue) {
      await client.query(
        `UPDATE orders SET status = $1${tsUpdate}, pickup_code = $2, updated_at = NOW() WHERE id = $3`,
        [status, pickupCodeValue, order.id]
      );
    } else {
      await client.query(
        `UPDATE orders SET status = $1${tsUpdate}, updated_at = NOW() WHERE id = $2`,
        [status, order.id]
      );
    }

    // Mettre à jour payment_status pour les commandes cash_relais passées à 'ordered'
    if (status === 'ordered' && order.payment_mode === 'cash_relais') {
      await client.query(
        `UPDATE orders SET payment_status = 'paid' WHERE id = $1`,
        [order.id]
      );
    }

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [order.id, status, note || null, req.user.id]
    );

    await client.query('COMMIT');

    // ── Recalculer le palier fidélité après collecte ──────────────────────
    if (status === 'collected' && order.user_id) {
      recalculateLoyalty(db, order.user_id)
        .catch(e => console.error('[LOYALTY] recalculate error:', e.message));
    }

    const smsPhone = order.user_phone;
    if (smsPhone && STATUS_SMS[status]) {
      sendSMS(smsPhone, STATUS_SMS[status](order.reference, order.relais_name), status, order.id)
        .catch(console.error);
    }

    res.json({ success: true, status });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update status error:', err.message);
    res.status(500).json({ error: 'Erreur mise à jour statut' });
  } finally {
    client.release();
  }
});

// ─── PATCH /api/orders/:id/cost ──────────────────────────────────────────────

router.patch('/:id/cost', authenticate, requireRole(['admin']), validate(orders.updateCost), async (req, res) => {
  try {
    const {
      cost_real_kmf,
      customs_real_kmf,
      customs_agent_id,
      customs_notes,
      sh_category,
      // ── Traçabilité fournisseur (v7.6) ────────────────────────────────────
      // supplier_name        : enseigne / fournisseur (ex: "Noon Dubai", "Carrefour MoE")
      // supplier_invoice_url : lien facture (Google Drive, S3, URL directe)
      supplier_name,
      supplier_invoice_url,
    } = req.body;

    if (!cost_real_kmf) return res.status(400).json({ error: 'cost_real_kmf obligatoire' });

    const { rows: [order] } = await db.query(
      'SELECT * FROM orders WHERE id = $1', [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Construire la mise à jour dynamiquement selon les champs fournis
    const updates = ['cost_real_kmf = $1', 'updated_at = NOW()'];
    const values  = [cost_real_kmf];
    let   pi      = 2;

    if (supplier_name !== undefined) {
      updates.push(`supplier_name = $${pi++}`);
      values.push(supplier_name);
    }
    if (supplier_invoice_url !== undefined) {
      updates.push(`supplier_invoice_url = $${pi++}`);
      values.push(supplier_invoice_url);
    }
    values.push(order.id);

    // Mise à jour coût réel (le trigger compute_real_margin recalcule margin_real_pct)
    await db.query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = $${pi}`,
      values
    );

    // Customs history — sans customs_delta_pct ni customs_delta_kmf (GENERATED)
    if (customs_real_kmf && sh_category) {
      await db.query(
        `INSERT INTO customs_history
           (order_id, sh_category, customs_estimated_kmf, customs_real_kmf,
            customs_agent_id, customs_notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          order.id,
          sh_category,
          order.cost_estimated_kmf || null,
          customs_real_kmf,
          customs_agent_id || null,
          customs_notes    || null,
        ]
      );
    }

    const { rows: [updated] } = await db.query(
      `SELECT id, reference, cost_real_kmf, margin_real_pct,
              margin_alert, sourcing_blocked, cost_delta_pct,
              supplier_name, supplier_invoice_url
       FROM orders WHERE id = $1`,
      [req.params.id]
    );

    res.json({ success: true, order: updated });

  } catch (err) {
    console.error('Update cost error:', err.message);
    res.status(500).json({ error: 'Erreur saisie coût réel' });
  }
});

// ─── GET /api/orders/:id/history ─────────────────────────────────────────────

router.get('/:id/history', authenticate, async (req, res) => {
  try {
    // Vérifier que la commande appartient à l'utilisateur (sauf admin/agents)
    const isPrivileged = ['admin', 'agent_hub', 'agent_relais'].includes(req.user.role);

    if (!isPrivileged) {
      const { rows: [order] } = await db.query(
        'SELECT id FROM orders WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      if (!order) return res.status(403).json({ error: 'Accès refusé' });
    }

    const { rows } = await db.query(
      `SELECT h.status, h.note, h.created_at, u.full_name AS changed_by_name
       FROM order_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.order_id = $1
       ORDER BY h.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur historique' });
  }
});

// ─── Helper : crédits boutique disponibles ────────────────────────────────────

async function getAvailableCredits(dbClient, userId) {
  const { rows } = await dbClient.query(
    `SELECT COALESCE(SUM(remaining_kmf), 0)::INTEGER AS total_kmf
     FROM store_credits
     WHERE user_id = $1
       AND remaining_kmf > 0
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId]
  );
  return { total_kmf: rows[0]?.total_kmf || 0 };
}





// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — EXPÉDITION PARTIELLE & COLIS (Parcel-Centric v2.0 — Phase 4)
//
// POST   /api/orders/:id/mark-availability   → marquer la disponibilité des articles
// POST   /api/orders/:id/partial-ship        → créer une expédition partielle (parcels)
// GET    /api/orders/:id/parcels             → liste des colis d'une commande
// PATCH  /api/orders/parcels/:parcelId/status → changer statut d'un colis
// POST   /api/orders/:id/cancel-backorder    → annuler un colis backorder
// ═══════════════════════════════════════════════════════════════════════════════


// ─── Constantes — colis (parcel-centric) ────────────────────────────────────

const PARCEL_VALID_STATUSES = [
  'draft', 'preparation', 'shipped', 'in_transit', 'arrived', 'available', 'collected', 'cancelled',
];

const PARCEL_TRANSITIONS = {
  draft:       ['preparation', 'cancelled'],
  preparation: ['shipped', 'cancelled'],
  shipped:     ['in_transit', 'cancelled'],
  in_transit:  ['arrived', 'available', 'cancelled'],
  arrived:     ['available', 'cancelled'],
  available:   ['collected', 'cancelled'],
  collected:   [],
  cancelled:   [],
};

const PARCEL_SMS = {
  shipped:   (ref) =>
    `Komerce : Colis ${ref} expedie. Vous serez notifie a l'arrivee.`,
  available: (ref, relais) =>
    `Komerce : Colis ${ref} disponible au relais ${relais || ''}. Venez le recuperer !`,
  collected: (ref) =>
    `Komerce : Colis ${ref} remis. Merci ! 🎉`,
};

// ─── POST /api/orders/:id/mark-availability ──────────────────────────────────
// Marquer la disponibilité de chaque article au hub Dubai.
// Corps : { items: [{ order_item_id, status, reason?, estimated_available_at? }] }

router.post('/:id/mark-availability', authenticate, requireRole(['admin', 'agent_hub']), validate(orders.markAvailability), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { items } = req.body;

    // Vérifier que la commande existe
    const { rows: [order] } = await client.query(
      'SELECT id, reference, status FROM orders WHERE id = $1',
      [id]
    );
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // Vérifier que les items appartiennent à la commande
    const itemIds = items.map(i => i.order_item_id);
    const { rows: existingItems } = await client.query(
      'SELECT id FROM order_items WHERE id = ANY($1) AND order_id = $2',
      [itemIds, id]
    );
    if (existingItems.length !== itemIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Certains articles n'appartiennent pas à cette commande`,
        expected: itemIds.length,
        found: existingItems.length,
      });
    }

    // Mettre à jour chaque article
    const updatedItems = [];
    for (const item of items) {
      const { rows: [updated] } = await client.query(
        `UPDATE order_items
         SET availability_status = $1,
             estimated_available_at = $2,
             backorder_reason = $3,
             updated_at = NOW()
         WHERE id = $4
         RETURNING id, product_id, quantity, availability_status, estimated_available_at, backorder_reason`,
        [
          item.status,
          item.estimated_available_at || null,
          item.reason || null,
          item.order_item_id,
        ]
      );
      updatedItems.push(updated);
    }

    // Historiser
    const availCount = items.filter(i => i.status === 'available').length;
    const delayCount = items.filter(i => i.status === 'delayed').length;
    const boCount    = items.filter(i => i.status === 'backorder').length;

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [
        id,
        order.status,
        `Disponibilité mise à jour — ${availCount} disponible(s), ${delayCount} retardé(s), ${boCount} en backorder`,
        req.user.id,
      ]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      reference: order.reference,
      items: updatedItems,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[mark-availability] Error:', err.message);
    res.status(500).json({ error: 'Erreur mise à jour disponibilité' });
  } finally {
    client.release();
  }
});

// ─── POST /api/orders/:id/partial-ship ───────────────────────────────────────
// Créer une expédition partielle : colis « partial » + colis « backorder ».
// Corps : { available_items: [{ order_item_id, quantity }], notes? }

router.post('/:id/partial-ship', authenticate, requireRole(['admin', 'agent_hub']), validate(orders.partialShip), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { available_items, notes } = req.body;

    // ── 1. Valider la commande ──────────────────────────────────────────────
    const { rows: [order] } = await client.query(
      `SELECT o.*, u.phone AS user_phone
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [id]
    );
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    if (!['ordered', 'preparation'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Expédition partielle impossible — statut actuel : ${order.status} (attendu : ordered ou preparation)`,
        current_status: order.status,
      });
    }

    // ── 2. Charger les règles métier ────────────────────────────────────────
    const delayThresholdDays = await getRuleNumber('PARTIAL_SHIP_DELAY_THRESHOLD_DAYS', 7);
    const minAvailablePct    = await getRuleNumber('PARTIAL_SHIP_MIN_AVAILABLE_PCT', 30);
    const backorderMaxDays   = await getRuleNumber('BACKORDER_MAX_DAYS', 45);
    const autoNotify         = await getRule('PARTIAL_SHIP_AUTO_NOTIFY', true);

    // ── 3. Vérifier le seuil de délai ───────────────────────────────────────
    const orderedAt = order.ordered_at || order.created_at;
    const daysSinceOrdered = (Date.now() - new Date(orderedAt).getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceOrdered < delayThresholdDays) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Expédition partielle trop tôt — ${Math.round(daysSinceOrdered)} jour(s) depuis la commande, seuil : ${delayThresholdDays} jours`,
        days_since_ordered: Math.round(daysSinceOrdered),
        threshold_days: delayThresholdDays,
      });
    }

    // ── 4. Charger tous les items de la commande ────────────────────────────
    const { rows: allItems } = await client.query(
      `SELECT oi.*, p.name AS product_name, p.price_kmf AS product_price_kmf
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       FOR UPDATE`,
      [id]
    );

    // Vérifier que les available_items appartiennent à la commande
    const availItemIds = new Set(available_items.map(i => i.order_item_id));
    const availItemMap = new Map(available_items.map(i => [i.order_item_id, i]));

    for (const ai of available_items) {
      const found = allItems.find(oi => oi.id === ai.order_item_id);
      if (!found) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Article ${ai.order_item_id} introuvable dans cette commande`,
        });
      }
      if (ai.quantity > found.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Quantité demandée (${ai.quantity}) > quantité commandée (${found.quantity}) pour l'article ${found.product_name}`,
        });
      }
    }

    // ── 5. Vérifier le % minimum de disponibilité ──────────────────────────
    const totalQty     = allItems.reduce((sum, i) => sum + i.quantity, 0);
    const availableQty = available_items.reduce((sum, i) => sum + i.quantity, 0);
    const availPct     = (availableQty / totalQty) * 100;

    if (availPct < minAvailablePct) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Pourcentage disponible insuffisant : ${availPct.toFixed(1)}% (minimum : ${minAvailablePct}%)`,
        available_pct: parseFloat(availPct.toFixed(1)),
        min_required_pct: minAvailablePct,
      });
    }

    // ── 6. Générer les références colis ─────────────────────────────────────
    const psRef = await generateParcelRef(db);
    const psId  = uuidv4();

    // ── 7a. Créer le colis « partial » ─────────────────────────────────────
    await client.query(
      `INSERT INTO parcels (
         id, order_id, type, status, reference, label, relais_id, created_by, notes
       ) VALUES ($1, $2, 'partial', 'preparation', $3, 'Envoi partiel', $4, $5, $6)`,
      [psId, id, psRef, order.relais_id, req.user.id, notes || null]
    );

    // Insérer les articles du colis partial
    const psItems = [];
    for (const ai of available_items) {
      const original = allItems.find(oi => oi.id === ai.order_item_id);
      const piId = uuidv4();
      await client.query(
        `INSERT INTO parcel_items (id, parcel_id, order_item_id, product_id, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [piId, psId, ai.order_item_id, original.product_id, ai.quantity]
      );
      psItems.push({
        id: piId,
        order_item_id: ai.order_item_id,
        product_name: original.product_name,
        quantity: ai.quantity,
        price_kmf: original.price_kmf,
      });

      // Marquer l'article comme disponible
      await client.query(
        `UPDATE order_items SET availability_status = 'available', updated_at = NOW()
         WHERE id = $1`,
        [ai.order_item_id]
      );
    }

    // ── 7b. Créer le colis « backorder » pour les articles restants ────────
    const backorderItems = allItems.filter(oi => !availItemIds.has(oi.id));
    // Also handle partial quantities (items where only part of qty is shipped)
    const partialBackorders = available_items
      .filter(ai => {
        const orig = allItems.find(oi => oi.id === ai.order_item_id);
        return orig && ai.quantity < orig.quantity;
      })
      .map(ai => {
        const orig = allItems.find(oi => oi.id === ai.order_item_id);
        return { ...orig, quantity: orig.quantity - ai.quantity, _isPartial: true };
      });

    const allBackorderItems = [...backorderItems, ...partialBackorders];

    let boId = null;
    let boRef = null;
    const boItems = [];

    if (allBackorderItems.length > 0) {
      boRef = await generateParcelRef(db);
      boId  = uuidv4();

      await client.query(
        `INSERT INTO parcels (
           id, order_id, type, status, reference, label, relais_id, created_by,
           estimated_date
         ) VALUES ($1, $2, 'backorder', 'draft', $3, 'Reliquat en attente', $4, $5, NOW() + INTERVAL '1 day' * $6)`,
        [boId, id, boRef, order.relais_id, req.user.id, backorderMaxDays]
      );

      for (const boi of allBackorderItems) {
        const piId = uuidv4();
        await client.query(
          `INSERT INTO parcel_items (id, parcel_id, order_item_id, product_id, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [piId, boId, boi.id, boi.product_id, boi.quantity]
        );
        boItems.push({
          id: piId,
          order_item_id: boi.id,
          product_name: boi.product_name,
          quantity: boi.quantity,
          price_kmf: boi.price_kmf,
        });

        // Marquer comme backorder (seulement si l'article entier est en backorder)
        if (!boi._isPartial) {
          await client.query(
            `UPDATE order_items SET availability_status = 'backorder', updated_at = NOW()
             WHERE id = $1`,
            [boi.id]
          );
        }
      }
    }

    // ── 8. Historique ───────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [
        id,
        order.status,
        `Expédition partielle créée — ${availableQty} articles expédiés (${psRef}), ${allBackorderItems.reduce((s, i) => s + i.quantity, 0)} en backorder${boRef ? ` (${boRef})` : ''}`,
        req.user.id,
      ]
    );

    await client.query('COMMIT');

    // ── 9. SMS notification (non bloquant) ──────────────────────────────────
    if (autoNotify && order.user_phone) {
      const boCount = allBackorderItems.reduce((s, i) => s + i.quantity, 0);
      const smsText = `Komerce : Commande ${order.reference} — expedition partielle : ${availableQty} article(s) expedie(s), ${boCount} en attente (backorder). Ref colis : ${psRef}`;
      sendSMS(order.user_phone, smsText, 'partial_ship', id).catch(console.error);
    }

    // ── Réponse ─────────────────────────────────────────────────────────────
    res.status(201).json({
      success: true,
      reference: order.reference,
      partial_ship: {
        id: psId,
        reference: psRef,
        type: 'partial',
        status: 'preparation',
        items: psItems,
      },
      backorder: boId ? {
        id: boId,
        reference: boRef,
        type: 'backorder',
        status: 'draft',
        items: boItems,
        estimated_date: new Date(Date.now() + backorderMaxDays * 24 * 60 * 60 * 1000).toISOString(),
      } : null,
      summary: {
        shipped_qty: availableQty,
        backorder_qty: allBackorderItems.reduce((s, i) => s + i.quantity, 0),
        available_pct: parseFloat(availPct.toFixed(1)),
      },
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[partial-ship] Error:', err.message);
    res.status(500).json({ error: 'Erreur création expédition partielle' });
  } finally {
    client.release();
  }
});

// ─── GET /api/orders/:id/parcels ─────────────────────────────────────────────
// Liste les colis d'une commande avec leurs articles.
// Auth : admin, agent_hub, agent_relais, ou propriétaire de la commande.
// Backward compat : /sub-orders redirige vers /parcels

router.get('/:id/sub-orders', authenticate, (req, res) => {
  // Backward compat redirect
  res.redirect(307, `/api/orders/${req.params.id}/parcels`);
});

router.get('/:id/parcels', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    // Vérifier accès
    const { rows: [order] } = await db.query(
      'SELECT id, reference, user_id, status FROM orders WHERE id = $1',
      [id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const isPrivileged = ['admin', 'agent_hub', 'agent_relais'].includes(req.user.role);
    if (!isPrivileged && order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Charger les colis
    const { rows: parcelRows } = await db.query(
      `SELECT
         p.id, p.type, p.status, p.reference,
         p.label, p.estimated_date, p.shipped_at,
         p.available_at, p.collected_at, p.cancelled_at,
         p.cancel_reason, p.notes,
         p.created_at, p.updated_at
       FROM parcels p
       WHERE p.order_id = $1 AND p.status != 'cancelled'
       ORDER BY p.created_at ASC`,
      [id]
    );

    // Charger les articles pour chaque colis
    const enriched = [];
    for (const parcel of parcelRows) {
      const { rows: items } = await db.query(
        `SELECT
           pi.id, pi.order_item_id, pi.quantity,
           oi.price_kmf,
           p.name AS product_name, p.image_url AS product_image
         FROM parcel_items pi
         JOIN products p ON p.id = pi.product_id
         JOIN order_items oi ON oi.id = pi.order_item_id
         WHERE pi.parcel_id = $1
         ORDER BY pi.created_at ASC`,
        [parcel.id]
      );

      enriched.push({
        ...parcel,
        items,
        total_kmf: items.reduce((sum, i) => sum + (Number(i.price_kmf) * i.quantity), 0),
      });
    }

    res.json({
      order_reference: order.reference,
      order_status: order.status,
      parcels: enriched,
    });

  } catch (err) {
    console.error('[parcels] Error:', err.message);
    res.status(500).json({ error: 'Erreur récupération colis' });
  }
});

// ─── PATCH /api/orders/parcels/:parcelId/status ─────────────────────────────
// Changer le statut d'un colis.
// Corps : { status, note?, tracking_ref? }
//
// IMPORTANT : cette route utilise un préfixe « parcels » fixe (pas de :id parent)
// → insérer AVANT les routes /:id/* pour éviter collision Express

router.patch('/parcels/:parcelId/status', authenticate, requireRole(['admin', 'agent_hub', 'agent_relais']), validate(orders.parcelStatus), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { parcelId } = req.params;
    const { status, note, tracking_ref } = req.body;

    // Valider le statut
    if (!PARCEL_VALID_STATUSES.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Statut invalide. Valeurs : ${PARCEL_VALID_STATUSES.join(', ')}`,
      });
    }

    // Charger le colis + commande parent
    const { rows: [parcel] } = await client.query(
      `SELECT p.*, o.reference AS parent_reference, o.id AS parent_id,
              o.user_id, o.relais_id, o.status AS parent_status,
              u.phone AS user_phone, r.name AS relais_name
       FROM parcels p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE p.id = $1`,
      [parcelId]
    );

    if (!parcel) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Colis introuvable' });
    }

    // Valider la transition
    const allowedNext = PARCEL_TRANSITIONS[parcel.status] || [];
    if (!allowedNext.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Transition invalide : ${parcel.status} → ${status}. Transitions autorisées : ${allowedNext.join(', ') || 'aucune (état terminal)'}`,
        current_status: parcel.status,
      });
    }

    // Mettre à jour le statut du colis
    const updates = ['status = $1::parcel_status', 'updated_at = NOW()'];
    const params  = [status];
    let pi = 2;

    // Timestamps automatiques
    if (status === 'preparation') updates.push('prepared_at = COALESCE(prepared_at, NOW())');
    if (status === 'shipped')     updates.push('shipped_at = COALESCE(shipped_at, NOW())');
    if (status === 'in_transit')  updates.push('in_transit_at = COALESCE(in_transit_at, NOW())');
    if (status === 'arrived')     updates.push('arrived_at = COALESCE(arrived_at, NOW())');
    if (status === 'available')   updates.push('available_at = COALESCE(available_at, NOW())');
    if (status === 'collected')   updates.push('collected_at = COALESCE(collected_at, NOW())');
    if (status === 'cancelled')   updates.push('cancelled_at = COALESCE(cancelled_at, NOW())');

    if (tracking_ref) {
      updates.push(`reference = $${pi++}`);
      params.push(tracking_ref);
    }
    params.push(parcelId);

    await client.query(
      `UPDATE parcels SET ${updates.join(', ')} WHERE id = $${pi}`,
      params
    );

    // Historique sur la commande parent
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [
        parcel.parent_id,
        parcel.parent_status,
        `Colis ${parcel.reference} → ${status}${note ? ` — ${note}` : ''}`,
        req.user.id,
      ]
    );

    // Vérifier si TOUS les colis sont « collected » → parent aussi
    if (status === 'collected') {
      const { rows: allParcels } = await client.query(
        `SELECT id, status FROM parcels WHERE order_id = $1`,
        [parcel.parent_id]
      );

      // Prendre en compte le statut mis à jour du colis courant
      const allCollected = allParcels.every(p =>
        p.id === parcelId ? true : (p.status === 'collected' || p.status === 'cancelled')
      );

      if (allCollected) {
        await client.query(
          `UPDATE orders SET status = 'collected', collected_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [parcel.parent_id]
        );
        await client.query(
          `INSERT INTO order_status_history (order_id, status, note, changed_by)
           VALUES ($1, 'collected', 'Tous les colis collectés — commande terminée', $2)`,
          [parcel.parent_id, req.user.id]
        );
      }
    }

    await client.query('COMMIT');

    // SMS client (non bloquant) — sur shipped / available / collected
    if (parcel.user_phone && PARCEL_SMS[status]) {
      const smsText = PARCEL_SMS[status](parcel.reference, parcel.relais_name);
      sendSMS(parcel.user_phone, smsText, `parcel_${status}`, parcel.parent_id).catch(console.error);
    }

    res.json({
      success: true,
      parcel_id: parcelId,
      status,
      reference: tracking_ref || parcel.reference,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[parcel/status] Error:', err.message);
    res.status(500).json({ error: 'Erreur mise à jour statut colis' });
  } finally {
    client.release();
  }
});

// Backward compat: old sub-orders status endpoint
router.patch('/sub-orders/:subId/status', authenticate, requireRole(['admin', 'agent_hub', 'agent_relais']), (req, res, next) => {
  req.params.parcelId = req.params.subId;
  req.url = `/parcels/${req.params.subId}/status`;
  next();
});

// ─── POST /api/orders/:id/cancel-backorder ───────────────────────────────────
// Annuler un colis backorder : restauration stock + crédit boutique ou refund Stripe.
// Corps : { parcel_id, reason? }

router.post('/:id/cancel-backorder', authenticate, validate(orders.cancelBackorder), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const parcelId = req.body.parcel_id || req.body.sub_order_id; // backward compat
    const { reason } = req.body;

    // Charger la commande parent
    const { rows: [order] } = await client.query(
      `SELECT o.*, u.phone AS user_phone
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [id]
    );
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // Vérifier les droits (admin, agent_hub, ou propriétaire)
    const isPrivileged = ['admin', 'agent_hub'].includes(req.user.role);
    if (!isPrivileged && order.user_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Charger le colis backorder
    const { rows: [parcel] } = await client.query(
      `SELECT * FROM parcels
       WHERE id = $1 AND order_id = $2 AND type = 'backorder'`,
      [parcelId, id]
    );
    if (!parcel) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Colis backorder introuvable pour cette commande' });
    }

    if (parcel.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'Backorder déjà annulé' });
    }

    if (['shipped', 'in_transit', 'arrived', 'available', 'collected'].includes(parcel.status)) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Annulation impossible — le colis est en statut "${parcel.status}"`,
        current_status: parcel.status,
      });
    }

    // Charger les articles du backorder
    const { rows: boItems } = await client.query(
      `SELECT pi.*, oi.price_kmf, p.name AS product_name
       FROM parcel_items pi
       JOIN products p ON p.id = pi.product_id
       JOIN order_items oi ON oi.id = pi.order_item_id
       WHERE pi.parcel_id = $1`,
      [parcelId]
    );

    // Calculer la valeur totale du backorder
    const backorderValueKmf = boItems.reduce(
      (sum, i) => sum + (Number(i.price_kmf) * i.quantity), 0
    );

    // Annuler le colis
    await client.query(
      `UPDATE parcels
       SET status = 'cancelled'::parcel_status, cancel_reason = $1,
           cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [reason || 'Annulation backorder client', parcelId]
    );

    // Restaurer le stock
    for (const item of boItems) {
      await client.query(
        'UPDATE products SET stock = stock + $1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    // Crédit boutique ou remboursement Stripe
    let refundMethod = null;
    let storeCreditId = null;
    let stripeRefundId = null;
    let refundAmountEur = 0;

    if (backorderValueKmf > 0 && order.payment_status === 'paid') {
      if (order.payment_mode === 'stripe_eur' && order.stripe_payment_id) {
        // Remboursement Stripe partiel
        const eurKmfRate = order.total_eur && order.total_kmf
          ? Number(order.total_kmf) / Number(order.total_eur)
          : 492;
        refundAmountEur = parseFloat((backorderValueKmf / eurKmfRate).toFixed(2));
        const amountCents = Math.round(refundAmountEur * 100);

        try {
          const stripeRefund = await stripe.refunds.create({
            payment_intent: order.stripe_payment_id,
            amount: amountCents,
            reason: 'requested_by_customer',
            metadata: {
              order_reference: order.reference,
              refund_type: 'backorder_cancellation',
              parcel_id: parcelId,
              komerce: 'true',
            },
          });
          stripeRefundId = stripeRefund.id;
          refundMethod = 'stripe';
        } catch (stripeErr) {
          // Fallback vers crédit boutique si Stripe échoue
          console.error('[cancel-backorder] Stripe refund failed, using store credit:', stripeErr.message);
          refundMethod = 'store_credit';
        }
      }

      if (!refundMethod || refundMethod === 'store_credit') {
        refundMethod = 'store_credit';
        const { rows: [credit] } = await client.query(
          `INSERT INTO store_credits
             (user_id, amount_kmf, remaining_kmf, reason, source_order_id)
           VALUES ($1, $2, $2, 'backorder_cancellation', $3)
           RETURNING id`,
          [order.user_id, backorderValueKmf, id]
        );
        storeCreditId = credit.id;
      }

      // Enregistrer dans la table refunds
      await client.query(
        `INSERT INTO refunds
           (order_id, amount_kmf, amount_eur, refund_type, refund_method,
            stripe_refund_id, store_credit_id, reason, initiated_by, status, completed_at)
         VALUES ($1,$2,$3,'partial',$4,$5,$6,$7,$8,'completed',NOW())`,
        [
          id, backorderValueKmf, refundAmountEur,
          refundMethod,
          stripeRefundId, storeCreditId,
          reason || 'Annulation backorder', req.user.id,
        ]
      );
    }

    // Historique
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [
        id,
        order.status,
        `Backorder ${parcel.reference} annulé — ${boItems.length} article(s), ${Number(backorderValueKmf).toLocaleString('fr-FR')} KMF ${refundMethod === 'stripe' ? 'remboursé (Stripe)' : 'crédité (boutique)'}`,
        req.user.id,
      ]
    );

    await client.query('COMMIT');

    // SMS notification (non bloquant)
    if (order.user_phone) {
      const creditStr = refundMethod === 'stripe'
        ? `${refundAmountEur.toFixed(2)}EUR rembourse via Stripe`
        : `${Number(backorderValueKmf).toLocaleString('fr-FR')} KMF credite sur votre compte`;
      const smsText = `Komerce : Backorder ${parcel.reference} annule. ${creditStr}. Merci de votre comprehension.`;
      sendSMS(order.user_phone, smsText, 'backorder_cancelled', id).catch(console.error);
    }

    res.json({
      success: true,
      reference: order.reference,
      parcel_ref: parcel.reference,
      cancelled_items: boItems.map(i => ({
        product_name: i.product_name,
        quantity: i.quantity,
        price_kmf: i.price_kmf,
      })),
      refund: backorderValueKmf > 0 ? {
        amount_kmf: backorderValueKmf,
        amount_eur: refundAmountEur,
        method: refundMethod,
        stripe_refund_id: stripeRefundId,
        store_credit_id: storeCreditId,
      } : null,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cancel-backorder] Error:', err.message);
    res.status(500).json({ error: 'Erreur annulation backorder' });
  } finally {
    client.release();
  }
});


module.exports = router;
