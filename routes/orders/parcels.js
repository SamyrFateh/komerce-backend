/**
 * KOMERCE — Expédition partielle & colis (Parcel-Centric v2.0 — Phase 4)
 *
 * POST   /:id/mark-availability      → marquer la disponibilité des articles
 * POST   /:id/partial-ship           → créer une expédition partielle (parcels)
 * GET    /:id/parcels                → liste des colis d'une commande
 * GET    /:id/sub-orders             → backward compat → redirect /parcels
 * PATCH  /parcels/:parcelId/status   → changer statut d'un colis
 * PATCH  /sub-orders/:subId/status   → backward compat
 * POST   /:id/cancel-backorder       → annuler un colis backorder
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const db      = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const { validate }                  = require('../../middleware/validate');
const { orders }                    = require('../../validators');
const { sendSMS }                   = require('../../utils/sms');
const { getRule, getRuleNumber }    = require('../../utils/rules');
const { generateParcelRef }         = require('../../utils/reference');
const { processRefundWithFallback } = require('../../services/refund-service');
const {
  PARCEL_VALID_STATUSES,
  PARCEL_TRANSITIONS,
  PARCEL_SMS,
} = require('../../services/parcel-service');

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
      success:   true,
      reference: order.reference,
      items:     updatedItems,
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
    const orderedAt        = order.ordered_at || order.created_at;
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
      const piId     = uuidv4();
      await client.query(
        `INSERT INTO parcel_items (id, parcel_id, order_item_id, product_id, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [piId, psId, ai.order_item_id, original.product_id, ai.quantity]
      );
      psItems.push({
        id:            piId,
        order_item_id: ai.order_item_id,
        product_name:  original.product_name,
        quantity:      ai.quantity,
        price_kmf:     original.price_kmf,
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

    let boId  = null;
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
          id:            piId,
          order_item_id: boi.id,
          product_name:  boi.product_name,
          quantity:      boi.quantity,
          price_kmf:     boi.price_kmf,
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
      const boCount  = allBackorderItems.reduce((s, i) => s + i.quantity, 0);
      const smsText  = `Komerce : Commande ${order.reference} — expedition partielle : ${availableQty} article(s) expedie(s), ${boCount} en attente (backorder). Ref colis : ${psRef}`;
      sendSMS(order.user_phone, smsText, 'partial_ship', id).catch(console.error);
    }

    // ── Réponse ─────────────────────────────────────────────────────────────
    res.status(201).json({
      success:   true,
      reference: order.reference,
      partial_ship: {
        id:        psId,
        reference: psRef,
        type:      'partial',
        status:    'preparation',
        items:     psItems,
      },
      backorder: boId ? {
        id:        boId,
        reference: boRef,
        type:      'backorder',
        status:    'draft',
        items:     boItems,
        estimated_date: new Date(Date.now() + backorderMaxDays * 24 * 60 * 60 * 1000).toISOString(),
      } : null,
      summary: {
        shipped_qty:   availableQty,
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

// ─── GET /api/orders/:id/sub-orders → backward compat redirect ───────────────

router.get('/:id/sub-orders', authenticate, (req, res) => {
  res.redirect(307, `/api/orders/${req.params.id}/parcels`);
});

// ─── GET /api/orders/:id/parcels ─────────────────────────────────────────────
// Liste les colis d'une commande avec leurs articles.
// Auth : admin, agent_hub, agent_relais, ou propriétaire de la commande.

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
      order_status:    order.status,
      parcels:         enriched,
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
      success:   true,
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

    // Crédit boutique ou remboursement Stripe (avec fallback silencieux)
    let refundResult = null;
    let refundAmountEur = 0;

    if (backorderValueKmf > 0 && order.payment_status === 'paid') {
      const eurKmfRate = order.total_eur && order.total_kmf
        ? Number(order.total_kmf) / Number(order.total_eur)
        : 492;
      refundAmountEur = parseFloat((backorderValueKmf / eurKmfRate).toFixed(2));

      refundResult = await processRefundWithFallback(
        client, order,
        backorderValueKmf, refundAmountEur,
        'partial',
        reason || 'Annulation backorder',
        req.user.id,
        parcelId
      );
    }

    // Historique
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [
        id,
        order.status,
        `Backorder ${parcel.reference} annulé — ${boItems.length} article(s), ${Number(backorderValueKmf).toLocaleString('fr-FR')} KMF ${refundResult?.method === 'stripe' ? 'remboursé (Stripe)' : 'crédité (boutique)'}`,
        req.user.id,
      ]
    );

    await client.query('COMMIT');

    // SMS notification (non bloquant)
    if (order.user_phone) {
      const creditStr = refundResult?.method === 'stripe'
        ? `${refundAmountEur.toFixed(2)}EUR rembourse via Stripe`
        : `${Number(backorderValueKmf).toLocaleString('fr-FR')} KMF credite sur votre compte`;
      const smsText = `Komerce : Backorder ${parcel.reference} annule. ${creditStr}. Merci de votre comprehension.`;
      sendSMS(order.user_phone, smsText, 'backorder_cancelled', id).catch(console.error);
    }

    res.json({
      success:    true,
      reference:  order.reference,
      parcel_ref: parcel.reference,
      cancelled_items: boItems.map(i => ({
        product_name: i.product_name,
        quantity:     i.quantity,
        price_kmf:    i.price_kmf,
      })),
      refund: backorderValueKmf > 0 && refundResult ? {
        amount_kmf:       backorderValueKmf,
        amount_eur:       refundAmountEur,
        method:           refundResult.method,
        stripe_refund_id: refundResult.stripeRefundId,
        store_credit_id:  refundResult.storeCreditId,
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
