/**
 * KOMERCE — Commandes v7.2
 *
 * POST  /api/orders               → créer une commande (client authentifié)
 * GET   /api/orders               → liste des commandes du client connecté
 * GET   /api/orders/:ref          → détail + suivi public par référence
 * PATCH /api/orders/:id/status    → changer statut (admin/agent_hub/agent_relais)
 * PATCH /api/orders/:id/cost      → saisir le coût réel (admin)
 * GET   /api/orders/:id/history   → historique statuts
 *
 * Corrections v7.2 vs v7.1 :
 *   · Architecture orders + order_items (product_id/quantity/price sur order_items)
 *   · payment_mode enum : 'stripe_eur' | 'cash_relais' (pas 'stripe')
 *   · status initial : 'confirmed' (pas 'ordered' — absent de l'enum réel)
 *   · ORDER_STATUSES aligné sur l'enum PostgreSQL réel
 *   · scans : colonne 'step' (pas 'scan_step') + scan_code NOT NULL
 *   · customs_history : sans customs_delta_pct (colonne GENERATED)
 *   · ceremony_* : lus depuis req.body et persistés dans order_items
 *   · recipients : créé ou réutilisé depuis recipient_name/phone
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendSMS } = require('../utils/sms');

// ─── Constantes alignées sur l'enum PostgreSQL réel ──────────────────────────

const ORDER_STATUSES = [
  'draft',
  'confirmed',
  'paid',
  'purchasing',
  'preparation',
  'shipped',
  'transit_comores',
  'available',
  'collected',
  'cancelled',
  'refunded',
];

// ceremony_order_type enum v7.2
const CEREMONY_TYPES = ['ready_made', 'fabric_only', 'custom_from_fabric'];

const STATUS_SMS = {
  confirmed:        (ref) => `Komerce : Commande ${ref} confirmée ! Nous achetons votre article dans les 48h.`,
  purchasing:       (ref) => `Komerce : Commande ${ref} — nous achetons votre article actuellement.`,
  preparation:      (ref) => `Komerce : Commande ${ref} — colis en cours de préparation au hub.`,
  shipped:          (ref) => `Komerce : Commande ${ref} — votre colis a pris la mer ! Arrivée estimée 3–5 semaines.`,
  transit_comores:  (ref) => `Komerce : Commande ${ref} — colis arrivé aux Comores, en cours de dédouanement.`,
  available:        (ref, relais) => `Komerce : Commande ${ref} disponible au relais ${relais || ''}. Venez le récupérer !`,
  collected:        (ref) => `Komerce : Commande ${ref} remise. Merci de votre confiance ! 🎉`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRef() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return 'K' + Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

async function getUniqueRef() {
  let ref, exists;
  do {
    ref = generateRef();
    const { rows } = await db.query('SELECT id FROM orders WHERE reference = $1', [ref]);
    exists = rows.length > 0;
  } while (exists);
  return ref;
}

// ─── POST /api/orders ─────────────────────────────────────────────────────────
// Corps attendu :
//   items[]              → [{ product_id, quantity, ceremony_order_type?,
//                             ceremony_fabric_id?, ceremony_fabric_type?,
//                             ceremony_size?, ceremony_retouche?,
//                             ceremony_qty_meters?, ceremony_accessories? }]
//   relais_id            → UUID relais de livraison
//   payment_mode         → 'stripe_eur' | 'cash_relais'
//   recipient_name       → nom du destinataire
//   recipient_phone      → téléphone du destinataire
//   confection_type      → 'aucun' | 'retouche_locale' | 'sur_mesure' | 'broderie'
//   confection_instructions, confection_delay_days, confection_artisan_id
//   ceremony_order_type  → si commande cérémonie globale
//   ceremony_*           → autres champs cérémonie au niveau commande

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
      // Couture / cérémonie niveau commande
      confection_type           = 'aucun',
      confection_instructions,
      confection_delay_days     = 0,
      confection_artisan_id,
      // Cérémonie v7.2 niveau commande (optionnel — sinon porté par items)
      ceremony_order_type,
      ceremony_fabric_id,
      ceremony_fabric_type,
      ceremony_size,
      ceremony_retouche         = false,
      ceremony_qty_meters,
      ceremony_accessories,
    } = req.body;

    // ── Validation ──────────────────────────────────────────────────────────
    if (!items.length) {
      return res.status(400).json({ error: 'items[] obligatoire (min 1 article)' });
    }
    if (!['stripe_eur', 'cash_relais'].includes(payment_mode)) {
      return res.status(400).json({ error: 'payment_mode invalide — valeurs : stripe_eur | cash_relais' });
    }
    if (ceremony_order_type && !CEREMONY_TYPES.includes(ceremony_order_type)) {
      return res.status(400).json({ error: `ceremony_order_type invalide. Valeurs : ${CEREMONY_TYPES.join(', ')}` });
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
    const cash_ref_code = payment_mode === 'cash_relais'
      ? Math.floor(100000 + Math.random() * 900000).toString()
      : null;

    // ── Créer la commande ───────────────────────────────────────────────────
    const reference = await getUniqueRef();

    const { rows: [order] } = await client.query(
      `INSERT INTO orders (
         id, reference, user_id, recipient_id, relais_id,
         total_kmf, total_eur,
         payment_mode, payment_status, stripe_payment_id,
         cash_ref_code,
         status,
         confection_type, confection_instructions,
         confection_delay_days, confection_artisan_id,
         ceremony_order_type, ceremony_fabric_id, ceremony_fabric_type,
         ceremony_size, ceremony_retouche, ceremony_qty_meters, ceremony_accessories,
         cost_estimated_kmf, margin_estimated_pct
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,
         $8,$9,$10,
         $11,
         'confirmed',
         $12,$13,
         $14,$15,
         $16,$17,$18,
         $19,$20,$21,$22,
         $23,$24
       ) RETURNING *`,
      [
        uuidv4(), reference, req.user.id, recipient_id, relais?.id || null,
        total_kmf, parseFloat((total_kmf / 492).toFixed(2)),
        payment_mode,
        payment_mode === 'stripe_eur' ? 'paid' : 'pending',
        stripe_payment_intent || null,
        cash_ref_code,
        confection_type,
        confection_instructions || null,
        confection_delay_days,
        confection_artisan_id || null,
        ceremony_order_type || null,
        ceremony_fabric_id  || null,
        ceremony_fabric_type || null,
        ceremony_size        || null,
        ceremony_retouche,
        ceremony_qty_meters  || null,
        ceremony_accessories ? JSON.stringify(ceremony_accessories) : null,
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
           ceremony_order_type, ceremony_fabric_id, ceremony_fabric_type,
           ceremony_size, ceremony_retouche, ceremony_qty_meters, ceremony_accessories
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          order.id, item.product_id, qty, product.price_kmf,
          item.ceremony_order_type || null,
          item.ceremony_fabric_id  || null,
          item.ceremony_fabric_type || null,
          item.ceremony_size        || null,
          item.ceremony_retouche    || false,
          item.ceremony_qty_meters  || null,
          item.ceremony_accessories ? JSON.stringify(item.ceremony_accessories) : null,
        ]
      );

      // Décrémenter stock
      if (product.stock !== null) {
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
      sendSMS(smsPhone, STATUS_SMS.confirmed(reference), 'confirmation', order.id)
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
        ceremony_order_type: order.ceremony_order_type,
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
         o.confection_type, o.ceremony_order_type,
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
    const field  = isUuid ? 'o.id' : 'o.reference';

    const { rows: [order] } = await db.query(
      `SELECT
         o.*,
         r.name    AS relais_name,
         r.address AS relais_address,
         r.phone   AS relais_phone,
         r.hours   AS relais_hours,
         r.zone    AS relais_zone
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE ${field} = $1`,
      [req.params.ref]
    );

    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Articles de la commande
    const { rows: items } = await db.query(
      `SELECT
         oi.id, oi.quantity, oi.price_kmf,
         oi.ceremony_order_type, oi.ceremony_fabric_type,
         oi.ceremony_size, oi.ceremony_retouche,
         oi.ceremony_qty_meters, oi.ceremony_accessories,
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

    res.json({
      id:                  order.id,
      reference:           order.reference,
      status:              order.status,
      total_kmf:           order.total_kmf,
      total_eur:           order.total_eur,
      payment_mode:        order.payment_mode,
      payment_status:      order.payment_status,
      cash_ref_code:       order.cash_ref_code,
      confection_type:     order.confection_type,
      ceremony_order_type: order.ceremony_order_type,
      ceremony_size:       order.ceremony_size,
      ceremony_retouche:   order.ceremony_retouche,
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

    // Timestamp correspondant au statut
    const tsField = {
      purchasing:      'purchasing_at',
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
