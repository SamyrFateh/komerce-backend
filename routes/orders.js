/**
 * KOMERCE — Routes commandes
 *
 * POST /api/orders                    → créer une commande
 * GET  /api/orders/:reference         → détail commande (client)
 * GET  /api/orders/:reference/tracking → suivi logistique public
 * GET  /api/orders                    → liste toutes les commandes (admin)
 * PUT  /api/orders/:reference/cancel  → annuler une commande
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { generateOrderRef, generateCashCode, generatePickupCode } = require('../utils/reference');
const { sendSMS } = require('../utils/sms');
const QRCode = require('qrcode');

// ── POST /api/orders ──────────────────────────────────────────────────────────
// Crée une commande à partir d'un panier ou d'une liste d'articles.
// Body : { items, recipient_id, relais_id, payment_mode, currency }
router.post('/', authenticate, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { items, recipient_id, relais_id, payment_mode, currency } = req.body;

    // Validation
    if (!items?.length || !recipient_id || !relais_id || !payment_mode) {
      return res.status(400).json({ error: 'items, recipient_id, relais_id et payment_mode sont requis' });
    }
    if (!['stripe_eur', 'cash_relais'].includes(payment_mode)) {
      return res.status(400).json({ error: 'payment_mode invalide' });
    }

    // Récupérer les produits et calculer le total
    const productIds = items.map(i => i.product_id);
    const { rows: products } = await client.query(
      'SELECT id, name, price_kmf, stock FROM products WHERE id = ANY($1) AND is_active = TRUE',
      [productIds]
    );

    const productMap = {};
    for (const p of products) productMap[p.id] = p;

    let total_kmf = 0;
    for (const item of items) {
      const product = productMap[item.product_id];
      if (!product) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Produit ${item.product_id} introuvable` });
      }
      if (product.stock < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Stock insuffisant pour ${product.name}` });
      }
      total_kmf += product.price_kmf * item.quantity;
    }

    // Récupérer le taux de change actuel
    const { rows: rates } = await client.query(
      'SELECT * FROM exchange_rates ORDER BY valid_from DESC LIMIT 1'
    );
    const rate = rates[0] || { eur_kmf: 492, aed_kmf: 138 };
    const total_eur = (total_kmf / rate.eur_kmf).toFixed(2);
    const total_aed = (total_kmf / rate.aed_kmf).toFixed(2);

    // Générer les codes
    const reference    = generateOrderRef();
    const cash_ref     = payment_mode === 'cash_relais' ? generateCashCode()  : null;
    const pickup_code  = generatePickupCode();

    // Générer le QR code cash relais (contient la référence + code cash)
    let cash_qr_data = null;
    if (payment_mode === 'cash_relais') {
      cash_qr_data = await QRCode.toDataURL(
        JSON.stringify({ ref: reference, code: cash_ref })
      );
    }

    // ── Statut initial selon mode de paiement ────────────────────────────────
    // Cash relais : en attente de paiement — le stock n'est PAS encore réservé
    // Stripe/PayPal : confirmée immédiatement après paiement front
    const initialStatus        = payment_mode === 'cash_relais' ? 'confirmed' : 'confirmed';
    const initialPaymentStatus = payment_mode === 'cash_relais' ? 'pending'   : 'pending';
    // Note spec v6.4 : le flux cash relais est :
    //   created (confirmed + payment pending) → client paie au relais
    //   → POST /api/payments/cash/confirm → payment_status = paid → status = paid
    //   → agent Dubai reçoit le bon → purchasing → packing → shipped...
    // Le STOCK est décrémenté uniquement à la confirmation du paiement cash.
    // Pour Stripe, le stock est décrémenté ici car le paiement est immédiat.

    // Créer la commande
    const { rows: [order] } = await client.query(
      `INSERT INTO orders
        (reference, user_id, recipient_id, relais_id,
         total_kmf, total_eur, total_aed,
         payment_mode, payment_status,
         cash_ref_code, cash_qr_data, pickup_code, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [reference, req.user.id, recipient_id, relais_id,
       total_kmf, total_eur, total_aed,
       payment_mode, initialPaymentStatus,
       cash_ref, cash_qr_data, pickup_code, initialStatus]
    );

    // Créer les lignes de commande
    for (const item of items) {
      const product = productMap[item.product_id];
      const scan_code = `KOM-ITEM-${order.id.slice(0,4).toUpperCase()}${item.product_id.slice(0,4).toUpperCase()}`;

      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price_kmf, scan_code)
         VALUES ($1,$2,$3,$4,$5)`,
        [order.id, item.product_id, item.quantity, product.price_kmf, scan_code]
      );

      // Décrémenter le stock uniquement pour Stripe (paiement immédiat)
      // Pour cash relais : décrémenté dans POST /payments/cash/confirm
      if (payment_mode !== 'cash_relais') {
        await client.query(
          'UPDATE products SET stock = stock - $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }
    }

    // Historique statut initial
    const histNote = payment_mode === 'cash_relais'
      ? 'Commande créée — en attente paiement espèces au relais'
      : 'Commande créée — paiement en ligne en cours';
    await client.query(
      `INSERT INTO order_status_history (order_id, status, changed_by, note)
       VALUES ($1,$2,$3,$4)`,
      [order.id, initialStatus, req.user.id, histNote]
    );

    await client.query('COMMIT');

    // SMS selon mode paiement
    if (req.user.phone) {
      const msg = payment_mode === 'cash_relais'
        ? `Komerce · Commande ${reference} créée. Rendez-vous au relais avec le code : ${cash_ref}. Total à payer : ${total_kmf.toLocaleString('fr-FR')} KMF. Délai : 24h.`
        : `Komerce · Commande ${reference} en cours. Total : ${total_eur} EUR. Suivi sur komerce.km`;
      await sendSMS(req.user.phone, msg, 'confirmation', order.id);
    }

    res.status(201).json({
      reference,
      order_id:      order.id,
      total_kmf,
      total_eur,
      payment_mode,
      cash_ref_code: cash_ref,
      cash_qr_data,
      status:        initialStatus,
      payment_status: initialPaymentStatus,
      message: payment_mode === 'cash_relais'
        ? `Présentez-vous au relais avec le code ${cash_ref} pour valider et payer votre commande.`
        : 'Finalisez le paiement en ligne pour confirmer votre commande.',
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la création de la commande' });
  } finally {
    client.release();
  }
});

// ── GET /api/orders/:reference ────────────────────────────────────────────────
// Détail complet d'une commande (client authentifié ou admin)
router.get('/:reference', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT o.*,
              r.name  AS relais_name,
              r.phone AS relais_phone,
              r.address AS relais_address,
              rc.full_name AS recipient_name,
              rc.phone     AS recipient_phone
       FROM orders o
       LEFT JOIN relais    r  ON r.id  = o.relais_id
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       WHERE o.reference = $1`,
      [req.params.reference]
    );
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });

    const order = rows[0];

    // Sécurité : un client ne peut voir que ses propres commandes
    if (req.user.role === 'client' && order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Récupérer les articles
    const { rows: items } = await db.query(
      `SELECT oi.*, p.name, p.emoji, p.category
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [order.id]
    );

    res.json({ ...order, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/orders/:reference/tracking ──────────────────────────────────────
// Suivi logistique public (pas besoin d'être connecté — on vérifie juste la ref)
// Utilisé par l'interface client pour afficher la timeline
router.get('/:reference/tracking', async (req, res) => {
  try {
    const { rows: orders } = await db.query(
      `SELECT o.id, o.reference, o.status, o.relais_id,
              o.shipped_at, o.available_at, o.collected_at,
              r.name AS relais_name, r.address AS relais_address
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE o.reference = $1`,
      [req.params.reference]
    );
    if (!orders.length) return res.status(404).json({ error: 'Commande introuvable' });

    const order = orders[0];

    // Récupérer l'historique des scans
    const { rows: history } = await db.query(
      `SELECT s.step, s.location, s.created_at, s.is_anomaly
       FROM scans s
       WHERE s.order_id = $1
       ORDER BY s.created_at ASC`,
      [order.id]
    );

    // Labels lisibles par étape
    const stepLabels = {
      preparation:     'Préparé',
      shipped:         'Expédié',
      relais_received: 'Disponible au relais',
      collected:       'Récupéré',
    };

    // Prochaine étape attendue
    const chain  = ['preparation', 'shipped', 'relais_received', 'collected'];
    const done   = history.map(h => h.step);
    const lastDone = done[done.length - 1];
    const nextIdx  = chain.indexOf(lastDone) + 1;
    const nextStep = nextIdx < chain.length ? chain[nextIdx] : null;

    res.json({
      reference:  order.reference,
      status:     order.status,
      relais:     order.relais_name,
      address:    order.relais_address,
      timeline:   history.map(h => ({
        step:     h.step,
        label:    stepLabels[h.step] || h.step,
        at:       h.created_at,
        location: h.location,
        anomaly:  h.is_anomaly,
      })),
      next: nextStep ? { step: nextStep, label: stepLabels[nextStep] } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/orders ───────────────────────────────────────────────────────────
// Liste toutes les commandes — admin uniquement
// Query params : ?status=shipped | ?payment_mode=cash_relais
router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { status, payment_mode } = req.query;
    let sql    = `SELECT o.*, r.name AS relais_name, rc.full_name AS recipient_name
                  FROM orders o
                  LEFT JOIN relais     r  ON r.id  = o.relais_id
                  LEFT JOIN recipients rc ON rc.id = o.recipient_id
                  WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (status)       { sql += ` AND o.status = $${idx++}`;       params.push(status); }
    if (payment_mode) { sql += ` AND o.payment_mode = $${idx++}`; params.push(payment_mode); }

    sql += ' ORDER BY o.created_at DESC LIMIT 100';

    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/orders/:reference/cancel ────────────────────────────────────────
// Annuler une commande (client ou admin, avant expédition seulement)
router.put('/:reference/cancel', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM orders WHERE reference = $1',
      [req.params.reference]
    );
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });

    const order = rows[0];

    // Seul le propriétaire ou un admin peut annuler
    if (req.user.role === 'client' && order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // On ne peut pas annuler une commande déjà expédiée
    if (['shipped', 'available', 'collected'].includes(order.status)) {
      return res.status(400).json({ error: 'Impossible d\'annuler une commande déjà expédiée' });
    }

    const { reason } = req.body;

    await db.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $1
       WHERE id = $2`,
      [reason || null, order.id]
    );

    await db.query(
      `INSERT INTO order_status_history (order_id, status, changed_by, note)
       VALUES ($1,'cancelled',$2,$3)`,
      [order.id, req.user.id, reason || 'Annulé par le client']
    );

    res.json({ message: 'Commande annulée', reference: order.reference });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
