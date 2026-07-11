/**
 * @komerce-arch
 * @role          transport-rail-registry
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        transport_rail_code
 * @outputs       canonical_transport_rail
 * @depends       none
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
  TRANSPORT_RAILS,
  TransportRailError,
  normalizeTransportRailCode,
  getTransportRail,
  isTransportRailCommerciallyExposed,
  assertTransportRailCommerciallyExposed,
  listCommercialTransportRails,
};
