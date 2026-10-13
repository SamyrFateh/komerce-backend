/**
 * @komerce-arch
 * @role          logistics-parcel-auto-create-service
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/parcel-order-membership.js, services/order-status-machine.js, services/payment-cash-confirm.js, services/purchasing-trigger-service.js, utils/logger.js
 * @used-by       routes/order-api-v2.js
 * @db-read       order_items, orders, parcel_items, parcels, products, relais, users
 * @db-write      orders, parcel_items, parcels, scan_events
 * @db-write-via:order-status-machine product_variants, order_status_history, products
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';

/**
 * parcel-auto-create-service.js
 * ══════════════════════════════
 * Création automatique d'un colis à partir d'une commande confirmée et payée.
 *
 * Utilisé par :
 *   - POST /api/v2/orders/:ref/confirm-cash  (après confirmation paiement cash)
 *   - POST /api/v2/orders/:ref/create-parcel (création manuelle fallback)
 *
 * Contrat :
 *   autoCreateParcel(client, orderId, actor) → { success, parcel? } | { success: false, reason }
 *
 * Préconditions vérifiées en interne :
 *   - commande payée (payment_status = 'paid')
 *   - pas de colis existant
 *   - au moins un item
 *
 * La fonction s'exécute dans la transaction fournie (client) — aucune
 * transaction propre. L'appelant gère BEGIN / COMMIT / ROLLBACK.
 */

const { randomBytes, randomUUID } = require('crypto');
const db  = require('../db');

const { transitionOrderStatus } = require('./order-status-machine');
const { memberParcelPredicate } = require('./parcel-order-membership');
const log = require('../utils/logger').child({ module: 'parcel-auto-create-service' });

/**
 * Crée automatiquement un colis pour une commande confirmée et payée.
 *
 * @param {object} client   - client DB transactionnel (pg PoolClient)
 * @param {string} orderId  - UUID de la commande
 * @param {{ id, name, role }} actor
 * @returns {Promise<{ success: true, parcel: object } | { success: false, reason: string }>}
 */
