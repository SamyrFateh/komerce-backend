/**
 * @komerce-arch
 * @role          market-delegation-customs-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, optional shipment period (from/to)
 * @outputs       expéditions douane du marché (lecture seule) : coûts de douane et de fret propres au marché
 * @depends       services/market-delegation-team-service.js
 * @used-by       routes/market-delegation-customs.js
 * @db-read       customs_shipments, customs_shipment_parcels
 * @db-write      none
 * @db-txn        none
 * @doctrine      customs_read_view_is_a_projection, client_market_id_never_authority, customs_per_market
 * @impact-areas  market, delegation, customs, logistics
 * @version       2026-10
 */
'use strict';

const { resolveAuthorization } = require('./market-delegation-team-service');

const MAX_SHIPMENTS = 200;

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-customs-service: executor.query requis');
  }
  return executor;
}

function customsError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function parseDay(value, label) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(text + 'T00:00:00Z').getTime())) {
    throw customsError('MARKET_CUSTOMS_PERIOD_INVALID', `${label} : date AAAA-MM-JJ attendue.`, 400);
  }
  return text;
}

// Colonnes volontairement explicites : le Market lit ses propres coûts de douane et de fret,
// jamais la configuration de ventilation interne du siège (allocation_config).
const SHIPMENTS_SQL = `
  SELECT s.id, s.reference, s.shipment_date, s.transitaire_name, s.transport_mode,
         s.cif_value_kmf::text AS cif_value_kmf, s.customs_paid_kmf::text AS customs_paid_kmf,
         s.freight_kmf::text AS freight_kmf, s.total_weight_kg::text AS total_weight_kg,
         s.effective_rate_pct::text AS effective_rate_pct, s.status, s.is_active,
         (SELECT COUNT(*)::int FROM customs_shipment_parcels cp WHERE cp.shipment_id = s.id) AS parcels_linked
    FROM customs_shipments s
   WHERE s.market_id = $1
     AND ($2::date IS NULL OR s.shipment_date >= $2::date)
     AND ($3::date IS NULL OR s.shipment_date <= $3::date)
   ORDER BY s.shipment_date DESC, s.created_at DESC
   LIMIT ${MAX_SHIPMENTS + 1}`;

async function listMarketCustomsShipments(executor, { marketCode, actorUserId, from = null, to = null }) {
  const db = requireExecutor(executor);
  const fromDay = parseDay(from, 'from');
  const toDay = parseDay(to, 'to');
  if (fromDay && toDay && toDay < fromDay) throw customsError('MARKET_CUSTOMS_PERIOD_INVALID', 'to doit être postérieur ou égal à from.', 400);

  const authz = await resolveAuthorization(db, {
    userId: actorUserId,
    marketCode,
    requiredCapability: 'operations.read',
  });

  const { rows } = await db.query(SHIPMENTS_SQL, [authz.market_id, fromDay, toDay]);
  const truncated = rows.length > MAX_SHIPMENTS;
  return Object.freeze({
    market_code: authz.market_code || String(marketCode).toUpperCase(),
    period: { from: fromDay, to: toDay },
    shipments: rows.slice(0, MAX_SHIPMENTS),
    truncated,
    read_only: true,
  });
}

module.exports = { MAX_SHIPMENTS, listMarketCustomsShipments };
