/**
 * @komerce-arch
 * @role          dashboard-operations-relay-projection
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_scope
 * @outputs       relay_parcel_counts
 * @depends       db
 * @used-by       services/operations-workspace.js, services/hub-dashboard-queries.js, services/relay-dashboard-queries.js
 * @db-read       orders, parcels, relais
 * @db-write      none
 * @db-txn        @none
 * @doctrine      single_hub_relay_projection, workspace_owns_live_consumes, server_market_scope_is_authority
 * @impact-areas  dashboard, admin-dashboard, logistics
 * @version       2026-10
 */

'use strict';

const db = require('../db');

/**
 * LIVE-06 (D4) — unique vérité des comptages colis « au relais » / « en transit ».
 * Unité = le COLIS (objet physique). Propriétaire : workspace Opérations ; les
 * écrans Live Hub et Relais consomment cette fonction.
 *
 * scope: { marketIds?: uuid[] | null (null = tous), relaisId?: uuid | null }
 */
async function countRelayParcels(scope = {}, executor = db) {
  const marketIds = Array.isArray(scope.marketIds) ? scope.marketIds : null;
  const relaisId = scope.relaisId || null;
  const { rows: [row] } = await executor.query(
    `SELECT
        COUNT(*) FILTER (WHERE p.status = 'available')::int AS available,
        COUNT(*) FILTER (WHERE p.status = 'in_transit')::int AS in_transit
       FROM parcels p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN relais r ON r.id = p.relais_id
      WHERE p.status NOT IN ('cancelled', 'collected')
        AND ($1::uuid[] IS NULL OR (
              o.market_id = ANY($1::uuid[])
              AND (p.relais_id IS NULL OR r.market_id = ANY($1::uuid[]))
            ))
        AND ($2::uuid IS NULL OR p.relais_id = $2::uuid)`,
    [marketIds, relaisId]
  );
  return { available: Number(row.available) || 0, in_transit: Number(row.in_transit) || 0 };
}

module.exports = { countRelayParcels };
