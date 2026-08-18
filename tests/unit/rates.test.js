'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/rates.test.js
 *
 * Tests du module utils/rates.js — getRates() / invalidateCache()
 *
 * Cascade de repli testée intégralement :
 *   1. Cache mémoire (TTL 60s)
 *   2. finance_config (source de vérité, via db.query)
 *   3. business_rules (legacy, via getRuleNumber)
 *   4. Fallback hardcodé ultime (RATES_FALLBACK)
 *
 * LOT 1A-2 : la dérivation USD CURRENT est aussi verrouillée ici :
 * USD_KMF = 0.92 × EUR_KMF, sans élargir le contrat historique getRates().
 */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));

const mockGetRuleNumber = jest.fn();

const mockLogWarn = jest.fn();
jest.mock('../../utils/logger', () => ({
  child: () => ({ warn: (...a) => mockLogWarn(...a) }),
}));

let rates;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  rates = require('../../utils/rates');
  rates.configureRatesFallbackProvider(mockGetRuleNumber);
});

describe('LOT 1A-2 — projection FX canonique', () => {
  it('dérive USD depuis EUR avec la règle CURRENT 0.92', () => {
    expect(rates.USD_EUR_CURRENT_RATIO).toBe(0.92);
    expect(rates.resolveFxRates({
      taux_change_eur_kmf: 495,
      taux_aed_kmf: 139,
    })).toEqual({
      eur_kmf: 495,
      aed_kmf: 139,
      usd_kmf: 455.4,
      usd_eur_ratio: 0.92,
    });
  });

  it('reproduit exactement les fallbacks CURRENT historiques du PricingView', () => {
    expect(rates.resolvePricingViewCurrentCompatRates()).toEqual({
      eur_kmf: 492,
      aed_kmf: 138,
      usd_kmf: 452.64,
      usd_eur_ratio: 0.92,
    });
  });

  it('resolveFxRates retombe sur les fallbacks historiques sans fabriquer une autre valeur USD', () => {
    expect(rates.resolveFxRates({})).toEqual({
      eur_kmf: 492,
      aed_kmf: 138,
      usd_kmf: 452.64,
      usd_eur_ratio: 0.92,
    });
  });
});

describe('getRates — cache mémoire', () => {
  it("n'interroge la DB qu'une seule fois pour deux appels rapprochés", async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ taux_change_eur_kmf: '500', taux_aed_kmf: '140' }] });

    const r1 = await rates.getRates();
    const r2 = await rates.getRates();

    expect(r1).toEqual({ eur_kmf: 500, aed_kmf: 140 });
    expect(r2).toEqual({ eur_kmf: 500, aed_kmf: 140 });
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it('re-requête la DB après expiration du cache (TTL 60s)', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockDbQuery.mockResolvedValue({ rows: [{ taux_change_eur_kmf: '500', taux_aed_kmf: '140' }] });

    await rates.getRates();
    nowSpy.mockReturnValue(1_000_000 + 60_001);
    await rates.getRates();

    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });
});

describe('getRates — source primaire (finance_config)', () => {
  it('utilise taux_change_eur_kmf et taux_aed_kmf convertis en Number', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ taux_change_eur_kmf: '512.5', taux_aed_kmf: '141' }] });

    const result = await rates.getRates();

    expect(result).toEqual({ eur_kmf: 512.5, aed_kmf: 141 });
  });

  it('replie aed_kmf sur RATES_FALLBACK.aed_kmf si absent/NaN', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ taux_change_eur_kmf: '500', taux_aed_kmf: null }] });

    const result = await rates.getRates();

    expect(result).toEqual({ eur_kmf: 500, aed_kmf: rates.RATES_FALLBACK.aed_kmf });
  });

  it('passe au fallback secondaire si la ligne existe mais taux_change_eur_kmf est falsy', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ taux_change_eur_kmf: 0, taux_aed_kmf: '140' }] });
    mockGetRuleNumber
      .mockResolvedValueOnce(490)
      .mockResolvedValueOnce(139);

    const result = await rates.getRates();

    expect(result).toEqual({ eur_kmf: 490, aed_kmf: 139 });
    expect(mockGetRuleNumber).toHaveBeenCalledTimes(2);
  });

  it('passe au fallback secondaire si db.query rejette (finance_config inaccessible)', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('connexion refusée'));
    mockGetRuleNumber
      .mockResolvedValueOnce(495)
      .mockResolvedValueOnce(137);

    const result = await rates.getRates();

    expect(result).toEqual({ eur_kmf: 495, aed_kmf: 137 });
  });

  it('passe au fallback secondaire si rows est vide', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockGetRuleNumber
      .mockResolvedValueOnce(495)
      .mockResolvedValueOnce(137);

    const result = await rates.getRates();

    expect(result).toEqual({ eur_kmf: 495, aed_kmf: 137 });
  });
});

describe('getRates — fallback secondaire (business_rules)', () => {
  it("appelle getRuleNumber avec les bonnes clés et valeurs par défaut", async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    mockGetRuleNumber
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(140);

    await rates.getRates();

    expect(mockGetRuleNumber).toHaveBeenCalledWith('EUR_KMF_FALLBACK', rates.RATES_FALLBACK.eur_kmf);
    expect(mockGetRuleNumber).toHaveBeenCalledWith('AED_KMF_FALLBACK', rates.RATES_FALLBACK.aed_kmf);
  });

  it('passe au fallback ultime si getRuleNumber rejette', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    mockGetRuleNumber.mockRejectedValueOnce(new Error('business_rules aussi down'));

    const result = await rates.getRates();

    expect(result).toEqual(rates.RATES_FALLBACK);
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('Fallback ultime'));
  });
});

describe('getRates — fallback ultime', () => {
  it('renvoie RATES_FALLBACK et journalise un warning si toutes les sources échouent', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    mockGetRuleNumber.mockRejectedValueOnce(new Error('rules down'));

    const result = await rates.getRates();

    expect(result).toEqual({ eur_kmf: 492, aed_kmf: 138 });
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('fallback métier injecté indisponible')
    );
    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('Fallback ultime'));
  });
});

describe('invalidateCache', () => {
  it('force un refetch DB même si le TTL de 60s ne serait pas expiré', async () => {
    mockDbQuery.mockResolvedValue({ rows: [{ taux_change_eur_kmf: '500', taux_aed_kmf: '140' }] });

    await rates.getRates();
    rates.invalidateCache();
    await rates.getRates();

    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });
});
