'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * utils/rates.js = facade de lecture de l'autorité FX (pivot EUR) : plus de repli 492/138, plus de 0,92.
 */
class MockFxError extends Error {
  constructor(message, code, statusCode) { super(message); this.code = code; this.statusCode = statusCode; }
}
const mockConvert = jest.fn();
const mockFixed = jest.fn();
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/fx-authority', () => ({
  convert: (...a) => mockConvert(...a),
  fixedUnitsPerEur: (...a) => mockFixed(...a),
  FxError: MockFxError,
}));

let rates;
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  rates = require('../../utils/rates');
  mockFixed.mockResolvedValue(491.96775);
  mockConvert.mockImplementation(async ({ from }) => ({ amount: from === 'AED' ? 134.5 : 450.25 }));
});

describe('buildFxRates / resolveFxRates — jamais de repli', () => {
  it('taux disponible = valeur ; indisponible = lecture qui lève fx_rate_unavailable, absent du JSON', () => {
    const r = rates.buildFxRates({ eur_kmf: 491.96775, aed_kmf: null, usd_kmf: null });
    expect(r.eur_kmf).toBe(491.96775);
    expect(() => r.aed_kmf).toThrow(expect.objectContaining({ code: 'fx_rate_unavailable', statusCode: 503 }));
    expect(() => r.usd_kmf).toThrow(expect.objectContaining({ code: 'fx_rate_unavailable' }));
    expect(JSON.parse(JSON.stringify(r))).toEqual({ eur_kmf: 491.96775, aed_kmf: null, usd_kmf: null, usd_eur_ratio: null });
    expect({ ...r }).toEqual({ eur_kmf: 491.96775 });
  });

  it('le ratio USD/EUR est calculé depuis les deux taux autorité, pas une constante 0,92', () => {
    const r = rates.buildFxRates({ eur_kmf: 500, aed_kmf: 140, usd_kmf: 450 });
    expect(r.usd_eur_ratio).toBe(0.9);
  });

  it('resolveFxRates lit la ligne superposée ; une ligne vide ne fabrique ni 492, ni 138, ni USD', () => {
    const r = rates.resolveFxRates({ taux_change_eur_kmf: 495, taux_aed_kmf: 139, taux_usd_kmf: 455.4 });
    expect(r).toMatchObject({ eur_kmf: 495, aed_kmf: 139, usd_kmf: 455.4 });
    const empty = rates.resolveFxRates({});
    expect(() => empty.eur_kmf).toThrow(expect.objectContaining({ code: 'fx_rate_unavailable' }));
    expect(() => empty.aed_kmf).toThrow();
  });
});

describe('getRates — autorité FX', () => {
  it('EUR par parité fixe, AED/USD par convert() non arrondi', async () => {
    const r = await rates.getRates();
    expect(r.toJSON()).toMatchObject({ eur_kmf: 491.96775, aed_kmf: 134.5, usd_kmf: 450.25 });
    expect(mockConvert).toHaveBeenCalledWith(expect.objectContaining({ amount: '1', from: 'AED', to: 'KMF', round: false }));
  });

  it("jeu complet mis en cache : un seul chargement pour deux appels rapprochés", async () => {
    await rates.getRates(); await rates.getRates();
    expect(mockFixed).toHaveBeenCalledTimes(1);
  });

  it('re-charge après expiration du cache (TTL 60 s)', async () => {
    const spy = jest.spyOn(Date, 'now');
    spy.mockReturnValue(1_000_000);
    await rates.getRates();
    spy.mockReturnValue(1_000_000 + 61_000);
    await rates.getRates();
    expect(mockFixed).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("sans observation approuvée : AED/USD indisponibles, EUR disponible, et pas de cache (l'approbation est vue tout de suite)", async () => {
    mockConvert.mockRejectedValue(new MockFxError('pas d\'observation', 'fx_rate_unavailable', 503));
    const r = await rates.getRates();
    expect(r.eur_kmf).toBe(491.96775);
    expect(() => r.aed_kmf).toThrow(expect.objectContaining({ code: 'fx_rate_unavailable' }));
    await rates.getRates();
    expect(mockFixed).toHaveBeenCalledTimes(2);
  });

  it('parité EUR/KMF absente : refus propagé (503), aucun repli', async () => {
    mockFixed.mockRejectedValue(new MockFxError('Aucune parité', 'fx_rate_unavailable', 503));
    await expect(rates.getRates()).rejects.toMatchObject({ code: 'fx_rate_unavailable', statusCode: 503 });
  });

  it('erreur technique inattendue : 503 typé', async () => {
    mockFixed.mockRejectedValue(new Error('db down'));
    await expect(rates.getRates()).rejects.toMatchObject({ code: 'fx_rate_unavailable', statusCode: 503 });
  });
});

describe('getAuthoritativeRates — EUR et AED requis', () => {
  it('renvoie eur_kmf et aed_kmf', async () => {
    await expect(rates.getAuthoritativeRates()).resolves.toEqual({ eur_kmf: 491.96775, aed_kmf: 134.5 });
  });
  it('AED indisponible : 503', async () => {
    mockConvert.mockRejectedValue(new MockFxError('x', 'fx_rate_unavailable', 503));
    await expect(rates.getAuthoritativeRates()).rejects.toMatchObject({ code: 'fx_rate_unavailable', statusCode: 503 });
  });
});

describe('invalidateCache', () => {
  it('force un rechargement', async () => {
    await rates.getRates();
    rates.invalidateCache();
    await rates.getRates();
    expect(mockFixed).toHaveBeenCalledTimes(2);
  });
});

describe('sources interdites', () => {
  it('le module ne contient plus de constantes de repli', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../utils/rates.js'), 'utf8');
    expect(src).not.toMatch(/RATES_FALLBACK|USD_EUR_CURRENT_RATIO|\b0\.92\b|\|\|\s*(492|138)\b|finance_config WHERE/);
  });
});
