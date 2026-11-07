'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { permitted, fourDecimals, run } = require('../../scripts/recette/staging-market-transport-sale-rates');
const fx = require('../../services/fx-authority');
const env = { KOMERCE_ENV: 'staging', NODE_ENV: 'test',
  STAGING_BASE_URL: 'https://komerce-backend-production.up.railway.app', SALE_RATE_MARKET: 'CM' };

test('refus production, autre marché et confirmation non exacte', () => {
  expect(() => permitted({ ...env, KOMERCE_ENV: 'production' })).toThrow('STAGING_ONLY');
  expect(() => permitted({ ...env, SALE_RATE_MARKET: 'KM' })).toThrow('MARKET_NOT_ALLOWED');
  expect(() => permitted({ ...env, SALE_RATE_APPLY: '1', SALE_RATE_CONFIRMATION: 'bad' })).toThrow('CONFIRMATION_REQUIRED');
  expect(permitted(env).apply).toBe(false);
  expect(permitted({ ...env, SALE_RATE_APPLY: '1', SALE_RATE_CONFIRMATION: 'APPLY-RECETTE-TRANSPORT-CM' }).apply).toBe(true);
});

test('arrondi local 4 décimales après conversion gouvernée, sans nombre JS flottant', () => {
  expect(fourDecimals('86.666666666667', fx)).toBe('86.6667');
  expect(fourDecimals('3333.333333333333', fx)).toBe('3333.3333');
  expect(fourDecimals('10.000050000000', fx)).toBe('10.0000'); // moitié paire
  expect(fourDecimals('10.000150000000', fx)).toBe('10.0002');
});

test('dry-run utilise exactement les tarifs KM lus de business_rules, sans HTTP ni écriture SQL', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [
    { key: 'SEA_KMF_PER_KG_COMMERCIAL', value: { value: 65 } },
    { key: 'AIR_KMF_PER_KG_TAXABLE', value: { value: 2500 } },
  ] }) };
  const mockFx = { parseDecimal: fx.parseDecimal, roundHalfEven: fx.roundHalfEven,
    convert: jest.fn().mockResolvedValueOnce({ amount_text: '86.666666666667', legs: [] })
      .mockResolvedValueOnce({ amount_text: '3333.333333333333', legs: [] }) };
  const fetchImpl = jest.fn();
  const report = await run({ db, fx: mockFx, env, fetchImpl });
  expect(report.verdict).toBe('DRY_RUN_READY');
  expect(report.tariff_lines.map(x => x.xaf_per_kg)).toEqual(['86.6667', '3333.3333']);
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(mockFx.convert).toHaveBeenCalledWith(expect.objectContaining({ from: 'KMF', to: 'XAF', round: false, client: db }));
  expect(fetchImpl).not.toHaveBeenCalled();
});
