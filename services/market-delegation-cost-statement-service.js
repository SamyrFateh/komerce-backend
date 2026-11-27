/**
 * @komerce-arch
 * @role          market-delegation-cost-statement-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, optional economic period (from/to)
 * @outputs       relevé de coûts du marché : charges directes + charges mutualisées attribuées, en lecture seule
 * @depends       services/market-delegation-team-service.js
 * @used-by       routes/market-delegation-cost-statement.js
 * @db-read       economic_structure_cost_events, market_cost_attributions, markets, economic_cost_posts, economic_cost_centers
 * @db-write      none
 * @db-txn        none
 * @doctrine      cost_statement_is_a_projection_never_a_new_truth, client_market_id_never_authority, hq_evidence_never_exposed_to_market
 * @impact-areas  market, delegation, economic-engine, finance
 * @version       2026-10
 */
'use strict';

const { resolveAuthorization } = require('./market-delegation-team-service');

const MAX_LINES = 500;

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('market-delegation-cost-statement-service: executor.query requis');
  }
  return executor;
}

function statementError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function parseBound(value, label) {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw statementError('COST_STATEMENT_PERIOD_INVALID', `${label} : date invalide.`, 400);
  return date.toISOString();
}

// Seuls les champs que le Market a besoin de comprendre : jamais evidence_ref, notes ni recorded_by (internes siège).
const LINES_SQL = `
  SELECT * FROM (
    SELECT e.id AS event_id, 'MARKET_DIRECT'::text AS origin, e.charge_family_snapshot AS charge_family,
           e.charge_name_snapshot AS charge_name, e.event_kind, e.economic_from, e.economic_to,
           e.amount_kmf::text AS amount_kmf, NULL::text AS allocation_key, NULL::text AS policy_version, e.source_kind
      FROM economic_structure_cost_events e
     WHERE e.scope_kind = 'MARKET_DIRECT' AND e.market_id = $1
       AND ($2::timestamptz IS NULL OR e.economic_to > $2::timestamptz)
       AND ($3::timestamptz IS NULL OR e.economic_from < $3::timestamptz)
    UNION ALL
    SELECT e.id, 'GROUP_ATTRIBUTED', e.charge_family_snapshot, e.charge_name_snapshot, a.event_kind,
           e.economic_from, e.economic_to, a.amount_kmf::text, a.allocation_key, a.policy_version, e.source_kind
      FROM market_cost_attributions a
      JOIN economic_structure_cost_events e ON e.id = a.source_event_id
     WHERE a.market_id = $1
       AND ($2::timestamptz IS NULL OR e.economic_to > $2::timestamptz)
       AND ($3::timestamptz IS NULL OR e.economic_from < $3::timestamptz)
  ) lines
  ORDER BY economic_from DESC, event_id
  LIMIT ${MAX_LINES + 1}`;

const HUB_LINES_SQL = `
  SELECT a.id AS attribution_id, e.id AS event_id,
         e.charge_family_snapshot AS charge_family, e.charge_name_snapshot AS charge_name,
         e.economic_from, e.economic_to, a.amount_kmf::text AS amount_kmf,
         a.allocation_key, a.policy_version, SUM(a.amount_kmf) OVER ()::text AS total_kmf
    FROM market_cost_attributions a
    JOIN economic_structure_cost_events e ON e.id = a.source_event_id
    JOIN economic_cost_posts p ON p.structure_charge_id = e.charge_id
    JOIN economic_cost_centers c ON c.id = p.center_id
   WHERE a.market_id = $1 AND c.market_id IS NULL AND c.code = 'HUB_CENTRAL'
     AND a.event_kind = 'ATTRIBUTION'
     AND e.economic_from >= $2::timestamptz AND e.economic_to <= $3::timestamptz
     AND NOT EXISTS (
       SELECT 1 FROM market_cost_attributions reversal WHERE reversal.reverses_id = a.id
     )
   ORDER BY e.economic_from DESC, a.id
   LIMIT ${MAX_LINES + 1}`;

async function getMarketCostStatement(executor, { marketCode, actorUserId, actorRole = null, from = null, to = null, scope = null }) {
  const db = requireExecutor(executor);
  if (scope !== null && scope !== 'hub') {
    throw statementError('COST_STATEMENT_SCOPE_INVALID', 'Périmètre du relevé invalide.');
  }
  const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (scope === 'hub' && (!isDate(from) || !isDate(to))) {
    throw statementError('COST_STATEMENT_PERIOD_INVALID', 'Deux dates sont requises pour le relevé du Hub.');
  }
  const fromIso = parseBound(from, 'from');
  const toIso = parseBound(to, 'to');
  if (scope === 'hub' && (fromIso.slice(0, 10) !== from || toIso.slice(0, 10) !== to)) {
    throw statementError('COST_STATEMENT_PERIOD_INVALID', 'Date du relevé du Hub invalide.');
  }
  if (fromIso && toIso && toIso <= fromIso) throw statementError('COST_STATEMENT_PERIOD_INVALID', 'to doit être postérieur à from.', 400);

  const authz = await require('./market-delegation-read-authority').resolveCanonicalMarketRead(resolveAuthorization, db, {
    userId: actorUserId, actorRole, marketCode, primaryCapability: 'finance.read',
  });

  if (scope === 'hub') {
    const { rows } = await db.query(HUB_LINES_SQL, [authz.market_id, fromIso, toIso]);
    return {
      market_code: authz.market_code || String(marketCode).toUpperCase(),
      scope: 'HUB_CENTRAL',
      status: 'INTERNAL_STATEMENT',
      period: { from: fromIso, to: toIso },
      currency_basis: 'KMF',
      total_kmf: rows[0]?.total_kmf ?? null,
      truncated: rows.length > MAX_LINES,
      lines: rows.slice(0, MAX_LINES).map(({ total_kmf, ...line }) => line),
    };
  }

  const { rows } = await db.query(LINES_SQL, [authz.market_id, fromIso, toIso]);
  const truncated = rows.length > MAX_LINES;
  const lines = rows.slice(0, MAX_LINES);

  const cents = value => Math.round(Number(value) * 100);
  let direct = 0;
  let attributed = 0;
  for (const line of lines) {
    if (line.origin === 'MARKET_DIRECT') direct += cents(line.amount_kmf);
    else attributed += cents(line.amount_kmf);
  }

  return Object.freeze({
    market_code: authz.market_code || String(marketCode).toUpperCase(),
    period: { from: fromIso, to: toIso },
    currency_basis: 'KMF',
    lines,
    truncated,
    totals: {
      direct_kmf: (direct / 100).toFixed(2),
      group_attributed_kmf: (attributed / 100).toFixed(2),
      total_kmf: ((direct + attributed) / 100).toFixed(2),
    },
    not_covered: ['purchase_rebilling'],
  });
}

module.exports = { MAX_LINES, getMarketCostStatement };
