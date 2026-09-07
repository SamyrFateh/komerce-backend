/**
 * @komerce-arch
 * @role          economic-engine-pricing-period-structure
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        structure_cost_event, canonical_period_bounds, optional_market_id, optional_allocation_policies
 * @outputs       append_only_structure_fact, period_structure_truth, governed_group_allocation
 * @depends       db
 * @used-by       future pricing coverage gate
 * @db-read       charges, economic_structure_cost_events, markets, orders
 * @db-write      economic_structure_cost_events
 * @db-txn        append_only_fact_recording
 * @doctrine      pricing_market_viability_period_structure_truth
 * @impact-areas  economic-engine, pricing, governance
 * @version       2026-09
 */

/**
 * KOMERCE — Vérité N3 de période
 * ════════════════════════════════════════════════════════════════════════
 *
 * `charges` décrit aujourd'hui des références/configurations de structure.
 * Ce service ne les promeut JAMAIS en coûts réels. Les seuls réels N3 qu'il
 * expose proviennent de `economic_structure_cost_events`, avec période,
 * preuve, auteur, FX et périmètre explicites.
 *
 * N3 est volontairement large et non codé par cas particuliers : plateforme,
 * Hub fixe, relais fixe périodique, personnel, locaux, logiciels, fonctions
 * support ou toute nouvelle famille de structure passent par le même journal.
 * La récurrence de `charges` n'est qu'un contexte de configuration : la vérité
 * temporelle est portée par [economic_from,economic_to) sur chaque fait.
 *
 * Les pools GROUP ne sont jamais ventilés par une clé cachée. Une allocation
 * n'est appliquée que si le caller fournit une politique explicite, datée,
 * versionnée, sourcée et couvrant toute la fenêtre économique. L'assiette
 * `PAID_ORDER_COUNT` vient des commandes payées non annulées/non remboursées ;
 * le fallback égalitaire exige une liste de marchés explicite et reste LOW.
 * Si une politique ou une assiette manque, le marché reste NOT_DECISIONAL.
 */

'use strict';

const db = require('../db');

const SCOPE_KINDS = Object.freeze({
  GROUP: 'GROUP',
  MARKET_DIRECT: 'MARKET_DIRECT',
});

const EVENT_KINDS = Object.freeze({
  ACCRUAL: 'ACCRUAL',
  ADJUSTMENT: 'ADJUSTMENT',
  REVERSAL: 'REVERSAL',
});

const ALLOCATION_POLICY_KINDS = Object.freeze({
  PROPORTIONAL: 'PROPORTIONAL',
  BASE_PLUS_MARGINAL: 'BASE_PLUS_MARGINAL',
});

const ALLOCATION_BASIS_KINDS = Object.freeze({
  PAID_ORDER_COUNT: 'PAID_ORDER_COUNT',
  EQUAL_ELIGIBLE: 'EQUAL_ELIGIBLE',
});

const ALLOCATION_ELIGIBILITY_KINDS = Object.freeze({
  POSITIVE_BASIS: 'POSITIVE_BASIS',
  EXPLICIT_MARKETS: 'EXPLICIT_MARKETS',
});

const ALLOCATION_CONFIDENCE = new Set(['high', 'medium', 'low']);
const SOURCE_KINDS = new Set(['INVOICE', 'CONTRACT', 'CONNECTOR', 'MANUAL', 'ADJUSTMENT']);
const CURRENCY_RE = /^[A-Z]{3}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONABLE_FX_TOLERANCE_KMF = 1.01;

function finiteNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a finite number`);
  return parsed;
}

function requiredText(value, field, min = 1, max = 2000) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) {
    throw new Error(`${field} length must be between ${min} and ${max}`);
  }
  return text;
}

function optionalText(value, max = 200) {
  if (value == null || String(value).trim() === '') return null;
  return requiredText(value, 'optional_text', 1, max);
}

function parsePeriod(fromValue, toValue) {
  const from = new Date(fromValue);
  const to = new Date(toValue);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error('economic period bounds are invalid');
  }
  return { from, to };
}

function validateMoney(input) {
  const currency = String(input.currency || '').trim().toUpperCase();
  if (!CURRENCY_RE.test(currency)) throw new Error('currency must be a 3-letter uppercase code');

  const amountOriginal = finiteNumber(input.amount_original, 'amount_original');
  const fxRate = finiteNumber(input.fx_rate_to_kmf, 'fx_rate_to_kmf');
  const amountKmf = finiteNumber(input.amount_kmf, 'amount_kmf');
  if (fxRate <= 0) throw new Error('fx_rate_to_kmf must be > 0');
  if (amountOriginal === 0 || amountKmf === 0) throw new Error('amounts must be non-zero');
  if (currency === 'KMF' && Math.abs(fxRate - 1) > Number.EPSILON) {
    throw new Error('KMF events require fx_rate_to_kmf = 1');
  }

  const expectedKmf = amountOriginal * fxRate;
  if (Math.abs(expectedKmf - amountKmf) > REASONABLE_FX_TOLERANCE_KMF) {
    throw new Error('amount_kmf is inconsistent with amount_original × fx_rate_to_kmf');
  }

  return { currency, amountOriginal, fxRate, amountKmf };
}

function validateEventSemantics(input, money) {
  const eventKind = String(input.event_kind || '').trim().toUpperCase();
  if (!Object.values(EVENT_KINDS).includes(eventKind)) throw new Error('invalid event_kind');

  const adjustsEventId = input.adjusts_event_id || null;
  if (eventKind === EVENT_KINDS.ACCRUAL) {
    if (adjustsEventId) throw new Error('ACCRUAL cannot adjust another event');
    if (money.amountKmf <= 0 || money.amountOriginal <= 0) throw new Error('ACCRUAL amounts must be positive');
  } else {
    if (!adjustsEventId) throw new Error(`${eventKind} requires adjusts_event_id`);
    if (eventKind === EVENT_KINDS.REVERSAL && (money.amountKmf >= 0 || money.amountOriginal >= 0)) {
      throw new Error('REVERSAL amounts must be negative');
    }
  }

  return { eventKind, adjustsEventId };
}

function validateScope(input) {
  const scopeKind = String(input.scope_kind || '').trim().toUpperCase();
  if (!Object.values(SCOPE_KINDS).includes(scopeKind)) throw new Error('invalid scope_kind');

  const marketId = input.market_id || null;
  if (scopeKind === SCOPE_KINDS.GROUP && marketId) {
    throw new Error('GROUP events cannot carry market_id');
  }
  if (scopeKind === SCOPE_KINDS.MARKET_DIRECT && !marketId) {
    throw new Error('MARKET_DIRECT events require market_id');
  }
  return { scopeKind, marketId };
}

function snapshotFromCharge(charge) {
  return {
    family: requiredText(charge.family, 'charge.family', 1, 200),
    name: requiredText(charge.name, 'charge.name', 1, 300),
    recurrencePeriod: optionalText(charge.recurrence_period, 100),
  };
}

async function recordStructureCostEvent(input = {}, actorId) {
  if (!actorId) throw new Error('actorId is required');
  if (!input.charge_id) throw new Error('charge_id is required');

  const period = parsePeriod(input.economic_from, input.economic_to);
  const money = validateMoney(input);
  const semantics = validateEventSemantics(input, money);
  const scope = validateScope(input);
  const sourceKind = String(input.source_kind || '').trim().toUpperCase();
  if (!SOURCE_KINDS.has(sourceKind)) throw new Error('invalid source_kind');

  const evidenceRef = requiredText(input.evidence_ref, 'evidence_ref', 3, 1000);
  const fxSource = requiredText(input.fx_source, 'fx_source', 2, 200);
  const notes = input.notes == null ? null : requiredText(input.notes, 'notes', 1, 2000);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const chargeRes = await client.query(
      `SELECT id, family, name, recurrence_period, is_active
         FROM charges
        WHERE id = $1
        FOR SHARE`,
      [input.charge_id]
    );
    if (!chargeRes.rows.length) throw new Error('charge not found');

    if (scope.marketId) {
      const marketRes = await client.query(
        'SELECT id FROM markets WHERE id = $1 AND is_active = TRUE FOR SHARE',
        [scope.marketId]
      );
      if (!marketRes.rows.length) throw new Error('market not found or inactive');
    }

    let chargeSnapshot = snapshotFromCharge(chargeRes.rows[0]);

    if (semantics.adjustsEventId) {
      const adjustedRes = await client.query(
        `SELECT id, charge_id, scope_kind, market_id,
                charge_family_snapshot, charge_name_snapshot,
                recurrence_period_snapshot
           FROM economic_structure_cost_events
          WHERE id = $1
          FOR SHARE`,
        [semantics.adjustsEventId]
      );
      if (!adjustedRes.rows.length) throw new Error('adjusted event not found');
      const adjusted = adjustedRes.rows[0];
      if (String(adjusted.charge_id) !== String(input.charge_id)) {
        throw new Error('adjustment must keep the original charge_id');
      }
      if (adjusted.scope_kind !== scope.scopeKind || String(adjusted.market_id || '') !== String(scope.marketId || '')) {
        throw new Error('adjustment must keep the original economic scope');
      }

      // Une correction garde l'identité historique du fait corrigé, même si le
      // catalogue `charges` a été renommé/reclassé entre-temps.
      chargeSnapshot = {
        family: adjusted.charge_family_snapshot,
        name: adjusted.charge_name_snapshot,
        recurrencePeriod: adjusted.recurrence_period_snapshot || null,
      };
    }

    const insertRes = await client.query(
      `INSERT INTO economic_structure_cost_events (
         charge_id, charge_family_snapshot, charge_name_snapshot,
         recurrence_period_snapshot,
         scope_kind, market_id, event_kind, adjusts_event_id,
         economic_from, economic_to,
         amount_original, currency, fx_rate_to_kmf, fx_source, amount_kmf,
         source_kind, evidence_ref, notes, recorded_by
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8,
         $9, $10,
         $11, $12, $13, $14, $15,
         $16, $17, $18, $19
       )
       RETURNING id, charge_id, charge_family_snapshot, charge_name_snapshot,
                 recurrence_period_snapshot, scope_kind, market_id,
                 event_kind, adjusts_event_id, economic_from, economic_to,
                 amount_original, currency, fx_rate_to_kmf, fx_source,
                 amount_kmf, source_kind, evidence_ref, notes,
                 recorded_by, recorded_at`,
      [
        input.charge_id, chargeSnapshot.family, chargeSnapshot.name,
        chargeSnapshot.recurrencePeriod,
        scope.scopeKind, scope.marketId,
        semantics.eventKind, semantics.adjustsEventId,
        period.from.toISOString(), period.to.toISOString(),
        money.amountOriginal, money.currency, money.fxRate, fxSource,
        money.amountKmf, sourceKind, evidenceRef, notes, actorId,
      ]
    );

    await client.query('COMMIT');
    return insertRes.rows[0];
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    throw error;
  } finally {
    client.release();
  }
}

function overlapRatio(row, queryFrom, queryTo) {
  const eventFrom = new Date(row.economic_from).getTime();
  const eventTo = new Date(row.economic_to).getTime();
  const overlapFrom = Math.max(eventFrom, queryFrom.getTime());
  const overlapTo = Math.min(eventTo, queryTo.getTime());
  if (overlapTo <= overlapFrom || eventTo <= eventFrom) return 0;
  return (overlapTo - overlapFrom) / (eventTo - eventFrom);
}

function roundKmf(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function aggregateRows(rows, period, marketId) {
  let groupPool = 0;
  let marketDirect = 0;
  let otherMarketDirect = 0;
  let recognizedTotal = 0;
  const evidence = [];
  const byFamily = {};

  for (const row of rows || []) {
    const ratio = overlapRatio(row, period.from, period.to);
    if (ratio <= 0) continue;
    const recognized = Number(row.amount_kmf) * ratio;
    recognizedTotal += recognized;

    if (row.scope_kind === SCOPE_KINDS.GROUP) {
      groupPool += recognized;
    } else if (marketId && String(row.market_id) === String(marketId)) {
      marketDirect += recognized;
    } else {
      otherMarketDirect += recognized;
    }

    const family = row.charge_family_snapshot || 'unknown';
    byFamily[family] = (byFamily[family] || 0) + recognized;

    evidence.push({
      event_id: row.id,
      charge_id: row.charge_id,
      charge_family: row.charge_family_snapshot || null,
      charge_name: row.charge_name_snapshot || null,
      configured_recurrence: row.recurrence_period_snapshot || null,
      scope_kind: row.scope_kind,
      market_id: row.market_id || null,
      event_kind: row.event_kind,
      source_kind: row.source_kind,
      evidence_ref: row.evidence_ref,
      economic_from: row.economic_from,
      economic_to: row.economic_to,
      full_event_amount_kmf: roundKmf(row.amount_kmf),
      overlap_ratio: Number(ratio.toFixed(6)),
      recognized_amount_kmf: roundKmf(recognized),
    });
  }

  const eventCount = evidence.length;
  const groupPoolKmf = roundKmf(groupPool);
  const marketDirectKmf = roundKmf(marketDirect);
  const otherMarketDirectKmf = roundKmf(otherMarketDirect);
  const byFamilyKmf = Object.fromEntries(
    Object.entries(byFamily).map(([family, amount]) => [family, roundKmf(amount)])
  );

  let status;
  if (eventCount === 0) status = 'NOT_DECISIONAL_NO_PERIOD_TRUTH';
  else if (marketId && Math.abs(groupPoolKmf) > 0) status = 'NOT_DECISIONAL_SHARED_ALLOCATION_PENDING';
  else if (marketId) status = 'DIRECT_MARKET_TRUTH_ONLY';
  else status = 'GROUP_PERIOD_TRUTH_AVAILABLE';

  return {
    status,
    truth_level: eventCount > 0 ? 'ACTUAL_PERIOD_EVENTS' : 'NONE',
    period: {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      bounds: '[from,to)',
    },
    market_id: marketId || null,
    group_pool_kmf: groupPoolKmf,
    market_direct_kmf: marketDirectKmf,
    other_market_direct_kmf: otherMarketDirectKmf,
    recognized_total_kmf: roundKmf(recognizedTotal),
    by_family_kmf: byFamilyKmf,
    shared_allocation_applied: false,
    market_shared_n3_kmf: null,
    market_n3_total_kmf: marketId && Math.abs(groupPoolKmf) === 0 ? marketDirectKmf : null,
    market_n3_decisional: !!marketId && eventCount > 0 && Math.abs(groupPoolKmf) === 0,
    evidence_event_count: eventCount,
    evidence,
  };
}

function normalizeAllocationPolicy(policy, period) {
  if (!policy || typeof policy !== 'object') throw new Error('allocation policy must be an object');

  const chargeId = requiredText(policy.charge_id, 'allocation_policy.charge_id', 1, 200);
  const version = requiredText(policy.version, 'allocation_policy.version', 1, 100);
  const source = requiredText(policy.source, 'allocation_policy.source', 3, 500);
  const evidenceRef = requiredText(policy.evidence_ref, 'allocation_policy.evidence_ref', 3, 1000);
  const kind = String(policy.policy_kind || '').trim().toUpperCase();
  const basisKind = String(policy.basis_kind || '').trim().toUpperCase();
  const eligibilityKind = String(policy.eligibility_kind || '').trim().toUpperCase();
  const confidence = String(policy.confidence || '').trim().toLowerCase();

  if (!Object.values(ALLOCATION_POLICY_KINDS).includes(kind)) throw new Error('invalid allocation policy_kind');
  if (!Object.values(ALLOCATION_BASIS_KINDS).includes(basisKind)) throw new Error('invalid allocation basis_kind');
  if (!Object.values(ALLOCATION_ELIGIBILITY_KINDS).includes(eligibilityKind)) {
    throw new Error('invalid allocation eligibility_kind');
  }
  if (!ALLOCATION_CONFIDENCE.has(confidence)) throw new Error('invalid allocation confidence');

  const effectiveFrom = new Date(policy.effective_from);
  const effectiveTo = policy.effective_to == null ? null : new Date(policy.effective_to);
  if (!Number.isFinite(effectiveFrom.getTime())) throw new Error('allocation policy effective_from is invalid');
  if (effectiveTo && (!Number.isFinite(effectiveTo.getTime()) || effectiveTo <= effectiveFrom)) {
    throw new Error('allocation policy effective_to is invalid');
  }

  let basePoolRatio = policy.base_pool_ratio == null ? 0 : finiteNumber(policy.base_pool_ratio, 'base_pool_ratio');
  if (kind === ALLOCATION_POLICY_KINDS.PROPORTIONAL) {
    if (Math.abs(basePoolRatio) > Number.EPSILON) {
      throw new Error('PROPORTIONAL policy requires base_pool_ratio = 0');
    }
    basePoolRatio = 0;
  } else if (!(basePoolRatio > 0 && basePoolRatio < 1)) {
    throw new Error('BASE_PLUS_MARGINAL requires 0 < base_pool_ratio < 1');
  }

  const explicitMarkets = [...new Set((policy.eligible_market_ids || []).map((id) => String(id).trim()).filter(Boolean))];
  if (eligibilityKind === ALLOCATION_ELIGIBILITY_KINDS.EXPLICIT_MARKETS) {
    if (!explicitMarkets.length) throw new Error('EXPLICIT_MARKETS requires eligible_market_ids');
    if (explicitMarkets.some((id) => !UUID_RE.test(id))) throw new Error('eligible_market_ids must contain UUIDs');
  } else if (explicitMarkets.length) {
    throw new Error('POSITIVE_BASIS cannot carry eligible_market_ids');
  }

  if (basisKind === ALLOCATION_BASIS_KINDS.EQUAL_ELIGIBLE) {
    if (eligibilityKind !== ALLOCATION_ELIGIBILITY_KINDS.EXPLICIT_MARKETS) {
      throw new Error('EQUAL_ELIGIBLE requires EXPLICIT_MARKETS');
    }
    if (confidence !== 'low') throw new Error('EQUAL_ELIGIBLE must remain low confidence');
    if (kind !== ALLOCATION_POLICY_KINDS.PROPORTIONAL) {
      throw new Error('EQUAL_ELIGIBLE only supports PROPORTIONAL policy');
    }
  }

  const coversPeriod = effectiveFrom <= period.from && (!effectiveTo || effectiveTo >= period.to);

  return {
    charge_id: chargeId,
    version,
    source,
    evidence_ref: evidenceRef,
    policy_kind: kind,
    basis_kind: basisKind,
    eligibility_kind: eligibilityKind,
    confidence,
    base_pool_ratio: basePoolRatio,
    effective_from: effectiveFrom.toISOString(),
    effective_to: effectiveTo ? effectiveTo.toISOString() : null,
    eligible_market_ids: explicitMarkets,
    covers_period: coversPeriod,
  };
}

function allocateConserving(totalKmf, weightedRows) {
  const total = roundKmf(totalKmf);
  const cents = Math.round(total * 100);
  if (cents < 0) throw new Error('group pool must not be negative for allocation');
  if (!weightedRows.length) return [];

  const raw = weightedRows.map((row, index) => {
    const ratio = Number(row.ratio);
    if (!Number.isFinite(ratio) || ratio < 0) throw new Error('allocation ratio must be >= 0');
    const rawCents = cents * ratio;
    const floorCents = Math.floor(rawCents + Number.EPSILON);
    return {
      index,
      market_id: row.market_id,
      basis_value: row.basis_value,
      ratio,
      floorCents,
      remainder: rawCents - floorCents,
    };
  });

  let remaining = cents - raw.reduce((sum, row) => sum + row.floorCents, 0);
  const order = [...raw].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return String(a.market_id).localeCompare(String(b.market_id));
  });
  for (let i = 0; i < remaining; i += 1) order[i % order.length].floorCents += 1;

  return raw
    .sort((a, b) => a.index - b.index)
    .map((row) => ({
      market_id: row.market_id,
      basis_value: row.basis_value,
      allocation_ratio: Number(row.ratio.toFixed(8)),
      allocated_kmf: row.floorCents / 100,
    }));
}

function allocateChargePool(poolKmf, policy, basisRows) {
  const pool = roundKmf(poolKmf);
  if (pool < 0) {
    return { status: 'NOT_DECISIONAL_NON_POSITIVE_POOL', decisional: false, shares: [] };
  }
  if (pool === 0) {
    return { status: 'NO_GROUP_POOL', decisional: true, shares: [], conservation_ok: true };
  }
  if (!basisRows.length) {
    return { status: 'NOT_DECISIONAL_NO_ELIGIBLE_MARKET', decisional: false, shares: [] };
  }

  const totalBasis = basisRows.reduce((sum, row) => sum + Number(row.basis_value || 0), 0);
  if (!(totalBasis > 0)) {
    return { status: 'NOT_DECISIONAL_ZERO_BASIS', decisional: false, shares: [] };
  }

  const count = basisRows.length;
  const weighted = basisRows.map((row) => {
    const marginal = Number(row.basis_value || 0) / totalBasis;
    const ratio = policy.policy_kind === ALLOCATION_POLICY_KINDS.BASE_PLUS_MARGINAL
      ? (policy.base_pool_ratio / count) + ((1 - policy.base_pool_ratio) * marginal)
      : marginal;
    return { ...row, ratio };
  });

  const shares = allocateConserving(pool, weighted);
  const allocatedTotal = roundKmf(shares.reduce((sum, row) => sum + row.allocated_kmf, 0));
  const conservationOk = allocatedTotal === pool;
  if (!conservationOk) {
    return { status: 'NOT_DECISIONAL_CONSERVATION_FAILURE', decisional: false, shares };
  }

  return {
    status: 'ALLOCATED',
    decisional: true,
    shares,
    allocated_total_kmf: allocatedTotal,
    conservation_ok: true,
  };
}

function groupPoolsByCharge(evidence = []) {
  const pools = new Map();
  for (const row of evidence) {
    if (row.scope_kind !== SCOPE_KINDS.GROUP) continue;
    const chargeId = String(row.charge_id);
    const current = pools.get(chargeId) || {
      charge_id: chargeId,
      charge_family: row.charge_family || null,
      charge_name: row.charge_name || null,
      group_pool_kmf: 0,
      evidence_event_ids: [],
    };
    current.group_pool_kmf += Number(row.recognized_amount_kmf || 0);
    current.evidence_event_ids.push(row.event_id);
    pools.set(chargeId, current);
  }
  return [...pools.values()].map((pool) => ({
    ...pool,
    group_pool_kmf: roundKmf(pool.group_pool_kmf),
  })).filter((pool) => pool.group_pool_kmf !== 0);
}

async function loadPaidOrderCountBasis(period) {
  const { rows } = await db.query(
    `SELECT o.market_id, COUNT(*)::numeric AS basis_value
       FROM orders o
      WHERE o.created_at >= $1
        AND o.created_at < $2
        AND o.market_id IS NOT NULL
        AND o.payment_status = 'paid'
        AND COALESCE(o.status, '') NOT IN ('cancelled', 'refunded')
      GROUP BY o.market_id
      ORDER BY o.market_id ASC`,
    [period.from.toISOString(), period.to.toISOString()]
  );

  return (rows || []).map((row) => ({
    market_id: String(row.market_id),
    basis_value: Number(row.basis_value || 0),
  }));
}

async function validateExplicitMarkets(marketIds) {
  const { rows } = await db.query(
    'SELECT id FROM markets WHERE id = ANY($1::uuid[]) ORDER BY id ASC',
    [marketIds]
  );
  const known = new Set((rows || []).map((row) => String(row.id)));
  return marketIds.filter((id) => known.has(String(id)));
}

async function resolveBasis(policy, period, basisCache) {
  if (policy.basis_kind === ALLOCATION_BASIS_KINDS.EQUAL_ELIGIBLE) {
    const knownMarkets = await validateExplicitMarkets(policy.eligible_market_ids);
    if (knownMarkets.length !== policy.eligible_market_ids.length) {
      return {
        status: 'NOT_DECISIONAL_UNKNOWN_MARKET',
        decisional: false,
        rows: [],
        basis_source: 'explicit governed market set',
      };
    }
    return {
      status: 'BASIS_AVAILABLE',
      decisional: true,
      rows: knownMarkets.map((marketId) => ({ market_id: marketId, basis_value: 1 })),
      basis_source: 'explicit equal fallback',
    };
  }

  if (!basisCache.paidOrders) basisCache.paidOrders = await loadPaidOrderCountBasis(period);
  const observed = basisCache.paidOrders;

  if (policy.eligibility_kind === ALLOCATION_ELIGIBILITY_KINDS.POSITIVE_BASIS) {
    return {
      status: 'BASIS_AVAILABLE',
      decisional: true,
      rows: observed.filter((row) => row.basis_value > 0),
      basis_source: 'orders.created_at + payment_status=paid + non-cancelled/non-refunded',
    };
  }

  const knownMarkets = await validateExplicitMarkets(policy.eligible_market_ids);
  if (knownMarkets.length !== policy.eligible_market_ids.length) {
    return {
      status: 'NOT_DECISIONAL_UNKNOWN_MARKET',
      decisional: false,
      rows: [],
      basis_source: 'orders.created_at + explicit governed market set',
    };
  }
  const byMarket = new Map(observed.map((row) => [String(row.market_id), row.basis_value]));
  return {
    status: 'BASIS_AVAILABLE',
    decisional: true,
    rows: knownMarkets.map((marketId) => ({
      market_id: marketId,
      basis_value: Number(byMarket.get(String(marketId)) || 0),
    })),
    basis_source: 'orders.created_at + payment_status=paid + explicit governed market set',
  };
}

async function allocateGroupPools(truth, period, marketId, rawPolicies) {
  const pools = groupPoolsByCharge(truth.evidence);
  if (!pools.length) {
    return {
      status: 'NO_GROUP_POOL',
      decisional: true,
      group_pool_kmf: 0,
      allocated_group_pool_kmf: 0,
      unallocated_group_pool_kmf: 0,
      market_shared_n3_kmf: 0,
      charges: [],
    };
  }

  const policies = (rawPolicies || []).map((policy) => normalizeAllocationPolicy(policy, period));
  const basisCache = {};
  const charges = [];
  let allocatedGroupPool = 0;
  let marketPartial = 0;

  for (const pool of pools) {
    const candidates = policies.filter((policy) => (
      String(policy.charge_id) === String(pool.charge_id) && policy.covers_period
    ));

    if (candidates.length === 0) {
      charges.push({
        ...pool,
        status: 'NOT_DECISIONAL_POLICY_MISSING',
        decisional: false,
        policy: null,
        shares: [],
      });
      continue;
    }
    if (candidates.length > 1) {
      charges.push({
        ...pool,
        status: 'NOT_DECISIONAL_POLICY_AMBIGUOUS',
        decisional: false,
        policy: null,
        shares: [],
      });
      continue;
    }

    const policy = candidates[0];
    const basis = await resolveBasis(policy, period, basisCache);
    if (!basis.decisional) {
      charges.push({
        ...pool,
        status: basis.status,
        decisional: false,
        policy,
        basis_source: basis.basis_source,
        shares: [],
      });
      continue;
    }

    const allocation = allocateChargePool(pool.group_pool_kmf, policy, basis.rows);
    charges.push({
      ...pool,
      ...allocation,
      policy,
      basis_source: basis.basis_source,
      basis_total: basis.rows.reduce((sum, row) => sum + Number(row.basis_value || 0), 0),
    });

    if (allocation.decisional) {
      allocatedGroupPool += pool.group_pool_kmf;
      const marketShare = allocation.shares.find((share) => String(share.market_id) === String(marketId));
      marketPartial += Number(marketShare?.allocated_kmf || 0);
    }
  }

  const groupPool = roundKmf(pools.reduce((sum, pool) => sum + pool.group_pool_kmf, 0));
  allocatedGroupPool = roundKmf(allocatedGroupPool);
  const allDecisional = charges.every((charge) => charge.decisional);

  return {
    status: allDecisional ? 'GROUP_ALLOCATION_AVAILABLE' : 'NOT_DECISIONAL_GROUP_ALLOCATION',
    decisional: allDecisional,
    group_pool_kmf: groupPool,
    allocated_group_pool_kmf: allocatedGroupPool,
    unallocated_group_pool_kmf: roundKmf(groupPool - allocatedGroupPool),
    market_shared_n3_kmf: allDecisional ? roundKmf(marketPartial) : null,
    market_shared_partial_kmf: roundKmf(marketPartial),
    conservation_ok: allDecisional && allocatedGroupPool === groupPool,
    charges,
  };
}

async function computePeriodStructureTruth(options = {}) {
  const period = parsePeriod(options.from, options.to);
  const marketId = options.marketId || null;

  const { rows } = await db.query(
    `SELECT e.id, e.charge_id,
            e.charge_family_snapshot, e.charge_name_snapshot,
            e.recurrence_period_snapshot,
            e.scope_kind, e.market_id, e.event_kind, e.adjusts_event_id,
            e.economic_from, e.economic_to,
            e.amount_kmf, e.source_kind, e.evidence_ref,
            e.recorded_by, e.recorded_at
       FROM economic_structure_cost_events e
      WHERE e.economic_from < $2
        AND e.economic_to > $1
        AND ($3::uuid IS NULL OR e.scope_kind = 'GROUP' OR e.market_id = $3::uuid)
      ORDER BY e.economic_from ASC, e.recorded_at ASC, e.id ASC`,
    [period.from.toISOString(), period.to.toISOString(), marketId]
  );

  const truth = aggregateRows(rows, period, marketId);
  if (!marketId || Math.abs(truth.group_pool_kmf) === 0 || options.allocationPolicies == null) {
    return truth;
  }

  const allocation = await allocateGroupPools(
    truth,
    period,
    marketId,
    options.allocationPolicies
  );

  if (!allocation.decisional) {
    return {
      ...truth,
      status: 'NOT_DECISIONAL_SHARED_ALLOCATION_POLICY',
      allocation,
      shared_allocation_applied: false,
      market_shared_n3_kmf: null,
      market_n3_total_kmf: null,
      market_n3_decisional: false,
    };
  }

  const marketShared = allocation.market_shared_n3_kmf;
  return {
    ...truth,
    status: 'MARKET_PERIOD_TRUTH_ALLOCATED',
    allocation,
    shared_allocation_applied: true,
    market_shared_n3_kmf: marketShared,
    market_n3_total_kmf: roundKmf(truth.market_direct_kmf + marketShared),
    market_n3_decisional: true,
  };
}

module.exports = {
  SCOPE_KINDS,
  EVENT_KINDS,
  ALLOCATION_POLICY_KINDS,
  ALLOCATION_BASIS_KINDS,
  ALLOCATION_ELIGIBILITY_KINDS,
  recordStructureCostEvent,
  computePeriodStructureTruth,
  _aggregateRows: aggregateRows,
  _overlapRatio: overlapRatio,
  _validateMoney: validateMoney,
  _validateScope: validateScope,
  _snapshotFromCharge: snapshotFromCharge,
  _normalizeAllocationPolicy: normalizeAllocationPolicy,
  _allocateConserving: allocateConserving,
  _allocateChargePool: allocateChargePool,
  _groupPoolsByCharge: groupPoolsByCharge,
};