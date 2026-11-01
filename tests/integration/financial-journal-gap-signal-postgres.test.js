/**
 * @integration financial-journal-gap-signal-postgres.test.js
 * @feature Signal financial_journal_gap — écart du journal → Action Center (signal-service)
 * @brief PostgreSQL réel : signal créé par marché sur écart, idempotent, auto-résolu quand conforme.
 */
'use strict';
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('financial_journal_gap (REAL_DB)', () => {
  const db = require('../../db');
  const signals = require('../../services/signal-service');
  const journal = require('../../services/financial-journal');
  const tag = `gap-${Date.now()}`;
  let km;
  const q = (sql, p) => db.query(sql, p);
  const active = async () => (await q("SELECT count(*)::int AS n FROM signals WHERE signal_type='financial_journal_gap' AND market_id=$1 AND status IN ('open','acknowledged','snoozed')", [km])).rows[0].n;

  beforeAll(async () => { km = (await q("SELECT id FROM markets WHERE code='KM'")).rows[0].id; });
  afterAll(async () => { await q("DELETE FROM signals WHERE signal_type='financial_journal_gap'"); await q("DELETE FROM financial_movements WHERE source_id = $1", [tag]).catch(() => {}); });

  test('mouvement sans provenance : signal créé, idempotent, puis auto-résolu quand le journal redevient conforme', async () => {
    await signals.generateSignals(['financial_journal_gap']);
    const baseline = await active();
    // Un mouvement sans EUR (taux indisponible) déclenche le signal warning.
    await db.withTransaction(client => journal.recordMovement(client, {
      sourceKind: 'order_refund', sourceId: tag, direction: 'outflow', category: 'refund', state: 'committed',
      amountNative: 150, currency: 'JPY', marketId: km, occurredAt: new Date(), provenance: { source: 'test', tag },
    }));
    const first = await signals.generateSignals(['financial_journal_gap']);
    expect(first.generators.financial_journal_gap.error).toBeUndefined();
    expect(await active()).toBe(1);
    await signals.generateSignals(['financial_journal_gap']);
    expect(await active()).toBe(1);
    const row = (await q("SELECT severity, summary FROM signals WHERE signal_type='financial_journal_gap' AND market_id=$1 AND status='open'", [km])).rows[0];
    expect(row.summary).toMatch(/sans conversion EUR/);
    // Rattrapage : le mouvement reçoit son EUR → condition disparue → auto-résolution.
    await db.withTransaction(client => journal.recordMovement(client, {
      sourceKind: 'order_refund', sourceId: tag, direction: 'outflow', category: 'refund', state: 'committed',
      amountNative: 150, currency: 'JPY', marketId: km, occurredAt: new Date(), eur: { amount: 0.9, legs: [{ id: 'manual-proof' }] }, provenance: { source: 'test', tag },
    }));
    await signals.generateSignals(['financial_journal_gap']);
    expect(await active()).toBeLessThanOrEqual(baseline);
  });
});
