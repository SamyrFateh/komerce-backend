/**
 * KOMERCE — Commandes v7.1
 *
 * POST /api/orders               → créer une commande (client authentifié)
 * GET  /api/orders               → liste des commandes du client connecté
 * GET  /api/orders/:ref          → détail + suivi public par référence
 * PATCH /api/orders/:id/status   → changer statut (admin/agent_hub/agent_relais)
 * PATCH /api/orders/:id/cost     → saisir le coût réel (admin) — déclenche marge réelle
 * POST  /api/scans               → scanner un colis (agent_hub ou relais)
 * GET  /api/orders/:id/history   → historique statuts de la commande
 */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendSMS } = require('../utils/sms');

// ─── Constantes v7.1 ─────────────────────────────────────────────────────────

const ORDER_STATUSES = [
  'ordered',
  'purchasing',
  'preparation',
  'shipped',
  'transit_comores',
  'available',
  'collected',
  'cancelled',
];

// Pré-confection tailles standards + retouches locales uniquement
// (pas de sur-mesure ni broderie — ajustements locaux seulement)
const CONFECTION_TYPES = [
  'aucun',
  'retouche_locale',  // taille standard commandée, ajustée par artisan local
];

const STATUS_SMS = {
  ordered:          (ref) => `Komerce : Commande ${ref} confirmée ! Nous achetons votre article dans les 48h.`,
  purchasing:       (ref) => `Komerce : Commande ${ref} — nous achetons votre article actuellement.`,
  preparation:      (ref) => `Komerce : Commande ${ref} — colis en cours de préparation au hub.`,
  shipped:          (ref) => `Komerce : Commande ${ref} — votre colis a pris la mer ! Arrivée estimée 3–5 semaines.`,
  transit_comores:  (ref) => `Komerce : Commande ${ref} — colis arrivé aux Comores, en cours de dédouanement.`,
  available:        (ref, relais) => `Komerce : Commande ${ref} disponible au relais ${relais || ''}. Venez le récupérer !`,
  collected:        (ref) => `Komerce : Commande ${ref} remise. Merci de votre confiance ! 🎉`,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── POST /api/orders ────────────────────────────────────────────────────────

router.post('/', authenticate, async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const {
      product_id,
      quantity              = 1,
      relais_id,
      payment_mode,           // 'stripe' | 'cash_relais'
      stripe_payment_intent,
      recipient_name,
      recipient_phone,
      is_gift               = false,
      gift_message,
      // Couture v7.1
      confection_type       = 'aucun',
      confection_instructions,
      confection_delay_days,
      // Diaspora info
      sender_name,
      sender_phone,
    } = req.body;

    // Validation
    if (!product_id) {
      return res.status(400).json({ error: 'product_id obligatoire' });
    }
    if (!['stripe', 'cash_relais'].includes(payment_mode)) {
      return res.status(400).json({ error: 'payment_mode invalide (stripe | cash_relais)' });
    }
    if (!CONFECTION_TYPES.includes(confection_type)) {
      return res.status(400).json({ error: `confection_type invalide. Valeurs : ${CONFECTION_TYPES.join(', ')}` });
    }

    // Récupérer le produit
    const { rows: [product] } = await client.query(
      'SELECT * FROM products WHERE id = $1 AND is_active = TRUE',
      [product_id]
    );
    if (!product) {
      return res.status(404).json({ error: 'Produit introuvable ou inactif' });
    }

    // Vérifier stock
    if (product.stock !== null && product.stock < quantity) {
      return res.status(409).json({
        error: `Stock insuffisant — disponible : ${product.stock}`,
        available_stock: product.stock,
      });
    }

    // Récupérer relais
    let relais = null;
    if (relais_id) {
      const { rows: [r] } = await client.query(
        'SELECT * FROM relais WHERE id = $1 AND is_active = TRUE',
        [relais_id]
      );
      if (!r) return res.status(404).json({ error: 'Relais introuvable' });
      relais = r;
    } else {
      // Assigner le premier relais disponible si aucun fourni
      const { rows: [r] } = await client.query(
        `SELECT * FROM relais WHERE is_active = TRUE ORDER BY id LIMIT 1`
      );
      relais = r;
    }

    // Calculer montants
    const unit_price_kmf = product.price_kmf;
    const total_kmf      = unit_price_kmf * quantity;

    // Estimer coût (sourcing + fret + douane estimée)
    const customs_rate   = product.customs_risk_coeff || 1.0;
    const fret_per_kg    = 65; // KMF/kg estimé
    const fret_kmf       = (product.weight_kg || 0.5) * quantity * fret_per_kg;
    const customs_base   = (product.price_aed || 0) * 138 * quantity; // en KMF
    const customs_est    = customs_base * 0.20 * customs_rate;        // taux moyen 20%
    const cost_estimated = (product.price_aed || 0) * 138 * quantity + fret_kmf + customs_est;
    const margin_est     = total_kmf > 0
      ? ((total_kmf - cost_estimated) / total_kmf * 100).toFixed(2)
      : 0;

    // Générer référence unique
    const reference = await getUniqueRef();

    // Code cash si paiement relais
    const cash_ref_code = payment_mode === 'cash_relais'
      ? Math.floor(100000 + Math.random() * 900000).toString()
      : null;

    // Créer la commande
    const { rows: [order] } = await client.query(
      `INSERT INTO orders (
         id, reference, user_id, product_id, quantity,
         unit_price_kmf, total_kmf,
         relais_id,
         payment_mode, payment_status, stripe_payment_intent,
         cash_ref_code,
         recipient_name, recipient_phone,
         sender_name, sender_phone,
         is_gift, gift_message,
         confection_type, confection_instructions, confection_delay_days,
         cost_estimated_kmf, margin_estimated_pct,
         status, ordered_at
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,
         $8,
         $9,$10,$11,
         $12,
         $13,$14,
         $15,$16,
         $17,$18,
         $19,$20,$21,
         $22,$23,
         'ordered', NOW()
       ) RETURNING *`,
      [
        uuidv4(), reference, req.user.id, product_id, quantity,
        unit_price_kmf, total_kmf,
        relais ? relais.id : null,
        payment_mode,
        payment_mode === 'stripe' ? 'paid' : 'pending',
        stripe_payment_intent || null,
        cash_ref_code,
        recipient_name || req.user.full_name,
        recipient_phone || req.user.phone,
        sender_name || null,
        sender_phone || null,
        is_gift,
        gift_message || null,
        confection_type,
        confection_instructions || null,
        confection_delay_days || null,
        Math.round(cost_estimated),
        Number(margin_est),
      ]
    );

    // Historiser le statut initial
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'ordered', 'Commande créée', $2)`,
      [order.id, req.user.id]
    );

    // Décrémenter stock
    if (product.stock !== null) {
      await client.query(
        'UPDATE products SET stock = stock - $1 WHERE id = $2',
        [quantity, product_id]
      );
    }

    await client.query('COMMIT');

    // SMS de confirmation (async — ne bloque pas la réponse)
    const smsPhone = sender_phone || req.user.phone;
    if (smsPhone) {
      sendSMS(
        smsPhone,
        STATUS_SMS.ordered(reference),
        'confirmation',
        order.id
      ).catch(console.error);
    }

    res.status(201).json({
      order: {
        id:             order.id,
        reference:      order.reference,
        status:         order.status,
        total_kmf:      order.total_kmf,
        payment_mode:   order.payment_mode,
        payment_status: order.payment_status,
        cash_ref_code:  order.cash_ref_code,
        confection_type: order.confection_type,
        relais:         relais ? { id: relais.id, name: relais.name, address: relais.address } : null,
        created_at:     order.created_at,
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

    const { rows } = await db.query(
      `SELECT
         o.id, o.reference, o.status, o.total_kmf,
         o.payment_mode, o.payment_status,
         o.confection_type,
         o.created_at,
         p.name AS product_name, p.image_url,
         r.name AS relais_name
       FROM orders o
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN relais   r ON r.id = o.relais_id
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
         p.name      AS product_name,
         p.image_url AS product_image,
         p.category  AS product_category,
         p.has_couture,
         r.name      AS relais_name,
         r.address   AS relais_address,
         r.phone     AS relais_phone,
         r.hours     AS relais_hours,
         r.zone      AS relais_zone
       FROM orders  o
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN relais   r ON r.id = o.relais_id
       WHERE ${field} = $1`,
      [req.params.ref]
    );

    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Historique des statuts
    const { rows: history } = await db.query(
      `SELECT status, note, created_at
       FROM order_status_history
       WHERE order_id = $1
       ORDER BY created_at ASC`,
      [order.id]
    );

    // Masquer les champs sensibles si accès public (pas de token)
    const safeOrder = {
      id:               order.id,
      reference:        order.reference,
      status:           order.status,
      total_kmf:        order.total_kmf,
      payment_mode:     order.payment_mode,
      payment_status:   order.payment_status,
      cash_ref_code:    order.cash_ref_code,
      confection_type:  order.confection_type,
      ordered_at:       order.ordered_at,
      purchasing_at:    order.purchasing_at,
      shipped_at:       order.shipped_at,
      transit_comores_at: order.transit_comores_at,
      available_at:     order.available_at,
      collected_at:     order.collected_at,
      product: {
        name:     order.product_name,
        image:    order.product_image,
        category: order.product_category,
      },
      relais: order.relais_name ? {
        name:    order.relais_name,
        address: order.relais_address,
        phone:   order.relais_phone,
        hours:   order.relais_hours,
        zone:    order.relais_zone,
      } : null,
      history,
    };

    res.json(safeOrder);

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

    // Récupérer commande actuelle
    const { rows: [order] } = await client.query(
      `SELECT o.*, r.name AS relais_name, u.phone AS user_phone
       FROM orders  o
       LEFT JOIN relais r ON r.id = o.relais_id
       LEFT JOIN users  u ON u.id = o.user_id
       WHERE o.id = $1`,
      [req.params.id]
    );

    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Construire la mise à jour du timestamp correspondant
    const tsField = {
      ordered:          'ordered_at',
      purchasing:       'purchasing_at',
      preparation:      null,
      shipped:          'shipped_at',
      transit_comores:  'transit_comores_at',
      available:        'available_at',
      collected:        'collected_at',
      cancelled:        'cancelled_at',
    }[status];

    const tsUpdate = tsField ? `, ${tsField} = NOW()` : '';

    await client.query(
      `UPDATE orders SET status = $1${tsUpdate}, updated_at = NOW()
       WHERE id = $2`,
      [status, order.id]
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [order.id, status, note || null, req.user.id]
    );

    await client.query('COMMIT');

    // SMS notification
    const smsPhone = order.sender_phone || order.user_phone;
    if (smsPhone && STATUS_SMS[status]) {
      sendSMS(
        smsPhone,
        STATUS_SMS[status](order.reference, order.relais_name),
        status,
        order.id
      ).catch(console.error);
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

// ─── PATCH /api/orders/:id/cost — saisie coût réel (admin) ───────────────────

router.patch('/:id/cost', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const {
      cost_real_kmf,
      customs_real_kmf,
      customs_agent_id,
      customs_notes,
    } = req.body;

    if (!cost_real_kmf) {
      return res.status(400).json({ error: 'cost_real_kmf obligatoire' });
    }

    const { rows: [order] } = await db.query(
      'SELECT * FROM orders WHERE id = $1', [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Calculer delta douane
    const est = order.customs_estimated_kmf || 0;
    const delta = est > 0
      ? ((customs_real_kmf - est) / est * 100).toFixed(2)
      : null;

    await db.query(
      `UPDATE orders SET
         cost_real_kmf       = $1,
         cost_delta_pct      = $2,
         cost_closed_at      = NOW(),
         updated_at          = NOW()
       WHERE id = $3`,
      [cost_real_kmf, delta, order.id]
    );

    // Créer entrée customs_history
    if (customs_real_kmf) {
      await db.query(
        `INSERT INTO customs_history
           (order_id, customs_estimated_kmf, customs_real_kmf,
            customs_delta_pct, customs_agent_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          order.id,
          order.customs_estimated_kmf || null,
          customs_real_kmf,
          delta,
          customs_agent_id || null,
          customs_notes || null,
        ]
      );
    }

    // Le trigger PostgreSQL trg_compute_real_margin recalcule margin_real_pct automatiquement
    // Récupérer la commande mise à jour
    const { rows: [updated] } = await db.query(
      'SELECT id, reference, cost_real_kmf, margin_real_pct, margin_alert, sourcing_blocked FROM orders WHERE id = $1',
      [req.params.id]
    );

    res.json({ success: true, order: updated });

  } catch (err) {
    console.error('Update cost error:', err.message);
    res.status(500).json({ error: 'Erreur saisie coût réel' });
  }
});