async function autoCreateParcel(client, orderId, actor) {
  // 1. Charger la commande
  const { rows: [order] } = await client.query(
    `SELECT o.id, o.reference, o.status, o.payment_status, o.payment_mode,
       o.total_kmf, o.user_id, o.relais_id, o.destination_island,
       u.full_name AS customer_name, u.phone AS customer_phone,
       r.name AS relais_name, r.island AS relais_island
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     LEFT JOIN relais r ON r.id = o.relais_id
     WHERE o.id = $1`,
    [orderId]
  );
  if (!order) return { success: false, reason: 'order_not_found' };

  // 2. Bail si non payé
  if (order.payment_status !== 'paid') {
    return { success: false, reason: 'not_paid' };
  }

  // 3. Bail si colis déjà existant (idempotence)
  const { rows: existing } = await client.query(
    `SELECT p.id, p.reference FROM parcels p WHERE ${memberParcelPredicate('p', '$1')}`,
    [orderId]
  );
  if (existing.length > 0) {
    return { success: false, reason: 'parcel_exists', parcel_ref: existing[0].reference };
  }

  // 4. Charger les items
  const { rows: items } = await client.query(
    `SELECT oi.id, oi.product_id, oi.quantity, oi.price_kmf,
       p.name AS product_name, p.weight_kg AS product_weight
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1`,
    [orderId]
  );
  if (!items.length) return { success: false, reason: 'no_items' };

  // 5. Générer la référence colis (séquentielle par année)
  const year = new Date().getFullYear();
  const { rows: [{ max_seq }] } = await client.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM 'PCL-\\d{4}-(\\d+)') AS INT)), 0) AS max_seq
     FROM parcels WHERE reference LIKE $1`,
    [`PCL-${year}-%`]
  );
  const newSeq = (max_seq || 0) + 1;
  const parcelRef = `PCL-${year}-${String(newSeq).padStart(4, '0')}`;

  // 6. Calculer poids et totaux
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const weightKg = items.reduce((s, i) => s + (Number(i.product_weight) || 0.5) * i.quantity, 0);

  // 7. Générer le code retrait (Base36, rejection sampling)
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const pickupCode = Array.from({ length: 6 }, () => {
    let b;
    do { b = randomBytes(1)[0]; } while (b >= 216);
    return CHARS[b % 36];
  }).join('');

  // 8. Insérer le colis
  const parcelId = randomUUID();
  await client.query(
    `INSERT INTO parcels (
       id, order_id, reference, type, status, relais_id,
       weight_kg, destination_island, recipient_name, recipient_phone,
       items_count, total_qty, pickup_code, prepared_at
     ) VALUES (
       $1::uuid, $2::uuid, $3, 'standard', 'preparation', $4::uuid,
       $5, $6, $7, $8,
       $9, $10, $11, NOW()
     )`,
    [
      parcelId, orderId, parcelRef, order.relais_id,
      weightKg.toFixed(2), order.relais_island || order.destination_island || 'Comores',
      order.customer_name || 'Client', order.customer_phone || '',
      items.length, totalQty, pickupCode,
    ]
  );

  // 9. Insérer les parcel_items (SAVEPOINT par item pour isolation)
  for (const item of items) {
    try {
      await client.query('SAVEPOINT sp_pi');
      await client.query(
        `INSERT INTO parcel_items (
           id, parcel_id, order_item_id, product_id, quantity,
           qty_allocated, qty_packed, qty_shipped, qty_received, qty_collected,
           verified, product_name
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
           $6, $7, 0, 0, 0,
           false, $8
         )`,
        [randomUUID(), parcelId, item.id, item.product_id, item.quantity,
         item.quantity, item.quantity, item.product_name]
      );
      await client.query('RELEASE SAVEPOINT sp_pi');
    } catch (_) {
      await client.query('ROLLBACK TO SAVEPOINT sp_pi');
    }
  }

  // 10. Insérer l'événement de scan initial (SAVEPOINT — non bloquant)
  try {
    await client.query('SAVEPOINT sp_scan');
    await client.query(
      `INSERT INTO scan_events (
         id, parcel_id, order_id, event_type,
         scan_code, scanned_by, actor_name, actor_role,
         location, notes, status, created_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'preparation',
         $4, $5::uuid, $6, $7,
         'Hub', $8, 'applied', NOW()
       )`,
      [randomUUID(), parcelId, orderId, parcelRef,
       actor.id || null, actor.name || 'Système',
       actor.role === 'agent_hub' ? 'hub_agent' : 'system',
       `Colis ${parcelRef} auto-créé pour ${order.reference}`]
    );
    await client.query('RELEASE SAVEPOINT sp_scan');
  } catch (_) {
    await client.query('ROLLBACK TO SAVEPOINT sp_scan');
  }

  // 11. Transitions de statut : confirmed → ordered → preparation
  if (order.status === 'confirmed') {
    await transitionOrderStatus({
      orderId, newStatus: 'ordered',
      actor: { id: actor.id, role: actor.role || 'system' },
      source: 'auto_parcel', note: 'Auto: colis créé → ordered',
      dbClient: client,
    }).catch(() => {});
  }

  await transitionOrderStatus({
    orderId, newStatus: 'preparation',
    actor: { id: actor.id, role: actor.role || 'system' },
    source: 'auto_parcel', note: `Auto: colis ${parcelRef} → préparation`,
    dbClient: client,
  }).catch(() => {});

  log.info(`📦 AUTO-PARCEL: ${parcelRef} created for ${order.reference}`);

  return {
    success: true,
    parcel: {
      id: parcelId, reference: parcelRef, status: 'preparation',
      pickup_code: pickupCode, order_ref: order.reference,
      nb_items: items.length, total_qty: totalQty,
      weight_kg: Number(weightKg.toFixed(2)),
    },
  };
}


// ─── Confirmation paiement cash + création colis ───────────────────────────────

/**
 * Confirme le paiement cash d'une commande puis crée le colis — SANS seconde logique d'encaissement.
 *
 * L'encaissement appartient à l'autorité unique `payment-cash-confirm` (droits, contrôle cross-relais,
 * double validation, cash_collections, cycle de stock, notifications). Ici on ne fait que :
 *   1. résoudre la commande et sa référence cash ;
 *   2. déléguer à l'autorité ;
 *   3. créer le colis (transaction propre, idempotent) UNIQUEMENT si le paiement est réellement confirmé.
 * États retournés : confirmed | pending_second_approval | already_confirmed. Tout refus lève {status, code}.
 * Aucun `paid` prématuré : un premier visa ne crée ni paiement, ni colis.
 *
 * @param {string} ref    - référence ou UUID de la commande
 * @param {{ id, role, full_name, email }} actor
 */
async function confirmCashAndCreateParcel(ref, actor, deps = {}) {
  const confirmCash = deps.confirmCashByReference || require('./payment-cash-confirm').confirmCashByReference;
  const triggerPurchasing = deps.triggerPurchasing || require('./purchasing-trigger-service').triggerPurchasing;

  const { rows: [order] } = await db.query(
    `SELECT o.id, o.reference, o.status, o.payment_mode, o.payment_status, o.total_kmf, o.user_id, o.relais_id,
       o.cash_ref_code, u.full_name AS customer_name, u.phone AS customer_phone
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.reference = $1 OR o.id::text = $1`,
    [ref]
  );
  if (!order) throw cashError(404, 'order_not_found', `Commande ${ref} introuvable`);
  if (order.payment_mode !== 'cash_relais') {
    throw cashError(400, 'not_cash_relais', "Cette commande n'est pas en paiement cash relais");
  }

  if (order.payment_status === 'paid') {
    // Idempotence : un rejeu ne ré-encaisse rien ; il ne fait que rattraper un colis manquant.
    const parcelResult = await createParcelInOwnTransaction(order.id, actor);
    return { state: 'already_confirmed', order, parcelResult };
  }
  if (order.payment_status !== 'pending') {
    throw cashError(409, 'payment_status_not_confirmable',
      `Confirmation cash impossible : payment_status actuel ('${order.payment_status}') n'autorise pas la transition vers 'paid'`);
  }
  if (!order.cash_ref_code) {
    throw cashError(409, 'cash_reference_missing', 'Référence de paiement cash indisponible');
  }

  const result = await confirmCash({
    cashRefCode: order.cash_ref_code,
    actor: { id: actor.id || null, role: actor.role || 'system' },
    triggerPurchasing,
    db,
  });

  if (result.status === 202 && result.body && result.body.pending_second_approval) {
    return { state: 'pending_second_approval', order, control: result.body };
  }
  if (result.status !== 200) {
    throw cashError(result.status, (result.body && result.body.code) || 'cash_confirmation_rejected',
      (result.body && result.body.error) || 'Confirmation cash refusée');
  }

  const parcelResult = await createParcelInOwnTransaction(order.id, actor);
  return { state: 'confirmed', order, parcelResult };
}

