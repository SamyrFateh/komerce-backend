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
const { sendOrderConfirmation } = require('../utils/email');

// ─── Constantes alignées sur l'enum PostgreSQL réel ──────────────────────────
//
// Mapping spec v7.5 §9.1 :
//   ordered         → #1 — paiement confirmé (système)
//   purchasing      → #2 — achat en cours (admin manuel)
//   preparation     → #3 — SCAN 3 Hub réception (agent_hub)
//   hub_preparation → #4 — SCAN 4 Hub groupage prêt groupeur (agent_hub)
//   shipped         → #5 — expédié (admin / groupeur)
//   transit_comores → #6 — arrivé Comores, dédouanement (admin manuel)
//   available       → #7 — SCAN 6 arrivé au relais (agent_relais)
//   collected       → #8 — SCAN QR 7 remis au client (agent_relais)
//
// draft / confirmed / paid : étapes de création/validation commande (avant ordered)
// 'purchasing' et 'transit_comores' : mise à jour admin manuelle uniquement

const ORDER_STATUSES = [
  'draft',
  'confirmed',
  'paid',
  'ordered',           // #1 spec — paiement validé, commande lancée
  'purchasing',        // #2 spec — achat en cours Dubai
  'preparation',       // #3 spec — SCAN 3 Hub réception
  'hub_preparation',   // #4 spec — SCAN 4 Hub groupage / prêt groupeur
  'shipped',           // #5 spec — expédié groupeur
  'transit_comores',   // #6 spec — arrivé Comores, dédouanement
  'available',         // #7 spec — SCAN 6 arrivé au relais
  'collected',         // #8 spec — SCAN QR 7 remis au client
  'cancelled',
  'refunded',
];

// Matrice de transitions valides — alignée spec v7.5 §9.1 (8 statuts opérationnels)
// Les admins peuvent toujours basculer vers cancelled/refunded depuis n'importe quel statut.
const VALID_TRANSITIONS = {
  draft:           ['confirmed', 'cancelled'],
  confirmed:       ['paid', 'cancelled'],
  paid:            ['ordered', 'cancelled'],
  ordered:         ['purchasing', 'cancelled'],
  purchasing:      ['preparation', 'cancelled'],
  preparation:     ['hub_preparation', 'cancelled'],    // SCAN 3 → SCAN 4
  hub_preparation: ['shipped', 'cancelled'],            // SCAN 4 → expédié
  shipped:         ['transit_comores', 'available', 'cancelled'],
  transit_comores: ['available', 'cancelled'],
  available:       ['collected', 'cancelled'],
  collected:       [],
  cancelled:       ['refunded'],
  refunded:        [],
};

