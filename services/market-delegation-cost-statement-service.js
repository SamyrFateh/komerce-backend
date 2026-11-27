/**
 * @komerce-arch
 * @role          market-delegation-cost-statement-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        authenticated market operator, market code, optional economic period (from/to)
 * @outputs       relevé de coûts du marché : charges directes + charges mutualisées attribuées, en lecture seule
 * @depends       services/market-delegation-team-service.js, services/fx-authority.js
 * @used-by       routes/market-delegation-cost-statement.js
 * @db-read       economic_structure_cost_events, market_cost_attributions, markets, economic_cost_posts, economic_cost_centers, currency_parities, hub_internal_invoices
 * @db-write      none
 * @db-txn        none
 * @doctrine      cost_statement_is_a_projection_never_a_new_truth, client_market_id_never_authority, hq_evidence_never_exposed_to_market
 * @impact-areas  market, delegation, economic-engine, finance
 * @version       2026-10
 */
'use strict';

const { resolveAuthorization } = require('./market-delegation-team-service');
const fxAuthority = require('./fx-authority');

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
   WHERE a.market_id = $1 AND EXISTS (
      SELECT 1 FROM economic_cost_posts p JOIN economic_cost_centers c ON c.id=p.center_id
      WHERE p.structure_charge_id=e.charge_id AND c.market_id IS NULL AND c.code = 'HUB_CENTRAL'
   )
     AND a.event_kind = 'ATTRIBUTION'
     AND e.economic_from >= $2::timestamptz AND e.economic_to <= $3::timestamptz
     AND NOT EXISTS (
       SELECT 1 FROM market_cost_attributions reversal WHERE reversal.reverses_id = a.id
     )
   ORDER BY e.economic_from DESC, a.id
   LIMIT ${MAX_LINES + 1}`;

// A charge crossing the requested bounds must be reconciled, not silently omitted.
const HUB_CROSS_PERIOD_SQL = `
  WITH hub_events AS (
    SELECT e.id,e.economic_from,e.economic_to,e.event_kind,e.amount_kmf
      FROM economic_structure_cost_events e
     WHERE e.scope_kind='GROUP'
       AND e.economic_from < $3::timestamptz AND e.economic_to > $2::timestamptz
       AND EXISTS (
         SELECT 1 FROM economic_cost_posts p JOIN economic_cost_centers c ON c.id=p.center_id
          WHERE p.structure_charge_id=e.charge_id AND c.market_id IS NULL AND c.code='HUB_CENTRAL'
       )
  ), active AS (
    SELECT a.id,a.source_event_id,a.market_id,a.amount_kmf
      FROM market_cost_attributions a JOIN hub_events e ON e.id=a.source_event_id
     WHERE a.event_kind='ATTRIBUTION'
       AND NOT EXISTS (SELECT 1 FROM market_cost_attributions r WHERE r.reverses_id=a.id)
  )
  SELECT (SELECT COUNT(*)::int FROM active a JOIN hub_events e ON e.id=a.source_event_id
           WHERE a.market_id=$1
             AND NOT(e.economic_from >= $2::timestamptz AND e.economic_to <= $3::timestamptz)) AS crossing_count,
         EXISTS (SELECT 1 FROM hub_events e
          WHERE e.event_kind<>'ACCRUAL'
             OR EXISTS (SELECT 1 FROM economic_structure_cost_events adj WHERE adj.adjusts_event_id=e.id)
             OR COALESCE((SELECT SUM(a.amount_kmf) FROM active a WHERE a.source_event_id=e.id),0)<>e.amount_kmf
         ) AS pool_unreconciled`;

async function hubInformationalTotals(client, amountKmf) {
  if (amountKmf === null) return null;
  try {
    const [eur, xaf] = await Promise.all(['EUR', 'XAF'].map(to =>
      fxAuthority.convert({ client, amount: amountKmf, from: 'KMF', to })
    ));
    const kmfRate = eur.legs.find(leg => leg.side === 'from');
    const xafKmfRate = xaf.legs.find(leg => leg.side === 'from');
    if (kmfRate.id !== xafKmfRate.id || kmfRate.rate !== xafKmfRate.rate) {
      return { status: 'UNAVAILABLE' };
    }
    return {
      status: 'AVAILABLE',
      EUR: { amount: eur.amount_text, legs: eur.legs, rounding: eur.rounding },
      XAF: { amount: xaf.amount_text, legs: xaf.legs, rounding: xaf.rounding },
    };
  } catch (error) {
    if (error instanceof fxAuthority.FxError && error.code === 'fx_rate_unavailable') {
      return { status: 'UNAVAILABLE' };
    }
    throw error;
  }
}

function statementPeriod(from, to, scope) {
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

  return { fromIso, toIso };
}

async function readHubStatement(db, { marketId, marketCode, fromIso, toIso }) {
  const { rows } = await db.query(HUB_LINES_SQL, [marketId, fromIso, toIso]);
  const totalKmf = rows[0]?.total_kmf ?? null;
  const {rows:[crossing]} = await db.query(HUB_CROSS_PERIOD_SQL, [marketId, fromIso, toIso]);
  const crossingCount=Number.isSafeInteger(crossing?.crossing_count)?crossing.crossing_count:null;
  const poolUnreconciled=typeof crossing?.pool_unreconciled==='boolean'?crossing.pool_unreconciled:null;
  return {
    market_code: marketCode,
    scope: 'HUB_CENTRAL',
    status: 'INTERNAL_STATEMENT',
    period: { from: fromIso, to: toIso },
    currency_basis: 'KMF',
    total_kmf: totalKmf,
    informational_totals: await hubInformationalTotals(db, totalKmf),
    truncated: rows.length > MAX_LINES,
    coverage: { cross_period_attribution_count: crossingCount,
      status: crossingCount===null||poolUnreconciled===null?'UNKNOWN':crossingCount>0?'CROSS_PERIOD_RECONCILIATION_REQUIRED':poolUnreconciled?'POOL_RECONCILIATION_REQUIRED':'NO_CROSS_PERIOD_ATTRIBUTIONS' },
    lines: rows.slice(0, MAX_LINES).map(({ total_kmf, ...line }) => line),
  };
}

// One immutable invoice is the authority for both reciprocal management balances.
// This is neither a double-entry journal nor a new economic expense or sale.
function projectHubInvoiceBalance(invoice) {
  if(!invoice)return null;
  const amount=String(invoice.amount_kmf);
  const outstanding=invoice.paid_at?'0.00':amount;
  return {currency:'KMF',invoice_amount_kmf:amount,
    hub_receivable_kmf:outstanding,market_payable_kmf:outstanding,
    settlement_status:invoice.paid_at?'PAYMENT_ATTESTED':'OUTSTANDING',
    group_treatment:'INTERNAL_BALANCE_NOT_ADDITIONAL_ECONOMIC_COST_OR_SALE'};
}
function statementFacts(statement) {
  if(!statement || !Array.isArray(statement.lines))return null;
  return JSON.stringify([statement.total_kmf,statement.lines.map(line=>[
    line.attribution_id,line.event_id,line.amount_kmf,line.economic_from,line.economic_to,
    line.allocation_key,line.policy_version
  ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
}
function hubInvoiceAdjustmentRequired(invoice,current) {
  const frozen=statementFacts(invoice.statement_snapshot);
  return frozen===null || frozen!==statementFacts(current)
    || current.truncated || current.coverage?.status!=='NO_CROSS_PERIOD_ATTRIBUTIONS';
}
// A late change is a review proposal linked to the frozen invoice, not a new
// invoice, credit note, cash movement or mutation of the settled balance.
function projectHubAdjustment(invoice,current) {
  if(!hubInvoiceAdjustmentRequired(invoice,current))return null;
  const blocked={invoice_id:invoice.id,status:'RECONCILIATION_REQUIRED',currency:'KMF',delta_kmf:null};
  if(current.truncated || current.coverage?.status!=='NO_CROSS_PERIOD_ATTRIBUTIONS' || current.total_kmf==null)return blocked;
  function cents(value) {
    const m=/^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
    return m?BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0')):null;
  }
  const original=cents(invoice.amount_kmf),revised=cents(current.total_kmf);
  if(original===null||revised===null)return blocked;
  const delta=revised-original,abs=delta<0n?-delta:delta;
  return {invoice_id:invoice.id,status:'REVIEW_REQUIRED',currency:'KMF',
    delta_kmf:(delta<0n?'-':'')+(abs/100n).toString()+'.'+(abs%100n).toString().padStart(2,'0')};
}
// Explicit allowlist for the market reader: never expose central actors or arbitrary snapshot keys.
function publicHubInvoice(invoice) {
  const frozen=invoice.statement_snapshot;
  const statement_snapshot=frozen && Array.isArray(frozen.lines)?{
    market_code:frozen.market_code,scope:'HUB_CENTRAL',status:'INTERNAL_STATEMENT',
    period:{from:frozen.period?.from,to:frozen.period?.to},currency_basis:'KMF',
    total_kmf:String(invoice.amount_kmf),truncated:!!frozen.truncated,
    informational_totals:frozen.informational_totals?{
      status:frozen.informational_totals.status,
      EUR:frozen.informational_totals.EUR?{amount:frozen.informational_totals.EUR.amount}:undefined,
      XAF:frozen.informational_totals.XAF?{amount:frozen.informational_totals.XAF.amount}:undefined,
    }:null,
    lines:frozen.lines.map(line=>({
      attribution_id:line.attribution_id,event_id:line.event_id,charge_family:line.charge_family,
      charge_name:line.charge_name,economic_from:line.economic_from,economic_to:line.economic_to,
      amount_kmf:line.amount_kmf,allocation_key:line.allocation_key,policy_version:line.policy_version,
    })),
  }:null;
  return {id:invoice.id,period_from:invoice.period_from,period_to:invoice.period_to,
    amount_kmf:String(invoice.amount_kmf),issued_at:invoice.issued_at,paid_at:invoice.paid_at,
    status:invoice.paid_at?'PAID':'ISSUED',statement_snapshot,balance:projectHubInvoiceBalance(invoice)};
}
async function readMarketHubInvoice(db,{marketId,from,to,statement}) {
  const {rows:[invoice]}=await db.query(
    `SELECT id,period_from,period_to,amount_kmf::text AS amount_kmf,issued_at,paid_at,statement_snapshot,
            (period_from=$2::date AND period_to=$3::date) AS exact_period
       FROM hub_internal_invoices
      WHERE market_id=$1 AND period_from<$3::date AND period_to>$2::date
      ORDER BY exact_period DESC,period_from,id LIMIT 1`,[marketId,from,to]);
  if(!invoice)return {...statement,invoice:null};
  if(!invoice.exact_period)return {...statement,invoice:null,overlapping_invoice_id:invoice.id};
  return {...statement,invoice:publicHubInvoice(invoice),
    adjustment_required:hubInvoiceAdjustmentRequired(invoice,statement),adjustment:projectHubAdjustment(invoice,statement)};
}

async function getMarketCostStatement(executor, { marketCode, actorUserId, actorRole = null, from = null, to = null, scope = null }) {
  const db = requireExecutor(executor);
  if (scope !== null && scope !== 'hub') {
    throw statementError('COST_STATEMENT_SCOPE_INVALID', 'Périmètre du relevé invalide.');
  }
  const { fromIso, toIso } = statementPeriod(from, to, scope);

  const authz = await require('./market-delegation-read-authority').resolveCanonicalMarketRead(resolveAuthorization, db, {
    userId: actorUserId, actorRole, marketCode, primaryCapability: 'finance.read',
  });

  if (scope === 'hub') {
    const statement=await readHubStatement(db, { marketId: authz.market_id, marketCode: authz.market_code || String(marketCode).toUpperCase(), fromIso, toIso });
    return readMarketHubInvoice(db,{marketId:authz.market_id,from,to,statement});
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

module.exports = { MAX_LINES, getMarketCostStatement, readHubStatement, statementPeriod, projectHubInvoiceBalance, hubInvoiceAdjustmentRequired, projectHubAdjustment };
