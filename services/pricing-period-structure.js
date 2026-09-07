/**
 * @komerce-arch
 * @role          economic-engine-pricing-period-structure
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        structure_cost_event, canonical_period_bounds, optional_market_id
 * @outputs       append_only_structure_fact, period_structure_truth
 * @depends       db
 * @used-by       future pricing coverage gate
 * @db-read       charges, economic_structure_cost_events, markets
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
 * Ce lot ne mutualise PAS les pools GROUP vers les marchés. Un marché peut
 * recevoir des coûts MARKET_DIRECT réellement attribuables, mais dès qu'un
 * pool GROUP existe sur la fenêtre, la vérité N3 locale reste
 * NOT_DECISIONAL_SHARED_ALLOCATION_PENDING jusqu'au futur moteur de clé de
 * mutualisation gouvernée.
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

const SOURCE_KINDS = new Set(['INVOICE', 'CONTRACT', 'CONNECTOR', 'MANUAL', 'ADJUSTMENT']);
const CURRENCY_RE = /^[A-Z]{3}$/;
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
    market_n3_decisional: !!marketId && eventCount > 0 && Math.abs(groupPoolKmf) === 0,
    evidence_event_count: eventCount,
    evidence,
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

  return aggregateRows(rows, period, marketId);
}

module.exports = {
  SCOPE_KINDS,
  EVENT_KINDS,
  recordStructureCostEvent,
  computePeriodStructureTruth,
  _aggregateRows: aggregateRows,
  _overlapRatio: overlapRatio,
  _validateMoney: validateMoney,
  _validateScope: validateScope,
  _snapshotFromCharge: snapshotFromCharge,
};
