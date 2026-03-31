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
const { sendSMS } = require('../utils/sms');

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

const { randomBytes } = require('crypto');

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
    if (!items.length) {
      return res.status(400).json({ error: 'items[] obligatoire (min 1 article)' });
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
    const { rows: products } = await client.query(
      'SELECT * FROM products WHERE id = ANY($1) AND is_active = TRUE',
      [productIds]
    );
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    // ── Vérifier stock + calculer totaux ────────────────────────────────────
    let total_kmf        = 0;
    let cost_estimated   = 0;

    for (const item of items) {
      const product = productMap[item.product_id];
      if (!product) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Produit introuvable : ${item.product_id}` });
      }
      const qty = item.quantity || 1;
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
    const cash_ref_code = payment_mode === 'cash_relais'
      ? (100000 + (randomBytes(3).readUIntBE(0, 3) % 900000)).toString()
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
         cost_estimated_kmf, margin_estimated_pct
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
         $25,$26
       ) RETURNING *`,
      [
        uuidv4(), reference, req.user.id, recipient_id, relais?.id || null,
        total_kmf, parseFloat((total_kmf / 492).toFixed(2)),
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
      const qty     = item.quantity || 1;

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

    res.status(201).json({
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
    // cash_ref_code est masqué pour tous les accès publics (toujours false ici).
    // Les agents accèdent aux détails complets via GET /api/admin/orders.
    const isAdmin = req.user && ['admin', 'agent_relais', 'agent_hub'].includes(req.user.role);

    res.json({
      id:                  order.id,
      reference:           order.reference,
      status:              order.status,
      total_kmf:           order.total_kmf,
      total_eur:           order.total_eur,
      payment_mode:        order.payment_mode,
      payment_status:      order.payment_status,
      // cash_ref_code exposé uniquement aux agents et admins
      ...(isAdmin ? { cash_ref_code: order.cash_ref_code } : {}),
      confection_type:     order.confection_type,
      module_type:         order.module_type,
      module_size:         order.module_size,
      module_retouche:     order.module_retouche,
      purchasing_at:       order.purchasing_at,
      shipped_at:          order.shipped_at,
      transit_comores_at:  order.transit_comores_at,
      available_at:        order.available_at,
      collected_at:        order.collected_at,
      created_at:          order.created_at,
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

    await client.query(
      `UPDATE orders SET status = $1${tsUpdate}, updated_at = NOW() WHERE id = $2`,
      [status, order.id]
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [order.id, status, note || null, req.user.id]
    );

    await client.query('COMMIT');

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
    const { cost_real_kmf, customs_real_kmf, customs_agent_id, customs_notes, sh_category } = req.body;

    if (!cost_real_kmf) return res.status(400).json({ error: 'cost_real_kmf obligatoire' });

    const { rows: [order] } = await db.query(
      'SELECT * FROM orders WHERE id = $1', [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Mise à jour coût réel (le trigger compute_real_margin recalcule margin_real_pct)
    await db.query(
      `UPDATE orders SET cost_real_kmf = $1, updated_at = NOW() WHERE id = $2`,
      [cost_real_kmf, order.id]
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
              margin_alert, sourcing_blocked, cost_delta_pct
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
