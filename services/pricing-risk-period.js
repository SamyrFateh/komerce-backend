/**
 * @komerce-arch
 * @role          economic-engine-pricing-risk-period
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        risk_cost_event, risk_review_watermark, market_period
 * @outputs       append_only_risk_fact, risk_period_truth
 * @depends       db
 * @used-by       services/pricing-market-coverage.js
 * @db-read       economic_risk_cost_events, economic_risk_watermark_events, markets, orders, risk_provisions
 * @db-write      economic_risk_cost_events, economic_risk_watermark_events
 * @db-txn        append_only_fact_recording
 * @doctrine      pricing_market_viability_period_risk_truth
 * @impact-areas  economic-engine, pricing, governance
 * @version       2026-09
 */

/**
 * KOMERCE — Vérité risque N2 de période
 * ════════════════════════════════════════════════════════════════════════
 *
 * `risk_provisions` décrit une anticipation. Ce service porte le réalisé.
 * L'absence de sinistre n'est jamais assimilée à zéro sans watermark de revue
 * explicite. Une écriture backdatée postérieure à la certification rend la
 * fenêtre stale jusqu'à une nouvelle certification.
 *
 * Les corrections sont append-only et gardent market/order/catégorie/date
 * économique du fait original. Ainsi, personne ne peut déplacer une perte vers
 * une autre période pour améliorer artificiellement un ratio de couverture.
 */

'use strict';

const db = require('../db');

const EVENT_KINDS = Object.freeze({
  ACCRUAL: 'ACCRUAL',
  ADJUSTMENT: 'ADJUSTMENT',
  REVERSAL: 'REVERSAL',
});

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

function optionalText(value, max = 2000) {
  if (value == null || String(value).trim() === '') return null;
  return requiredText(value, 'optional_text', 1, max);
}