function cashError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/** Création du colis dans sa propre transaction : un échec ici ne défait jamais un encaissement déjà acté. */
async function createParcelInOwnTransaction(orderId, actor) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const parcelResult = await autoCreateParcel(client, orderId, {
      id: actor.id || null,
      name: actor.full_name || 'Admin CT',
      role: actor.role || 'system',
    });
    await client.query('COMMIT');
    return parcelResult;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    log.error({ err, order_id: orderId }, '[CASH-CONFIRM] création colis après encaissement échouée — rejouer confirm-cash ou create-parcel');
    return { success: false, reason: 'parcel_creation_failed' };
  } finally {
    client.release();
  }
}


/**
 * Crée un colis manuellement pour une commande confirmée et payée (fallback).
 * Gère sa propre transaction.
 *
 * @param {string} ref    - référence ou UUID de la commande
 * @param {{ id, name, role }} actor
 * @returns {{ order: object, parcel: object }}
 * @throws {{ status, error, rule? }} selon la validation
 */
async function createParcelManually(ref, actor) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows: [order] } = await client.query(
      'SELECT o.id, o.reference, o.status, o.payment_status FROM orders o WHERE o.reference = $1 OR o.id::text = $1',
      [ref]
    );
    if (!order) {
      await client.query('ROLLBACK');
      const err = new Error(`Commande ${ref} introuvable`); err.status = 404; throw err;
    }
    if (order.payment_status !== 'paid') {
      await client.query('ROLLBACK');
      const err = new Error('Paiement non confirmé — impossible de créer un colis');
      err.status = 400; err.rule = 'PAS DE PAIEMENT = PAS DE COLIS'; throw err;
    }
    if (!['confirmed', 'ordered'].includes(order.status)) {
      await client.query('ROLLBACK');
      const err = new Error(`La commande doit être en statut "confirmed" ou "ordered" (actuellement: ${order.status})`);
      err.status = 400; throw err;
    }

    const result = await autoCreateParcel(client, order.id, actor);
    if (!result.success) {
      await client.query('ROLLBACK');
      const err = new Error(`Création impossible: ${result.reason}`); err.status = 400; throw err;
    }

    await client.query('COMMIT');
    return { order, parcel: result.parcel };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { autoCreateParcel, confirmCashAndCreateParcel, createParcelManually };
