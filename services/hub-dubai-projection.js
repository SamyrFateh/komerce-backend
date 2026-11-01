/**
 * @komerce-arch
 * @role          hub-dubai-projection
 * @domain        logistics
 * @layer         service
 * @criticality   medium
 * @inputs        authorized markets (server resolved), db
 * @outputs       hub_dubai_flow_read_model (réceptions fournisseur, unités physiques, traçabilité PO-cartons par marché)
 * @depends       db, services/hub-receivable.js
 * @used-by       routes/hub-dashboard.js
 * @db-read       hub_physical_units, hub_physical_unit_placements, hub_purchase_allocations, markets, purchase_orders, purchase_lines, v_purchase_line_progress
 * @db-write      none
 * @db-txn        none
 * @doctrine      read_model_minimal_for_hub_reception, missing_data_never_means_zero, no_new_business_engine, server_market_scope_is_authority
 * @impact-areas  hub-live, logistics
 * @version       2026-10
 */
'use strict';

const db = require('../db');
const { listReceivable } = require('./hub-receivable');

// États physiques existants (hub_physical_units.state) — aucune taxonomie nouvelle.
const CONTROLLED_STATES = Object.freeze(['QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED', 'PACKED']);

// Sources absentes du modèle de données : déclarées, jamais comptées à zéro.
const GAPS = Object.freeze([
  Object.freeze({ key: 'expeditions_ready', reason: 'Aucun état « expédition prête » n’est tenu côté serveur : customs_shipments enregistre les cargaisons dédouanées, pas leur préparation.' }),
  Object.freeze({ key: 'groupage_en_cours', reason: 'Aucun objet groupage/consolidation transport n’existe ; seuls les achats groupés (PO) sont suivis.' }),
]);

async function getUnitsByMarket(scope) {
  const { rows } = await db.query(
    `SELECT m.code AS market_code, m.name AS market_name,
            COUNT(*) FILTER (WHERE u.created_at::date = CURRENT_DATE)::int AS received_today,
            COUNT(*) FILTER (WHERE u.state = ANY($2::text[]))::int AS controlled,
            COUNT(*) FILTER (WHERE u.state = 'DISPATCHED')::int AS dispatched,
            COUNT(*) FILTER (WHERE u.state = 'QUARANTINED')::int AS quarantined
       FROM hub_physical_units u
       JOIN markets m ON m.id = u.market_id
      WHERE u.state <> 'SUPERSEDED'
        AND ($1::uuid[] IS NULL OR u.market_id = ANY($1::uuid[]))
      GROUP BY m.code, m.name
      ORDER BY m.code`,
    [scope.scoped ? scope.marketIds : null, CONTROLLED_STATES],
  );
  return rows;
}

// Projection de faits physiques enregistrés, jamais d'allocation inventée au dashboard.
// Une ligne par PO / contenant actif ; les inbound non emballés restent visibles.
// La portée marché provient de l'allocation immuable, et non du colis fournisseur (souvent multi-marché).
async function getPoCartonTrace(scope) {
  const { rows } = await db.query(
    `SELECT m.code AS market_code, a.purchase_order_id::text AS purchase_order_id,
            u.reference AS physical_reference, u.unit_type, u.state,
            a.destination_ref,
            SUM(p.quantity)::int AS quantity
       FROM hub_physical_unit_placements p
       JOIN hub_purchase_allocations a ON a.id = p.allocation_id
       JOIN hub_physical_units u ON u.id = p.physical_unit_id
       JOIN markets m ON m.id = a.market_id
      WHERE p.removed_at IS NULL
        AND u.outcome_type IS NULL
        AND u.state <> 'SUPERSEDED'
        AND ($1::uuid[] IS NULL OR a.market_id = ANY($1::uuid[]))
      GROUP BY m.code,a.purchase_order_id,u.reference,u.unit_type,u.state,a.destination_ref
      ORDER BY m.code,a.purchase_order_id,u.reference
      LIMIT 100`,
    [scope.scoped ? scope.marketIds : null],
  );
  return Object.freeze(rows.map(r => Object.freeze({ ...r })));
}

function sum(rows, key) {
  return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
}

// authorizedMarkets : null = accès hub global (admin / agent_hub) ; tableau d'ids = périmètre serveur.
async function buildHubDubai({ authorizedMarkets = null } = {}) {
  const scoped = authorizedMarkets !== null && authorizedMarkets !== undefined;
  const scope = { scoped, marketIds: scoped ? Array.from(authorizedMarkets) : [] };
  const unitsByMarket = await getUnitsByMarket(scope);
  const poCartonTrace = await getPoCartonTrace(scope);

  // Les PO fournisseur ne portent pas de marché : visibles uniquement du Hub global.
  let receptions;
  if (scoped) {
    receptions = Object.freeze({ available: false, reason: 'Réceptions fournisseur non rattachées à un marché : visibles du Hub global uniquement.' });
  } else {
    const { purchase_orders: pos } = await listReceivable();
    receptions = Object.freeze({
      available: true,
      expected_purchase_orders: pos.length,
      partial_purchase_orders: pos.filter(p => p.lines.some(l => l.reception_state === 'PARTIAL')).length,
      grouped_purchase_orders: pos.filter(p => p.shape === 'grouped').length,
      purchase_orders: Object.freeze(pos.slice(0, 25).map(p => Object.freeze({
        purchase_order_id: p.purchase_order_id, shape: p.shape, po_status: p.po_status,
        supplier_name: p.supplier.name, supplier_order_ref: p.supplier_order_ref,
        expected_quantity: p.lines.reduce((a, l) => a + l.expected_quantity, 0),
        received_quantity: p.lines.reduce((a, l) => a + l.received_quantity, 0),
      }))),
    });
  }

  return Object.freeze({
    generated_at: new Date().toISOString(),
    scope: Object.freeze({ mode: scoped ? 'market' : 'global' }),
    receptions,
    units: Object.freeze({
      received_today: sum(unitsByMarket, 'received_today'),
      controlled: sum(unitsByMarket, 'controlled'),
      dispatched: sum(unitsByMarket, 'dispatched'),
      quarantined: sum(unitsByMarket, 'quarantined'),
      by_market: Object.freeze(unitsByMarket.map(r => Object.freeze({ ...r }))),
    }),
    trace: Object.freeze({ available: true, rows: poCartonTrace, limited_to: 100 }),
    gaps: GAPS,
  });
}

module.exports = { buildHubDubai, GAPS, CONTROLLED_STATES };
