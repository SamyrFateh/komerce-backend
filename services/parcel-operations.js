/**
 * @komerce-arch
 * @role          logistics-parcel-operations
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       order_items, orders, parcel_items, parcels, products, relais, users
 * @db-write      order_items, order_status_history, parcel_items, parcels, products
 * @db-write-via:order-status-machine product_variants, order_status_history, products
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Parcel Operations (R4)
 *
 * Extraction de routes/orders/parcels.js : toutes les mutations transactionnelles
 * colis liées aux commandes. La route devient une façade (auth + validation + appel + réponse).
 *
 * Fonctions exportées :
 *   markAvailability(orderId, items, user)       → POST /:id/mark-availability
 *   partialShip(orderId, body, user)             → POST /:id/partial-ship
 *   updateParcelStatus(parcelId, body, user)     → PATCH /parcels/:parcelId/status
 *   cancelBackorder(orderId, body, user)         → POST /:id/cancel-backorder
 *
 * Convention de retour : { status: number, body: object }
 * Les notifications (SMS/push) sont déclenchées APRÈS COMMIT, non bloquantes.
 *
 * Invariants respectés :
 *   I-01 — toute mutation orders.status passe par transitionOrderStatus (SSOT)
 *   I-04 — order_status_history systématiquement alimenté
 *   I-06 — annulation backorder restaure stock ET crédit/refund (via refund-service)
 *   I-09 — colis = unité autonome (pas de dépendance directe hub.js / carriers.js)
 */

const crypto = require('crypto');
const db     = require('../db');

const { notifyText, notifyParcelScan } = require('./notification-service');
const { getRule, getRuleNumber }        = require('../utils/rules');
const { generateParcelRef }             = require('../utils/reference');
const { processRefundWithFallback }     = require('./refund-service');
const { PARCEL_SMS }                    = require('./parcel-service');
const { transitionOrderStatus }         = require('./order-status-machine');
const {
  validateParcelCreate,
  validateSplitItems,
  checkParcelCancellable,
  validateParcelTransition,
} = require('./parcel-guards');

const log = require('../utils/logger').child({ module: 'parcel-operations' });

// ─── markAvailability ─────────────────────────────────────────────────────────
// Marque la disponibilité de chaque article au hub Dubai.
// items : [{ order_item_id, status, reason?, estimated_available_at? }]

