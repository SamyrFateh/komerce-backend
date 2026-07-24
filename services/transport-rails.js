/**
 * @komerce-arch
 * @role          transport-rail-registry
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        transport_rail_code, packing_items
 * @outputs       canonical_transport_rail, rail_aware_packing_result
 * @depends       services/parcelOptimizationService.js
 * @used-by       future transport routing and packing orchestration
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_TRANSPORT_RAILS.md
 * @impact-areas  logistics, orders, economic-engine, catalog, customs, notifications, dashboard
 * @version       2026-07
 */
'use strict';

const CAPACITY_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INTERNAL: 'INTERNAL',
});

const PRICING_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PENDING: 'PENDING',
});

const COMMERCIAL_EXPOSURE = Object.freeze({
  PUBLIC: 'PUBLIC',
  DISABLED: 'DISABLED',
});

const PACKING_PROFILE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PENDING: 'PENDING',
});

const PACKING_PROFILES = Object.freeze({
  SEA_STANDARD: Object.freeze({
    status: PACKING_PROFILE_STATUS.ACTIVE,
    config: Object.freeze({
      maxParcelWeightKg: 25,
      maxParcelVolumeCm3: 100_000,
      targetParcelValueKmf: 300_000,
    }),
  }),
  AIR_EXPRESS: Object.freeze({
    status: PACKING_PROFILE_STATUS.PENDING,
    config: null,
  }),
});

const TRANSPORT_RAILS = Object.freeze({
  SEA_STANDARD: Object.freeze({
    code: 'SEA_STANDARD',
    corridor: Object.freeze(['DXB', 'ANJOUAN']),
    capacity_status: CAPACITY_STATUS.ACTIVE,
    pricing_status: PRICING_STATUS.ACTIVE,
    commercial_exposure: COMMERCIAL_EXPOSURE.PUBLIC,
  }),
  AIR_EXPRESS: Object.freeze({
    code: 'AIR_EXPRESS',
    corridor: Object.freeze(['DXB', 'ADD', 'HAH']),
    // Doctrine DOCTRINE_TRANSPORT_RAILS §2 : rail connu ≠ rail commercialisé.
    // Packing PENDING, capacité cargo non confirmée, tarif client non stabilisé.
    // Revenir PUBLIC uniquement quand logistics + economic-engine sont prêts.
    capacity_status: CAPACITY_STATUS.INTERNAL,
    pricing_status: PRICING_STATUS.PENDING,
    commercial_exposure: COMMERCIAL_EXPOSURE.DISABLED,
  }),
});

class TransportRailError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TransportRailError';
    this.code = code;
  }
}

function normalizeTransportRailCode(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  return String(raw).trim().toUpperCase();
}

function getTransportRail(rawCode) {
  const code = normalizeTransportRailCode(rawCode);
  if (!code) return null;

  const rail = TRANSPORT_RAILS[code];
  if (!rail) {
    throw new TransportRailError(
      `Rail de transport inconnu: ${code}`,
      'TRANSPORT_RAIL_UNKNOWN'
    );
  }

  return rail;
}

function getTransportRailPackingProfile(rawCode) {
  const rail = getTransportRail(rawCode);
  if (!rail) return null;

  const profile = PACKING_PROFILES[rail.code];
  if (!profile || profile.status !== PACKING_PROFILE_STATUS.ACTIVE || !profile.config) {
    throw new TransportRailError(
      `Profil de packing non stabilise pour ${rail.code}`,
      'TRANSPORT_RAIL_PACKING_PROFILE_PENDING'
    );
  }

  return profile.config;
}

function buildParcelsForTransportRail({ transportRailCode = null, config = {}, ...packingParams } = {}) {
  const railConfig = transportRailCode ? getTransportRailPackingProfile(transportRailCode) : {};
  const { buildParcelsFromAvailableItems } = require('./parcelOptimizationService');

  return buildParcelsFromAvailableItems({
    ...packingParams,
    config: { ...railConfig, ...config },
  });
}

function isTransportRailCommerciallyExposed(rawCode) {
  const rail = getTransportRail(rawCode);
  if (!rail) return false;

  return rail.capacity_status === CAPACITY_STATUS.ACTIVE
    && rail.pricing_status === PRICING_STATUS.ACTIVE
    && rail.commercial_exposure === COMMERCIAL_EXPOSURE.PUBLIC;
}

function assertTransportRailCommerciallyExposed(rawCode) {
  const rail = getTransportRail(rawCode);
  if (!rail) {
    throw new TransportRailError(
      'Aucun rail de transport assigne',
      'TRANSPORT_RAIL_UNASSIGNED'
    );
  }

  if (!isTransportRailCommerciallyExposed(rail.code)) {
    throw new TransportRailError(
      `Rail ${rail.code} non commercialisable: capacity=${rail.capacity_status}, pricing=${rail.pricing_status}, exposure=${rail.commercial_exposure}`,
      'TRANSPORT_RAIL_NOT_COMMERCIALLY_EXPOSED'
    );
  }

  return rail;
}

function listCommercialTransportRails() {
  return Object.values(TRANSPORT_RAILS)
    .filter(rail => isTransportRailCommerciallyExposed(rail.code));
}

module.exports = {
  CAPACITY_STATUS,
  PRICING_STATUS,
  COMMERCIAL_EXPOSURE,
  PACKING_PROFILE_STATUS,
  PACKING_PROFILES,
  TRANSPORT_RAILS,
  TransportRailError,
  normalizeTransportRailCode,
  getTransportRail,
  getTransportRailPackingProfile,
  buildParcelsForTransportRail,
  isTransportRailCommerciallyExposed,
  assertTransportRailCommerciallyExposed,
  listCommercialTransportRails,
};