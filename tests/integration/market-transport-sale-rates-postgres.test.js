'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * Tarifs de vente transport par Market : chargement, révocation, isolation inter-marchés, contraintes.
 */
const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = /^postgres(ql)?:\/\//.test(dbUrl) && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('market_transport_sale_rates (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  const db = require('../../db');
  const { loadMarketTransportSaleRates } = require('../../services/market-transport-sale-rates');
  let m1; let m2;

  beforeAll(async () => {
    const { rows } = await db.query("SELECT id FROM markets WHERE code IN ('CM','CG') ORDER BY code");
    [m1, m2] = rows.map(r => r.id);
    if (!m1 || !m2) throw new Error('markets CM/CG absents du schéma de test');
  });
  beforeEach(async () => { await db.query('DELETE FROM market_transport_sale_rates WHERE market_id = ANY($1::uuid[])', [[m1, m2]]); });
  afterAll(async () => { await db.query('DELETE FROM market_transport_sale_rates WHERE market_id = ANY($1::uuid[])', [[m1, m2]]); });

  const ins = (m, key, rate, ev = 'decision-locale-2026-10', ccy = 'XAF') => db.query(
    'INSERT INTO market_transport_sale_rates (market_id, rate_key, rate_per_kg, currency, evidence_ref) VALUES ($1,$2,$3,$4,$5)', [m, key, rate, ccy, ev]);

  test('aucun tarif : objet vide (fail-closed côté gate)', async () => {
    expect(await loadMarketTransportSaleRates(db, m1)).toEqual({});
    expect(await loadMarketTransportSaleRates(db, null)).toEqual({});
  });

  test('isolation : le tarif d’un Market n’est jamais lu par un autre', async () => {
    await ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 90);
    const got = await loadMarketTransportSaleRates(db, m1);
    expect(Object.keys(got)).toEqual(['SEA_KMF_PER_KG_COMMERCIAL']);
    expect(await loadMarketTransportSaleRates(db, m2)).toEqual({});
  });

  test('tarif révoqué ou futur ignoré', async () => {
    await ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 90);
    await db.query('UPDATE market_transport_sale_rates SET revoked_at = now() WHERE market_id = $1', [m1]);
    expect(await loadMarketTransportSaleRates(db, m1)).toEqual({});
    await db.query("INSERT INTO market_transport_sale_rates (market_id, rate_key, rate_per_kg, currency, evidence_ref, valid_from) VALUES ($1,'AIR_KMF_PER_KG_TAXABLE',3000,'XAF','x', now() + interval '1 day')", [m1]);
    expect(await loadMarketTransportSaleRates(db, m1)).toEqual({});
  });

  test('contraintes : clé inconnue, tarif ≤ 0, pièce vide, doublon actif refusés', async () => {
    await expect(ins(m1, 'FREIGHT_COST', 10)).rejects.toThrow();
    await expect(ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 0)).rejects.toThrow();
    await expect(ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 10, '  ')).rejects.toThrow();
    await ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 90);
    await expect(ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 95)).rejects.toThrow();
  });

  describe('conversion gouvernée vers la base KMF', () => {
    const { rateToKmfPerKg } = require('../../services/market-transport-sale-rates');

    test('KMF tel quel ; XAF via parités fixes (même résultat que projectAmount) ; devise inconnue refusée', async () => {
      const { projectAmount } = require('../../utils/currency');
      expect(await rateToKmfPerKg(65, 'KMF')).toBe(65);
      expect(await rateToKmfPerKg(1000, 'XAF')).toBeCloseTo(await projectAmount(1000, 'XAF', 'KMF'), 6);
      await expect(rateToKmfPerKg(10, 'ZZZ')).rejects.toMatchObject({ code: 'MARKET_TRANSPORT_TARIFF_MISSING', statusCode: 409 });
    });

    test('DJF : refusé sans taux EUR/USD approuvé et frais', async () => {
      await db.query('ALTER TABLE fx_rate_observations DISABLE TRIGGER fx_rate_observations_append_only');
      await db.query('DELETE FROM fx_rate_observations');
      await db.query('ALTER TABLE fx_rate_observations ENABLE TRIGGER fx_rate_observations_append_only');
      await expect(rateToKmfPerKg(1000, 'DJF', { client: db })).rejects.toMatchObject({ code: 'fx_rate_unavailable', statusCode: 503 });
    });

    test('DJF : avec observation approuvée, converti via DJF→EUR→KMF', async () => {
      const { projectAmount } = require('../../utils/currency');
      await db.query('ALTER TABLE fx_rate_observations DISABLE TRIGGER fx_rate_observations_append_only');
      await db.query('DELETE FROM fx_rate_observations');
      await db.query('ALTER TABLE fx_rate_observations ENABLE TRIGGER fx_rate_observations_append_only');
      const { rows: [o] } = await db.query(
        "INSERT INTO fx_rate_observations (rate, source_label, as_of, entered_by) VALUES (1.2, 't', now() - interval '1 day', 'alice') RETURNING id");
      await db.query("UPDATE fx_rate_observations SET approved_by = 'bob' WHERE id = $1", [o.id]);
      const eur = 1000 / (1.2 * 177.721);
      expect(await rateToKmfPerKg(1000, 'DJF', { client: db })).toBeCloseTo(await projectAmount(eur, 'EUR', 'KMF'), 6);
    });

    test('ligne dont la devise ≠ devise du marché : ignorée (fail-closed)', async () => {
      await ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 90, 'x', 'DJF');
      expect(await loadMarketTransportSaleRates(db, m1)).toEqual({});
    });

    test('preuve de conversion : pivot EUR et jambes de parité figeables, pleine précision', async () => {
      const { convertRateToKmfPerKg } = require('../../services/market-transport-sale-rates');
      const r = await convertRateToKmfPerKg(1000, 'XAF');
      expect(r.conversion.pivot).toBe('EUR');
      expect(r.conversion.legs.map(l => l.pair)).toEqual(['EUR/XAF', 'EUR/KMF']);
      expect(r.kmf).toBeCloseTo(1000 / Number(r.conversion.legs[0].rate) * Number(r.conversion.legs[1].rate), 6);
      expect((await convertRateToKmfPerKg(65, 'KMF')).conversion).toEqual({ pivot: null, legs: [] });
    });

    test('tarifs chargés avec lignes de preuve (rate_id, devise, pièce)', async () => {
      const { loadMarketTransportSaleTariffs } = require('../../services/market-transport-sale-rates');
      await ins(m1, 'SEA_KMF_PER_KG_COMMERCIAL', 90, 'piece-1');
      const t = await loadMarketTransportSaleTariffs(db, m1);
      expect(t.lines).toHaveLength(1);
      expect(t.lines[0]).toMatchObject({ rate_key: 'SEA_KMF_PER_KG_COMMERCIAL', rate_per_kg_local: 90, currency: 'XAF', evidence_ref: 'piece-1' });
      expect(t.lines[0].rate_id).toBeTruthy();
      expect(t.rates.SEA_KMF_PER_KG_COMMERCIAL).toBeCloseTo(t.lines[0].kmf_per_kg, 8);
    });

    test('pivot EUR/KMF : finance_config divergent de la parité → refus ; cohérent → accepté', async () => {
      const { assertEurKmfPivotConsistent } = require('../../services/market-transport-sale-rates');
      const { getCurrencyParity } = require('../../utils/currency');
      const p = await getCurrencyParity('KMF');
      await expect(assertEurKmfPivotConsistent(p)).resolves.toBeUndefined();
      await expect(assertEurKmfPivotConsistent(492)).resolves.toBeUndefined(); // 0,0066 % d'écart : toléré
      await expect(assertEurKmfPivotConsistent(p * 1.05)).rejects.toMatchObject({ code: 'EUR_KMF_PIVOT_DIVERGENCE', statusCode: 409 });
      await expect(assertEurKmfPivotConsistent(0)).rejects.toMatchObject({ code: 'EUR_KMF_PIVOT_DIVERGENCE' });
    });

    test('DJ : le prix DJF passe par la chaîne gouvernée — refusé sans observation approuvée, aucune parité fixe inventée', async () => {
      const { projectAmount } = require('../../utils/currency');
      await db.query('ALTER TABLE fx_rate_observations DISABLE TRIGGER fx_rate_observations_append_only');
      await db.query('DELETE FROM fx_rate_observations');
      await db.query('ALTER TABLE fx_rate_observations ENABLE TRIGGER fx_rate_observations_append_only');
      await expect(projectAmount(1000, 'DJF', 'KMF')).rejects.toMatchObject({ code: 'fx_rate_unavailable' });
      await expect(db.query("SELECT 1 FROM currency_parities WHERE currency = 'DJF'")).resolves.toMatchObject({ rowCount: 0 });
    });
  });
}