async function markAvailability(orderId, items, user) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Vérifier que la commande existe
    const { rows: [order] } = await client.query(
      'SELECT id, reference, status FROM orders WHERE id = $1',
      [orderId]
    );
    if (!order) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Commande introuvable' } };
    }

    // Vérifier que les items appartiennent à la commande
    const itemIds = items.map(i => i.order_item_id);
    const { rows: existingItems } = await client.query(
      'SELECT id FROM order_items WHERE id = ANY($1) AND order_id = $2',
      [itemIds, orderId]
    );
    if (existingItems.length !== itemIds.length) {
      await client.query('ROLLBACK');
      return {
        status: 400,
        body: {
          error: `Certains articles n'appartiennent pas à cette commande`,
          expected: itemIds.length,
          found: existingItems.length,
        },
      };
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

    // Historiser (I-04)
    const availCount = items.filter(i => i.status === 'available').length;
    const delayCount = items.filter(i => i.status === 'delayed').length;
    const boCount    = items.filter(i => i.status === 'backorder').length;

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [
        orderId,
        order.status,
        `Disponibilité mise à jour — ${availCount} disponible(s), ${delayCount} retardé(s), ${boCount} en backorder`,
        user.id,
      ]
    );

    await client.query('COMMIT');

    return {
      status: 200,
      body: {
        success:   true,
        reference: order.reference,
        items:     updatedItems,
      },
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── partialShip ──────────────────────────────────────────────────────────────
// Crée une expédition partielle : colis « partial » + colis « backorder ».
// body : { available_items: [{ order_item_id, quantity }], notes? }

async function partialShip(orderId, body, user) {
  const { available_items, notes } = body;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // ── 1. Valider la commande ──────────────────────────────────────────────
    const { rows: [order] } = await client.query(
      `SELECT o.*, u.phone AS user_phone
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [orderId]
    );

    // ── 2. Charger les règles métier ────────────────────────────────────────
    const delayThresholdDays = await getRuleNumber('PARTIAL_SHIP_DELAY_THRESHOLD_DAYS', 7);
    const minAvailablePct    = await getRuleNumber('PARTIAL_SHIP_MIN_AVAILABLE_PCT', 30);
    const backorderMaxDays   = await getRuleNumber('BACKORDER_MAX_DAYS', 45);
    const autoNotify         = await getRule('PARTIAL_SHIP_AUTO_NOTIFY', true);

    // ── 3. Guards métier (ordre, délai) ─────────────────────────────────────
    const orderedAt        = order ? (order.ordered_at || order.created_at) : null;
    const daysSinceOrdered = orderedAt
      ? (Date.now() - new Date(orderedAt).getTime()) / (1000 * 60 * 60 * 24)
      : 0;

    const createGuard = validateParcelCreate(order, daysSinceOrdered, delayThresholdDays);
    if (!createGuard.ok) {
      await client.query('ROLLBACK');
      return { status: createGuard.status, body: createGuard.body };
    }

    // ── 4. Charger tous les items de la commande ────────────────────────────
    const { rows: allItems } = await client.query(
      `SELECT oi.*, p.name AS product_name, p.price_kmf AS product_price_kmf
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       FOR UPDATE`,
      [orderId]
    );

    // ── 5. Valider les articles disponibles ─────────────────────────────────
    const splitGuard = validateSplitItems(available_items, allItems, minAvailablePct);
    if (!splitGuard.ok) {
      await client.query('ROLLBACK');
      return { status: splitGuard.status, body: splitGuard.body };
    }
    const { availableQty, availPct } = splitGuard;

    const availItemIds = new Set(available_items.map(i => i.order_item_id));

    // ── 6. Générer les références colis ─────────────────────────────────────
    const psRef = await generateParcelRef(db);
    const psId  = crypto.randomUUID();

    // ── 7a. Créer le colis « partial » ─────────────────────────────────────
    await client.query(
      `INSERT INTO parcels (
         id, order_id, type, status, reference, label, relais_id, created_by, notes
       ) VALUES ($1, $2, 'partial', 'preparation', $3, 'Envoi partiel', $4, $5, $6)`,
      [psId, orderId, psRef, order.relais_id, user.id, notes || null]
    );

    const psItems = [];
    for (const ai of available_items) {
      const original = allItems.find(oi => oi.id === ai.order_item_id);
      const piId     = crypto.randomUUID();
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

      await client.query(
        `UPDATE order_items SET availability_status = 'available', updated_at = NOW()
         WHERE id = $1`,
        [ai.order_item_id]
      );
    }

    // ── 7b. Créer le colis « backorder » pour les articles restants ────────
    const backorderItems = allItems.filter(oi => !availItemIds.has(oi.id));
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
      boId  = crypto.randomUUID();

      await client.query(
        `INSERT INTO parcels (
           id, order_id, type, status, reference, label, relais_id, created_by, estimated_date
         ) VALUES ($1, $2, 'backorder', 'draft', $3, 'Reliquat en attente', $4, $5, NOW() + INTERVAL '1 day' * $6)`,
        [boId, orderId, boRef, order.relais_id, user.id, backorderMaxDays]
      );

      for (const boi of allBackorderItems) {
        const piId = crypto.randomUUID();
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

        if (!boi._isPartial) {
          await client.query(
            `UPDATE order_items SET availability_status = 'backorder', updated_at = NOW()
             WHERE id = $1`,
            [boi.id]
          );
        }
      }
    }

    // ── 8. Historique (I-04) ────────────────────────────────────────────────
    const backorderQty = allBackorderItems.reduce((s, i) => s + i.quantity, 0);
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [
        orderId,
        order.status,
        `Expédition partielle créée — ${availableQty} articles expédiés (${psRef}), ${backorderQty} en backorder${boRef ? ` (${boRef})` : ''}`,
        user.id,
      ]
    );

    await client.query('COMMIT');

    // ── 9. SMS notification (non bloquant) ──────────────────────────────────
    if (autoNotify && order.user_phone) {
      const boCount = backorderQty;
      const smsText = `Komerce : Commande ${order.reference} — expedition partielle : ${availableQty} article(s) expedie(s), ${boCount} en attente (backorder). Ref colis : ${psRef}`;
      notifyText(order.user_phone, smsText, 'partial_ship', orderId)
        .catch(err => log.error({ err }, 'Notification partial_ship failed'));
    }

    return {
      status: 201,
      body: {
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
          backorder_qty: backorderQty,
          available_pct: parseFloat(availPct.toFixed(1)),
        },
      },
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── updateParcelStatus ───────────────────────────────────────────────────────
// Change le statut d'un colis.
// body : { status, note?, tracking_ref? }

async function updateParcelStatus(parcelId, body, user) {
  const { status, note, tracking_ref } = body;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

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
      return { status: 404, body: { error: 'Colis introuvable' } };
    }

    // GOV-02 (volet 2) — IDOR cross-relais : un agent_relais ne peut agir
    // que sur les colis d'une commande de SON relais. admin et agent_hub
    // ont une portée globale, non concernés par ce garde-fou.
    if (user?.role === 'agent_relais' && String(parcel.relais_id) !== String(user.relais_id)) {
      await client.query('ROLLBACK');
      log.warn(`[IDOR] bloqué — user ${user.id} (relais ${user.relais_id}) → parcel ${parcel.id} (order relais ${parcel.relais_id})`);
      return { status: 403, body: { error: "Ce colis n'appartient pas à une commande de votre relais" } };
    }

    // Valider la transition (I-03 parcel)
    const transGuard = validateParcelTransition(parcel.status, status);
    if (!transGuard.ok) {
      await client.query('ROLLBACK');
      return { status: transGuard.status, body: transGuard.body };
    }

    // Mettre à jour le statut du colis
    const updates = ['status = $1::parcel_status', 'updated_at = NOW()'];
    const params  = [status];
    let pi = 2;

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

    // Historique sur la commande parent (I-04)
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [
        parcel.parent_id,
        parcel.parent_status,
        `Colis ${parcel.reference} → ${status}${note ? ` — ${note}` : ''}`,
        user.id,
      ]
    );

    // Vérifier si TOUS les colis sont « collected » → transition commande (I-01)
    if (status === 'collected') {
      const { rows: allParcels } = await client.query(
        `SELECT id, status FROM parcels WHERE order_id = $1`,
        [parcel.parent_id]
      );

      const allCollected = allParcels.every(p =>
        p.id === parcelId ? true : (p.status === 'collected' || p.status === 'cancelled')
      );

      if (allCollected) {
        await transitionOrderStatus({
          orderId:   parcel.parent_id,
          newStatus: 'collected',
          actor:     { id: user?.id || null, role: user?.role || 'system' },
          source:    'scan',
          note:      'Tous les colis collectés — commande terminée',
          dbClient:  client,
        });
      }
    }

    await client.query('COMMIT');

    // SMS client (non bloquant) — sur shipped / available / collected
    if (['shipped', 'available'].includes(status)) {
      notifyParcelScan(parcelId, parcel.reference, status)
        .catch(err => log.error({ err }, `[PARCEL-${status.toUpperCase()}] Notification WID failed`));
    } else if (parcel.user_phone && PARCEL_SMS[status]) {
      const smsText = PARCEL_SMS[status](parcel.reference, parcel.relais_name);
      notifyText(parcel.user_phone, smsText, `parcel_${status}`, parcel.parent_id)
        .catch(err => log.error({ err }, 'Notification parcel status failed'));
    }

    return {
      status: 200,
      body: {
        success:   true,
        parcel_id: parcelId,
        status,
        reference: tracking_ref || parcel.reference,
      },
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── cancelBackorder ──────────────────────────────────────────────────────────
// Annule un colis backorder : restauration stock + crédit boutique ou refund Stripe.
// body : { parcel_id (ou sub_order_id), reason? }

async function cancelBackorder(orderId, body, user) {
  const parcelId = body.parcel_id || body.sub_order_id; // backward compat
  const { reason } = body;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Charger la commande parent
    const { rows: [order] } = await client.query(
      `SELECT o.*, u.phone AS user_phone
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = $1`,
      [orderId]
    );
    if (!order) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Commande introuvable' } };
    }

    // Vérifier les droits (admin, agent_hub, ou propriétaire)
    const isPrivileged = ['admin', 'agent_hub'].includes(user.role);
    if (!isPrivileged && order.user_id !== user.id) {
      await client.query('ROLLBACK');
      return { status: 403, body: { error: 'Accès refusé' } };
    }

    // Charger le colis backorder
    const { rows: [parcel] } = await client.query(
      `SELECT * FROM parcels WHERE id = $1 AND order_id = $2 AND type = 'backorder'`,
      [parcelId, orderId]
    );

    // Guard annulation (I-06)
    const cancelGuard = checkParcelCancellable(parcel);
    if (!cancelGuard.ok) {
      await client.query('ROLLBACK');
      return { status: cancelGuard.status, body: cancelGuard.body };
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

    // Restaurer le stock (I-06)
    for (const item of boItems) {
      await client.query(
        'UPDATE products SET stock = stock + $1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    // Crédit boutique ou remboursement Stripe (I-06, avec fallback silencieux)
    let refundResult    = null;
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
        user.id,
        parcelId
      );
    }

    // Historique (I-04)
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [
        orderId,
        order.status,
        `Backorder ${parcel.reference} annulé — ${boItems.length} article(s), ${Number(backorderValueKmf).toLocaleString('fr-FR')} KMF ${refundResult?.method === 'stripe' ? 'remboursé (Stripe)' : 'crédité (boutique)'}`,
        user.id,
      ]
    );

    await client.query('COMMIT');

    // SMS notification (non bloquant)
    if (order.user_phone) {
      const creditStr = refundResult?.method === 'stripe'
        ? `${refundAmountEur.toFixed(2)}EUR rembourse via Stripe`
        : `${Number(backorderValueKmf).toLocaleString('fr-FR')} KMF credite sur votre compte`;
      const smsText = `Komerce : Backorder ${parcel.reference} annule. ${creditStr}. Merci de votre comprehension.`;
      notifyText(order.user_phone, smsText, 'backorder_cancelled', orderId)
        .catch(err => log.error({ err }, 'Notification backorder_cancelled failed'));
    }

    return {
      status: 200,
      body: {
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
      },
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { markAvailability, partialShip, updateParcelStatus, cancelBackorder };