// ─── POST /api/scans — scan physique colis ────────────────────────────────────

router.post('/scans', authenticate, requireRole(['admin', 'agent_hub', 'agent_relais']), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { reference, scan_step, location, notes } = req.body;

    // Étapes de scan v7.1
    const SCAN_STEPS = {
      hub_preparation:   { status: 'preparation', label: 'Hub — colis prêt' },       // étape 3
      relais_reception:  { status: 'available',   label: 'Relais — réception'  },    // étape 6
      client_collection: { status: 'collected',   label: 'Remise client QR'    },    // étape 7
    };

    if (!SCAN_STEPS[scan_step]) {
      return res.status(400).json({
        error: `scan_step invalide. Valeurs : ${Object.keys(SCAN_STEPS).join(', ')}`,
      });
    }

    const { rows: [order] } = await client.query(
      `SELECT o.*, r.name AS relais_name, u.phone AS user_phone, u.phone AS sender_phone_fallback
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
       LEFT JOIN users  u ON u.id = o.user_id
       WHERE o.reference = $1`,
      [reference]
    );

    if (!order) return res.status(404).json({ error: `Commande ${reference} introuvable` });

    const step = SCAN_STEPS[scan_step];

    // Enregistrer le scan
    await client.query(
      `INSERT INTO scans (order_id, scan_step, scanned_by, location, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [order.id, scan_step, req.user.id, location || null, notes || null]
    );

    // Mettre à jour le statut commande
    const tsField = {
      preparation: null,
      available:   'available_at',
      collected:   'collected_at',
    }[step.status];

    const tsUpdate = tsField ? `, ${tsField} = NOW()` : '';

    await client.query(
      `UPDATE orders SET status = $1${tsUpdate}, updated_at = NOW() WHERE id = $2`,
      [step.status, order.id]
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [order.id, step.status, `Scan ${scan_step} — ${step.label}`, req.user.id]
    );

    await client.query('COMMIT');

    // SMS
    const smsPhone = order.sender_phone || order.user_phone;
    if (smsPhone && STATUS_SMS[step.status]) {
      sendSMS(
        smsPhone,
        STATUS_SMS[step.status](reference, order.relais_name),
        step.status,
        order.id
      ).catch(console.error);
    }

    res.json({
      success: true,
      reference,
      scan_step,
      new_status: step.status,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Scan error:', err.message);
    res.status(500).json({ error: 'Erreur scan' });
  } finally {
    client.release();
  }
});

// ─── GET /api/orders/:id/history ──────────────────────────────────────────────

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
