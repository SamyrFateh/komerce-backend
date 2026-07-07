/**
 * @komerce-arch
 * @role          logistics-parcel-guards
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @used-by       @unknown
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Parcel Guards (R4)
 *
 * Fonctions de validation pures (sans DB) pour les opérations colis :
 *   validateParcelCreate()     — vérifie qu'une expédition partielle est déclenchable
 *   checkParcelCancellable()   — vérifie qu'un colis backorder est annulable
 *   validateSplitItems()       — vérifie la cohérence des articles disponibles vs commande
 *
 * Toutes ces fonctions retournent { ok: true } ou { ok: false, status, body }
 * pour permettre un early-return propre dans les services.
 */

const { PARCEL_VALID_STATUSES, PARCEL_TRANSITIONS } = require('./parcel-service');

// ─── Statuts bloquants pour l'annulation d'un backorder ──────────────────────
const BACKORDER_NON_CANCELLABLE_STATUSES = [
  'shipped', 'in_transit', 'arrived', 'available', 'collected',
];

/**
 * Vérifie que la commande est dans un état qui autorise une expédition partielle.
 * @param {object} order  — ligne orders chargée en DB
 * @param {number} daysSinceOrdered
 * @param {number} delayThresholdDays — règle PARTIAL_SHIP_DELAY_THRESHOLD_DAYS
 * @returns {{ ok: boolean, status?: number, body?: object }}
 */
function validateParcelCreate(order, daysSinceOrdered, delayThresholdDays) {
  if (!order) {
    return { ok: false, status: 404, body: { error: 'Commande introuvable' } };
  }

  if (!['ordered', 'preparation'].includes(order.status)) {
    return {
      ok: false,
      status: 422,
      body: {
        error: `Expédition partielle impossible — statut actuel : ${order.status} (attendu : ordered ou preparation)`,
        current_status: order.status,
      },
    };
  }

  if (daysSinceOrdered < delayThresholdDays) {
    return {
      ok: false,
      status: 422,
      body: {
        error: `Expédition partielle trop tôt — ${Math.round(daysSinceOrdered)} jour(s) depuis la commande, seuil : ${delayThresholdDays} jours`,
        days_since_ordered: Math.round(daysSinceOrdered),
        threshold_days: delayThresholdDays,
      },
    };
  }

  return { ok: true };
}

/**
 * Vérifie la cohérence des articles à expédier vs le contenu de la commande.
 * @param {Array} available_items  — items du body ({ order_item_id, quantity })
 * @param {Array} allItems         — items DB de la commande (order_items + products)
 * @param {number} minAvailablePct — règle PARTIAL_SHIP_MIN_AVAILABLE_PCT
 * @returns {{ ok: boolean, status?: number, body?: object }}
 */
function validateSplitItems(available_items, allItems, minAvailablePct) {
  for (const ai of available_items) {
    const found = allItems.find(oi => oi.id === ai.order_item_id);
    if (!found) {
      return {
        ok: false,
        status: 400,
        body: { error: `Article ${ai.order_item_id} introuvable dans cette commande` },
      };
    }
    if (ai.quantity > found.quantity) {
      return {
        ok: false,
        status: 400,
        body: {
          error: `Quantité demandée (${ai.quantity}) > quantité commandée (${found.quantity}) pour l'article ${found.product_name}`,
        },
      };
    }
  }

  const totalQty     = allItems.reduce((sum, i) => sum + i.quantity, 0);
  const availableQty = available_items.reduce((sum, i) => sum + i.quantity, 0);
  const availPct     = totalQty > 0 ? (availableQty / totalQty) * 100 : 0;

  if (availPct < minAvailablePct) {
    return {
      ok: false,
      status: 422,
      body: {
        error: `Pourcentage disponible insuffisant : ${availPct.toFixed(1)}% (minimum : ${minAvailablePct}%)`,
        available_pct: parseFloat(availPct.toFixed(1)),
        min_required_pct: minAvailablePct,
      },
    };
  }

  return { ok: true, availableQty, availPct };
}

/**
 * Vérifie qu'un colis backorder peut être annulé.
 * @param {object|null} parcel — ligne parcels (avec type et status)
 * @returns {{ ok: boolean, status?: number, body?: object }}
 */
function checkParcelCancellable(parcel) {
  if (!parcel) {
    return { ok: false, status: 404, body: { error: 'Colis backorder introuvable pour cette commande' } };
  }

  if (parcel.status === 'cancelled') {
    return { ok: false, status: 422, body: { error: 'Backorder déjà annulé' } };
  }

  if (BACKORDER_NON_CANCELLABLE_STATUSES.includes(parcel.status)) {
    return {
      ok: false,
      status: 422,
      body: {
        error: `Annulation impossible — le colis est en statut "${parcel.status}"`,
        current_status: parcel.status,
      },
    };
  }

  return { ok: true };
}

/**
 * Vérifie qu'une transition de statut colis est licite.
 * @param {string} currentStatus
 * @param {string} newStatus
 * @returns {{ ok: boolean, status?: number, body?: object }}
 */
function validateParcelTransition(currentStatus, newStatus) {
  if (!PARCEL_VALID_STATUSES.includes(newStatus)) {
    return {
      ok: false,
      status: 400,
      body: { error: `Statut invalide. Valeurs : ${PARCEL_VALID_STATUSES.join(', ')}` },
    };
  }

  const allowedNext = PARCEL_TRANSITIONS[currentStatus] || [];
  if (!allowedNext.includes(newStatus)) {
    return {
      ok: false,
      status: 422,
      body: {
        error: `Transition invalide : ${currentStatus} → ${newStatus}. Transitions autorisées : ${allowedNext.join(', ') || 'aucune (état terminal)'}`,
        current_status: currentStatus,
      },
    };
  }

  return { ok: true };
}

module.exports = {
  validateParcelCreate,
  validateSplitItems,
  checkParcelCancellable,
  validateParcelTransition,
};
