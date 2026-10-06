/**
 * @komerce-arch
 * @role          logistics-control-tower-market-projection
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, projection_limit
 * @outputs       market_scoped_logistics_control_chain_projection
 * @depends       db.js
 * @used-by       future canonical control-tower route
 * @db-read       orders, order_items, parcel_items, parcels, purchase_orders, purchase_lines,
 *                v_purchase_line_progress, hub_purchase_allocations, hub_physical_unit_placements,
 *                hub_physical_units, customs_shipment_parcels, customs_shipments, incidents, signals
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_LOGISTICS_CONTROL_CHAIN.md, dashboard_no_business_recompute,
 *                server_market_scope_is_authority
 * @impact-areas  dashboard, logistics, purchasing, customs, decision-signals
 * @version       2026-10
 */
'use strict';

const db = require('../db');

const STAGES = Object.freeze([
  'ORDER', 'PURCHASING', 'SUPPLIER', 'HUB_RECEIVING', 'HUB_CONTROL',
  'FORWARDER', 'TRANSPORT', 'CUSTOMS', 'RELAY', 'DELIVERED',
]);
const STAGE_RANK = Object.freeze(Object.fromEntries(STAGES.map((stage, index) => [stage, index])));
const HEALTH = Object.freeze({ GREEN: 'GREEN', ORANGE: 'ORANGE', RED: 'RED' });

module.exports = { db, STAGES, STAGE_RANK, HEALTH };
