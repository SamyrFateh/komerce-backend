'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Taux « moteur » (pricing, sourcing, allocation) issus de l'autorité FX sur PostgreSQL réel.
 */
const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = /^postgres(ql)?:\/\//.test(dbUrl) && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('fx-engine-rates (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const db = require('../../db');
  const rates = require('../../utils/rates');
  const { withAuthorityRates } = require('../../services/fx-engine-rates');
  const { resolveFxRates } = rates;
  const DAY = 24 * 3600 * 1000;

  async function resetObs() {
    await db.query('ALTER TABLE fx_rate_observations DISABLE TRIGGER fx_rate_observations_append_only');
    await db.query('DELETE FROM fx_rate_observations');
    await db.query('ALTER TABLE fx_rate_observations ENABLE TRIGGER fx_rate_observations_append_only');
    rates.invalidateCache();
  }
  async function approvedObs(rate) {
    const { rows: [o] } = await db.query(
      'INSERT INTO fx_rate_observations (rate, source_label, as_of, entered_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [rate, 'BCE fixture test', new Date(Date.now() - DAY - 1000), 'alice']);
    await db.query("UPDATE fx_rate_observations SET approved_by = 'bob' WHERE id = $1", [o.id]);
  }
  beforeEach(resetObs);
  afterAll(resetObs);

  test('sans observation : EUR/KMF = parité fixe, AED/USD indisponibles (refus typé à la lecture, pas de 138 ni 0,92)', async () => {
    const fc = await withAuthorityRates({ taux_change_eur_kmf: 999, taux_aed_kmf: 999, target_marge_brute_pct: 40 });
    expect(fc.taux_change_eur_kmf).toBeCloseTo(491.96775, 5);       // jamais la colonne stockée (999)
    expect(fc.taux_aed_kmf).toBeNull();
    expect(fc.taux_usd_kmf).toBeNull();
    expect(fc.target_marge_brute_pct).toBe(40);                       // paramètres économiques conservés
    const fx = resolveFxRates(fc);
    expect(fx.eur_kmf).toBeCloseTo(491.96775, 5);
    expect(() => fx.aed_kmf).toThrow(expect.objectContaining({ code: 'fx_rate_unavailable', statusCode: 503 }));
    expect(() => fx.usd_kmf).toThrow(expect.objectContaining({ code: 'fx_rate_unavailable' }));
  });

  test('avec observation EUR/USD approuvée : USD et AED dérivés exactement via pivot EUR et peg', async () => {
    await approvedObs(1.25);
    const fc = await withAuthorityRates({});
    // 1 USD = 491.96775 / 1.25 KMF ; 1 AED = 1 USD / 3.6725
    expect(fc.taux_usd_kmf).toBeCloseTo(491.96775 / 1.25, 6);
    expect(fc.taux_aed_kmf).toBeCloseTo((491.96775 / 1.25) / 3.6725, 6);
    const fx = resolveFxRates(fc);
    expect(fx.usd_eur_ratio).toBeCloseTo(0.8, 5);
  });

  test("l'approbation est visible immédiatement (jeu incomplet non mis en cache)", async () => {
    const before = await rates.getRates();
    expect(before.toJSON().aed_kmf).toBeNull();
    await approvedObs(1.1);
    const after = await rates.getRates();
    expect(after.toJSON().aed_kmf).toBeGreaterThan(0);
  });

  test('getAuthoritativeRates : 503 sans observation, valeurs avec', async () => {
    await expect(rates.getAuthoritativeRates()).rejects.toMatchObject({ code: 'fx_rate_unavailable', statusCode: 503 });
    await approvedObs(1.1);
    const r = await rates.getAuthoritativeRates();
    expect(r.eur_kmf).toBeCloseTo(491.96775, 5);
    expect(r.aed_kmf).toBeGreaterThan(0);
  });
}