function parsePeriod(fromValue, toValue) {
  const from = new Date(fromValue);
  const to = new Date(toValue);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error('risk period bounds are invalid');
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
  if (Math.abs((amountOriginal * fxRate) - amountKmf) > REASONABLE_FX_TOLERANCE_KMF) {
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

function roundKmf(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function resolveMarketAndOrder(input, client) {
  const requestedMarketId = input.market_id ? String(input.market_id) : null;
  if (input.order_id) {
    const orderRes = await client.query(
      'SELECT id, market_id, reference FROM orders WHERE id = $1 FOR SHARE',
      [input.order_id]
    );
    if (!orderRes.rows.length) throw new Error('order not found');
    const order = orderRes.rows[0];
    if (!order.market_id) throw new Error('order market_id is required for risk truth');
    if (requestedMarketId && String(order.market_id) !== requestedMarketId) {
      throw new Error('risk event market_id does not match order market_id');
    }
    return {
      marketId: String(order.market_id),
      orderId: String(order.id),
      orderReference: order.reference || null,
    };
  }

  if (!requestedMarketId) throw new Error('market_id is required when order_id is absent');
  const marketRes = await client.query('SELECT id FROM markets WHERE id = $1 FOR SHARE', [requestedMarketId]);
  if (!marketRes.rows.length) throw new Error('market not found');
  return { marketId: requestedMarketId, orderId: null, orderReference: null };
}

async function resolveRiskIdentity(input, client) {
  if (input.risk_provision_id) {
    const provisionRes = await client.query(
      'SELECT id, key, label FROM risk_provisions WHERE id = $1 FOR SHARE',
      [input.risk_provision_id]
    );
    if (!provisionRes.rows.length) throw new Error('risk provision not found');
    const provision = provisionRes.rows[0];
    return {
      riskProvisionId: String(provision.id),
      key: requiredText(provision.key, 'risk_provision.key', 1, 200),
      label: requiredText(provision.label, 'risk_provision.label', 1, 300),
    };
  }

  return {
    riskProvisionId: null,
    key: requiredText(input.risk_key, 'risk_key', 1, 200),
    label: requiredText(input.risk_label, 'risk_label', 1, 300),
  };
}

async function recordRiskCostEvent(input = {}, actorId) {
  if (!actorId) throw new Error('actorId is required');
  const money = validateMoney(input);
  const semantics = validateEventSemantics(input, money);
  const sourceKind = requiredText(input.source_kind, 'source_kind', 2, 100).toUpperCase();
  const evidenceRef = requiredText(input.evidence_ref, 'evidence_ref', 3, 1000);
  const fxSource = requiredText(input.fx_source, 'fx_source', 2, 200);
  const notes = optionalText(input.notes, 2000);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    let marketOrder;
    let riskIdentity;
    let economicAt;

    if (semantics.adjustsEventId) {
      const adjustedRes = await client.query(
        `SELECT id, market_id, order_id, risk_provision_id,
                risk_key_snapshot, risk_label_snapshot, event_kind, economic_at
           FROM economic_risk_cost_events
          WHERE id = $1
          FOR SHARE`,
        [semantics.adjustsEventId]
      );
      if (!adjustedRes.rows.length) throw new Error('adjusted risk event not found');
      const original = adjustedRes.rows[0];
      if (original.event_kind !== EVENT_KINDS.ACCRUAL) {
        throw new Error('risk corrections must point to the original ACCRUAL');
      }

      if (input.market_id && String(input.market_id) !== String(original.market_id)) {
        throw new Error('risk correction cannot move market_id');
      }
      if (input.order_id && String(input.order_id) !== String(original.order_id || '')) {
        throw new Error('risk correction cannot move order_id');
      }
      if (input.risk_provision_id
          && String(input.risk_provision_id) !== String(original.risk_provision_id || '')) {
        throw new Error('risk correction cannot move risk_provision_id');
      }

      marketOrder = {
        marketId: String(original.market_id),
        orderId: original.order_id ? String(original.order_id) : null,
      };
      riskIdentity = {
        riskProvisionId: original.risk_provision_id ? String(original.risk_provision_id) : null,
        key: original.risk_key_snapshot,
        label: original.risk_label_snapshot,
      };
      economicAt = new Date(original.economic_at);
    } else {
      marketOrder = await resolveMarketAndOrder(input, client);
      riskIdentity = await resolveRiskIdentity(input, client);
      economicAt = new Date(input.economic_at);
      if (!Number.isFinite(economicAt.getTime())) throw new Error('economic_at is invalid');
    }

    const insertRes = await client.query(
      `INSERT INTO economic_risk_cost_events (
         market_id, order_id, risk_provision_id,
         risk_key_snapshot, risk_label_snapshot,
         event_kind, adjusts_event_id, economic_at,
         amount_original, currency, fx_rate_to_kmf, fx_source, amount_kmf,
         source_kind, evidence_ref, notes, recorded_by
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8,
         $9, $10, $11, $12, $13,
         $14, $15, $16, $17
       )
       RETURNING *`,
      [
        marketOrder.marketId,
        marketOrder.orderId,
        riskIdentity.riskProvisionId,
        riskIdentity.key,
        riskIdentity.label,
        semantics.eventKind,
        semantics.adjustsEventId,
        economicAt.toISOString(),
        money.amountOriginal,
        money.currency,
        money.fxRate,
        fxSource,
        money.amountKmf,
        sourceKind,
        evidenceRef,
        notes,
        actorId,
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

async function recordRiskWatermark(input = {}, actorId) {
  if (!actorId) throw new Error('actorId is required');
  const marketId = requiredText(input.market_id, 'market_id', 1, 200);
  const closedThrough = new Date(input.closed_through);
  if (!Number.isFinite(closedThrough.getTime())) throw new Error('closed_through is invalid');
  const reviewVersion = requiredText(input.review_version, 'review_version', 1, 100);
  const source = requiredText(input.source, 'source', 3, 500);
  const evidenceRef = requiredText(input.evidence_ref, 'evidence_ref', 3, 1000);
  const notes = optionalText(input.notes, 2000);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const marketRes = await client.query('SELECT id FROM markets WHERE id = $1 FOR SHARE', [marketId]);
    if (!marketRes.rows.length) throw new Error('market not found');

    const latestRes = await client.query(
      `SELECT id, closed_through
         FROM economic_risk_watermark_events
        WHERE market_id = $1
        ORDER BY recorded_at DESC, id DESC
        LIMIT 1
        FOR SHARE`,
      [marketId]
    );
    if (latestRes.rows.length
        && closedThrough.getTime() < new Date(latestRes.rows[0].closed_through).getTime()) {
      throw new Error('risk watermark cannot move backwards');
    }

    const insertRes = await client.query(
      `INSERT INTO economic_risk_watermark_events (
         market_id, closed_through, review_version, source,
         evidence_ref, notes, recorded_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [marketId, closedThrough.toISOString(), reviewVersion, source, evidenceRef, notes, actorId]
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

function aggregateRiskRows(rows = []) {
  let net = 0;
  const byRiskKey = {};
  const evidence = [];
  for (const row of rows) {
    const amount = Number(row.amount_kmf) || 0;
    net += amount;
    const key = row.risk_key_snapshot || 'unknown';
    byRiskKey[key] = (byRiskKey[key] || 0) + amount;
    evidence.push({
      event_id: row.id,
      order_id: row.order_id || null,
      risk_provision_id: row.risk_provision_id || null,
      risk_key: row.risk_key_snapshot || null,
      risk_label: row.risk_label_snapshot || null,
      event_kind: row.event_kind,
      adjusts_event_id: row.adjusts_event_id || null,
      economic_at: row.economic_at,
      amount_kmf: roundKmf(amount),
      source_kind: row.source_kind,
      evidence_ref: row.evidence_ref,
      recorded_at: row.recorded_at,
    });
  }
  return {
    net_risk_cost_kmf: roundKmf(net),
    by_risk_key_kmf: Object.fromEntries(
      Object.entries(byRiskKey).map(([key, value]) => [key, roundKmf(value)])
    ),
    evidence_event_count: evidence.length,
    evidence,
  };
}

async function computePeriodRiskTruth(options = {}) {
  const marketId = requiredText(options.marketId, 'marketId', 1, 200);
  const period = parsePeriod(options.from, options.to);

  const watermarkRes = await db.query(
    `SELECT id, market_id, closed_through, review_version, source,
            evidence_ref, notes, recorded_by, recorded_at
       FROM economic_risk_watermark_events
      WHERE market_id = $1
        AND closed_through >= $2
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1`,
    [marketId, period.to.toISOString()]
  );

  if (!watermarkRes.rows.length) {
    return {
      status: 'NOT_DECISIONAL_RISK_PERIOD_OPEN',
      market_id: marketId,
      period: { from: period.from.toISOString(), to: period.to.toISOString(), bounds: '[from,to)' },
      actual_risk_cost_kmf: null,
      watermark: null,
      evidence_event_count: 0,
      evidence: [],
    };
  }

  const watermark = watermarkRes.rows[0];
  const { rows } = await db.query(
    `SELECT id, market_id, order_id, risk_provision_id,
            risk_key_snapshot, risk_label_snapshot,
            event_kind, adjusts_event_id, economic_at,
            amount_kmf, source_kind, evidence_ref, recorded_at
       FROM economic_risk_cost_events
      WHERE market_id = $1
        AND economic_at >= $2
        AND economic_at < $3
      ORDER BY economic_at ASC, recorded_at ASC, id ASC`,
    [marketId, period.from.toISOString(), period.to.toISOString()]
  );

  const aggregate = aggregateRiskRows(rows);
  const lateEvents = aggregate.evidence.filter(
    (event) => new Date(event.recorded_at).getTime() > new Date(watermark.recorded_at).getTime()
  );

  const watermarkPublic = {
    event_id: watermark.id,
    closed_through: watermark.closed_through,
    review_version: watermark.review_version,
    source: watermark.source,
    evidence_ref: watermark.evidence_ref,
    recorded_by: watermark.recorded_by,
    recorded_at: watermark.recorded_at,
  };

  if (lateEvents.length > 0) {
    return {
      status: 'NOT_DECISIONAL_RISK_WATERMARK_STALE',
      market_id: marketId,
      period: { from: period.from.toISOString(), to: period.to.toISOString(), bounds: '[from,to)' },
      actual_risk_cost_kmf: null,
      observed_net_risk_cost_kmf: aggregate.net_risk_cost_kmf,
      watermark: watermarkPublic,
      late_event_count: lateEvents.length,
      late_event_ids: lateEvents.map((event) => event.event_id),
      ...aggregate,
    };
  }

  if (aggregate.net_risk_cost_kmf < 0) {
    return {
      status: 'NOT_DECISIONAL_NEGATIVE_RISK_TOTAL',
      market_id: marketId,
      period: { from: period.from.toISOString(), to: period.to.toISOString(), bounds: '[from,to)' },
      actual_risk_cost_kmf: null,
      watermark: watermarkPublic,
      ...aggregate,
    };
  }

  return {
    status: 'RISK_PERIOD_TRUTH_AVAILABLE',
    market_id: marketId,
    period: { from: period.from.toISOString(), to: period.to.toISOString(), bounds: '[from,to)' },
    actual_risk_cost_kmf: aggregate.net_risk_cost_kmf,
    watermark: watermarkPublic,
    late_event_count: 0,
    ...aggregate,
  };
}

module.exports = {
  EVENT_KINDS,
  recordRiskCostEvent,
  recordRiskWatermark,
  computePeriodRiskTruth,
  _validateMoney: validateMoney,
  _validateEventSemantics: validateEventSemantics,
  _aggregateRiskRows: aggregateRiskRows,
};
