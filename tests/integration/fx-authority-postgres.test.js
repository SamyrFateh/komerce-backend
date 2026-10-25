'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Autorité FX unique : pivot EUR, parités fixes, USD/DJF/AED via observation approuvée + pegs, refus, jambes figeables.
 */
const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = /^postgres(ql)?:\/\//.test(dbUrl) && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('fx-authority (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const db = require('../../db');
  const { convert } = require('../../services/fx-authority');
  const { projectAmount, getCurrencyParity } = require('../../utils/currency');
  const DAY = 24 * 3600 * 1000;

  async function resetObs() {
    await db.query('ALTER TABLE fx_rate_observations DISABLE TRIGGER fx_rate_observations_append_only');
    await db.query('DELETE FROM fx_rate_observations');
    await db.query('ALTER TABLE fx_rate_observations ENABLE TRIGGER fx_rate_observations_append_only');
  }
  async function approvedObs(rate, ageDays = 1) {
    const { rows: [o] } = await db.query(
      'INSERT INTO fx_rate_observations (rate, source_label, as_of, entered_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [rate, 'BCE test', new Date(Date.now() - ageDays * DAY - 1000), 'alice']);
    await db.query("UPDATE fx_rate_observations SET approved_by = 'bob' WHERE id = $1", [o.id]);
    return o.id;
  }

  beforeEach(resetObs);
  afterAll(resetObs);

  test('parités fixes : KMF↔XAF via EUR, sans observation, jambes sourcées', async () => {
    const r = await convert({ amount: '655957', from: 'XAF', to: 'KMF' });
    // 655957 XAF = 1000 EUR = 491967,75 KMF → 491968 (half-even, 0 décimale)
    expect(r.amount).toBe(491968);
    expect(r.pivot).toBe('EUR');
    expect(r.legs.map(l => `${l.side}:${l.pair}:${l.rate}`)).toEqual(['from:EUR/XAF:655.95700', 'to:EUR/KMF:491.96775']);
    expect(r.legs.every(l => l.source === 'currency_parities' && l.id.includes('@'))).toBe(true);
    expect(r.rounding).toEqual({ mode: 'half_even', minor_unit: 0, currency: 'KMF' });
  });

  test('KMF→EUR arrondi au centime, un seul arrondi', async () => {
    const r = await convert({ amount: '491.96775', from: 'KMF', to: 'EUR' });
    expect(r.amount_text).toBe('1.00');
    const r2 = await convert({ amount: 1000, from: 'KMF', to: 'EUR' });
    expect(r2.amount_text).toBe('2.03'); // 2,03264…
  });

  test('USD / DJF / AED : refusés sans observation EUR/USD approuvée et fraîche', async () => {
    for (const [from, to] of [['EUR', 'USD'], ['EUR', 'DJF'], ['AED', 'KMF'], ['USD', 'XAF']]) {
      await expect(convert({ amount: 10, from, to })).rejects.toMatchObject({ code: 'fx_rate_unavailable', statusCode: 503 });
    }
    // non approuvée : ignorée
    await db.query("INSERT INTO fx_rate_observations (rate, source_label, as_of, entered_by) VALUES (1.1, 'x', now() - interval '1 day', 'alice')");
    await expect(convert({ amount: 10, from: 'EUR', to: 'USD' })).rejects.toMatchObject({ code: 'fx_rate_unavailable' });
    await resetObs();
    await approvedObs(1.1, 9); // périmée (> 7 j)
    await expect(convert({ amount: 10, from: 'EUR', to: 'USD' })).rejects.toMatchObject({ code: 'fx_rate_unavailable' });
  });

  test('avec observation approuvée : EUR→USD, EUR→DJF, AED→KMF exacts via pivot EUR, jambes figeables', async () => {
    const id = await approvedObs(1.25);
    const usd = await convert({ amount: '100', from: 'EUR', to: 'USD' });
    expect(usd.amount_text).toBe('125.00');
    expect(usd.legs).toHaveLength(1);
    expect(usd.legs[0]).toMatchObject({ kind: 'observation', id, pair: 'EUR/USD', side: 'to' });

    const djf = await convert({ amount: '100', from: 'EUR', to: 'DJF' });
    expect(djf.amount_text).toBe('22215'); // 100 × 1,25 × 177,721 = 22215,125 → 22215
    expect(djf.legs.map(l => l.kind)).toEqual(['observation', 'peg']);

    // AED 367,25 = 100 USD = 80 EUR = 39357,42 KMF → 39357
    const kmf = await convert({ amount: '367.25', from: 'AED', to: 'KMF' });
    expect(kmf.amount_text).toBe('39357');
    expect(kmf.legs.map(l => `${l.side}:${l.pair}`)).toEqual(['from:EUR/USD', 'from:USD/AED', 'to:EUR/KMF']);
    // une seule lecture d'observation par conversion
    expect(new Set(kmf.legs.filter(l => l.kind === 'observation').map(l => l.id)).size).toBe(1);
  });

  test('CNY exige une cotation BCE officielle ; les devises non autorisées restent refusées', async () => {
    await approvedObs(1.1);
    await expect(convert({ amount: 10, from: 'CNY', to: 'EUR' })).rejects.toMatchObject({ code: 'fx_rate_unavailable', statusCode: 503 });
    await expect(convert({ amount: 10, from: 'EUR', to: 'GBP' })).rejects.toMatchObject({ code: 'fx_currency_unsupported' });
  });

  test('transaction passée : une observation approuvée après la transaction n’est pas utilisable (at)', async () => {
    await approvedObs(1.2, 3);
    const { rows: [{ t }] } = await db.query("SELECT now() - interval '2 days' AS t");
    await expect(convert({ amount: '100', from: 'EUR', to: 'USD', at: t })).rejects.toMatchObject({ code: 'fx_rate_unavailable' });
    const now = await convert({ amount: '100', from: 'EUR', to: 'USD' });
    expect(now.amount_text).toBe('120.00');
  });

  test('relais de compatibilité : projectAmount et getCurrencyParity passent par l’autorité', async () => {
    expect(await getCurrencyParity('KMF')).toBe(491.96775);
    expect(await getCurrencyParity('EUR')).toBe(1);
    await expect(getCurrencyParity('USD')).rejects.toMatchObject({ code: 'fx_currency_unsupported' });
    expect(await projectAmount(655.957, 'XAF', 'EUR')).toBeCloseTo(1, 9);
    expect(await projectAmount(5, 'KMF', 'KMF')).toBe(5);
    await expect(projectAmount(undefined, 'KMF', 'EUR')).rejects.toMatchObject({ code: 'fx_amount_invalid' });
  });

  test('currency_parities : parité immuable, TRUNCATE interdit ; peg AED seedé et borné', async () => {
    await expect(db.query("UPDATE currency_parities SET eur_rate = 492 WHERE currency = 'KMF'")).rejects.toThrow(/immuable/);
    await expect(db.query('TRUNCATE currency_parities')).rejects.toThrow(/TRUNCATE interdit/);
    const { rows: [aed] } = await db.query("SELECT rate::text AS r FROM fx_pegs WHERE quote_ccy = 'AED'");
    expect(Number(aed.r)).toBeCloseTo(3.6725, 4);
    await expect(db.query("INSERT INTO fx_pegs (quote_ccy, rate, source_label, valid_from) VALUES ('AED', 36.725, 'x', '2001-01-01')"))
      .rejects.toThrow(/fx_peg_rate_band/);
    await expect(db.query("INSERT INTO fx_pegs (quote_ccy, rate, source_label, valid_from) VALUES ('CNY', 7, 'x', '2001-01-01')"))
      .rejects.toThrow();
  });
}