// Rôles autorisés par transition — alignés spec v7.5 §9.1
const TRANSITION_ROLES = {
  confirmed:       ['admin', 'agent_hub'],
  paid:            ['admin'],
  ordered:         ['admin'],                           // déclenché par webhook paiement
  purchasing:      ['admin'],
  preparation:     ['admin', 'agent_hub'],              // SCAN 3
  hub_preparation: ['admin', 'agent_hub'],              // SCAN 4
  shipped:         ['admin', 'agent_hub'],
  transit_comores: ['admin'],
  available:       ['admin', 'agent_relais'],           // SCAN 6
  collected:       ['admin', 'agent_relais'],           // SCAN QR 7
  cancelled:       ['admin'],
  refunded:        ['admin'],
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

// SMS déclenchés par changement de statut — alignés spec v7.5 §9.1
// Seuls les statuts visibles client reçoivent un SMS (pas les statuts internes Hub)
const STATUS_SMS = {
  ordered:          (ref) => `Komerce : Commande ${ref} confirmée et lancée ! Votre article est en cours d'achat à Dubai.`,
  purchasing:       (ref) => `Komerce : Commande ${ref} — votre article est en cours d'achat à Dubai.`,
  preparation:      (ref) => `Komerce : Commande ${ref} — colis reçu au Hub Dubai, contrôle qualité en cours.`,
  hub_preparation:  (ref) => `Komerce : Commande ${ref} — colis emballé et prêt pour expédition. Départ imminent !`,
  shipped:          (ref) => `Komerce : Commande ${ref} — votre colis a pris la mer ! Arrivée estimée 3–5 semaines.`,
  transit_comores:  (ref) => `Komerce : Commande ${ref} — colis arrivé aux Comores, en cours de dédouanement.`,
  available:        (ref, relais) => `Komerce : Commande ${ref} disponible au relais ${relais || ''}. Venez le récupérer !`,
  collected:        (ref) => `Komerce : Commande ${ref} remise. Merci de votre confiance ! 🎉`,
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

router.post('/', authenticate, async (req, res) => {
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
      if (qty < 1 || qty > 100) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Quantité invalide pour ${item.product_id}: min 1, max 100` });
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
      const fret_kmf     = (product.weight_kg || 0.5) * qty * 65;
      const base_aed_kmf = (product.price_aed || 0) * 138 * qty;
      const customs_est  = base_aed_kmf * 0.20 * (product.customs_risk_coeff || 1.0);
      cost_estimated    += base_aed_kmf + fret_kmf + customs_est;
    }

    const margin_est = total_kmf > 0
      ? ((total_kmf - cost_estimated) / total_kmf * 100).toFixed(2)
      : 0;

    // ── Code cash si paiement relais ────────────────────────────────────────
    // Codes générés avec crypto — pas Math.random()
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

    const cash_ref_code = payment_mode === 'cash_relais'
      ? randomBytes(8).toString('hex')  // 16 chars hex = 64 bits of entropy
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
      sendSMS(smsPhone, STATUS_SMS.ordered(reference), 'confirmation', order.id)
        .catch(console.error);
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
         AND o.status IN ('shipped', 'transit_comores', 'available')
         AND o.status NOT IN ('collected', 'cancelled', 'refunded')
       ORDER BY
         CASE o.status
           WHEN 'available'       THEN 1
           WHEN 'transit_comores' THEN 2
           WHEN 'shipped'         THEN 3
         END,
         o.available_at ASC NULLS LAST,
         o.created_at   ASC`,
      params
    );

    // Calculer alertes >48h (colis disponibles non retirés)
    const now = Date.now();
    const enriched = rows.map(o => ({
      ...o,
      alert_48h: o.status === 'available' && o.available_at
        ? (now - new Date(o.available_at).getTime()) > 48 * 60 * 60 * 1000
        : false,
      hours_waiting: o.available_at
        ? Math.floor((now - new Date(o.available_at).getTime()) / (60 * 60 * 1000))
        : null,
    }));

    const summary = {
      en_attente:  enriched.filter(o => o.status === 'available').length,
      en_transit:  enriched.filter(o => ['shipped', 'transit_comores'].includes(o.status)).length,
      alertes_48h: enriched.filter(o => o.alert_48h).length,
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
            AND o.preparation_at < NOW() - INTERVAL '4 days'
            THEN 'preparation_too_long'

           -- Règle 4 : transit >12 jours
           WHEN o.status IN ('shipped', 'transit_comores')
            AND o.shipped_at < NOW() - INTERVAL '12 days'
            THEN 'transit_too_long'

           -- Règle 5 : disponible depuis >7 jours (non retiré)
           WHEN o.status = 'available'
            AND o.available_at < NOW() - INTERVAL '7 days'
            THEN 'waiting_too_long'

           -- Règle 6 : disponible sans notification (qr_token NULL après 1h)
           WHEN o.status = 'available'
            AND o.available_at < NOW() - INTERVAL '1 hour'
            AND o.qr_token IS NULL
            THEN 'no_notification'

           -- Règle 7 : commande active depuis >30 jours sans avancement
           WHEN o.status IN ('ordered', 'purchasing')
            AND o.created_at < NOW() - INTERVAL '30 days'
            THEN 'stalled'

           -- Règle 8 : paiement cash non soldé après collecte (si possible à détecter)
           -- (nécessite table cash_settlements — Phase 2)

           -- Règle 9 : commande active sans relais assigné
           WHEN o.relais_id IS NULL
            AND o.status NOT IN ('draft', 'confirmed', 'cancelled', 'refunded')
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
       WHERE o.status NOT IN ('collected', 'cancelled', 'refunded', 'draft')
         ${relaisFilter}
         AND (
           -- Règle 1
           (o.payment_status = 'paid' AND o.status IN ('confirmed', 'ordered') AND o.purchasing_at IS NULL)
           -- Règle 3
           OR (o.status = 'preparation' AND o.preparation_at < NOW() - INTERVAL '4 days')
           -- Règle 4
           OR (o.status IN ('shipped', 'transit_comores') AND o.shipped_at < NOW() - INTERVAL '12 days')
           -- Règle 5
           OR (o.status = 'available' AND o.available_at < NOW() - INTERVAL '7 days')
           -- Règle 6
           OR (o.status = 'available' AND o.available_at < NOW() - INTERVAL '1 hour' AND o.qr_token IS NULL)
           -- Règle 7
           OR (o.status IN ('ordered', 'purchasing') AND o.created_at < NOW() - INTERVAL '30 days')
           -- Règle 9
           OR (o.relais_id IS NULL AND o.status NOT IN ('draft', 'confirmed', 'cancelled', 'refunded'))
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

    const expiration = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h

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

// ─── PATCH /api/orders/:id/status ────────────────────────────────────────────

router.patch('/:id/status', authenticate, requireRole(['admin', 'agent_hub', 'agent_relais']), async (req, res) => {
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

    // Timestamp correspondant au statut — aligné spec v7.5 §9.1
    const tsField = {
      ordered:         'ordered_at',
      purchasing:      'purchasing_at',
      preparation:     'preparation_at',
      hub_preparation: 'hub_preparation_at',
      shipped:         'shipped_at',
      transit_comores: 'transit_comores_at',
      available:       'available_at',
      collected:       'collected_at',
      cancelled:       'cancelled_at',
    }[status];

    const tsUpdate = tsField ? `, ${tsField} = NOW()` : '';

    // Si passage à available et pickup_code manquant → en générer un
    let pickupCodePatch = '';
    if (status === 'available' && !order.pickup_code) {
      const PICKUP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const crypto = require('crypto');
const { randomBytes } = crypto;
      const newCode = Array.from({ length: 6 }, () => {
        let b;
        do { b = randomBytes(1)[0]; } while (b >= 216);
        return PICKUP_CHARS[b % 36];
      }).join('');
      pickupCodePatch = `, pickup_code = '${newCode}'`;
      console.log(`[ORDERS] pickup_code auto-généré pour ${order.reference}: ${newCode}`);
    }

    await client.query(
      `UPDATE orders SET status = $1${tsUpdate}${pickupCodePatch}, updated_at = NOW() WHERE id = $2`,
      [status, order.id]
    );

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

router.patch('/:id/cost', authenticate, requireRole(['admin']), async (req, res) => {
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

module.exports = router;
