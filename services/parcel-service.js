/**
 * @komerce-arch
 * @role          logistics-parcel-service
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       utils/parcels.js
 * @used-by       services/parcel-guards.js, services/parcel-operations.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Parcel Service
 *
 * Wrapper / re-exports depuis utils/parcels.js.
 * Expose également les constantes métier utilisées par les routes.
 */

'use strict';

// Re-exports depuis utils/parcels.js
const {
  PARCEL_TYPES,
  PARCEL_STATUSES,
  STATUS_WEIGHT,
  computeOrderStatus,
  splitOrderIntoParcels,
  registerStrategy,
  listStrategies,
  STRATEGIES,
} = require('../utils/parcels');

// ─── Constantes utilisées par les routes (pipeline de statuts colis) ──────────

/** Statuts valides pour la table parcels (miroir enum parcel_status) */
const PARCEL_VALID_STATUSES = [
  'draft', 'preparation', 'shipped', 'in_transit', 'arrived', 'available', 'collected', 'cancelled',
];

/** Matrice des transitions valides entre statuts colis */
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

/** SMS envoyés lors du changement de statut d'un colis */
const PARCEL_SMS = {
  shipped:   (ref) =>
    `Komerce : Colis ${ref} expedie. Vous serez notifie a l'arrivee.`,
  available: (ref, relais) =>
    `Komerce : Colis ${ref} disponible au relais ${relais || ''}. Venez le recuperer !`,
  collected: (ref) =>
    `Komerce : Colis ${ref} remis. Merci ! 🎉`,
};

module.exports = {
  // Constantes
  PARCEL_VALID_STATUSES,
  PARCEL_TRANSITIONS,
  PARCEL_SMS,

  // Re-exports depuis utils/parcels.js
  PARCEL_TYPES,
  PARCEL_STATUSES,
  STATUS_WEIGHT,
  computeOrderStatus,
  splitOrderIntoParcels,
  registerStrategy,
  listStrategies,
  STRATEGIES,
};
