'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const mockFallbackProvider = jest.fn();
const mockWarn = jest.fn();
const mockError = jest.fn();
jest.mock('../../utils/logger', () => ({
  child: () => ({
    warn: (...args) => mockWarn(...args),
    error: (...args) => mockError(...args),
  }),
}));

let rates;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  rates = require('../../utils/rates');
  rates.configureRatesFallbackProvider(mockFallbackProvider);
});

describe('Payment & FX Authority', () => {
  test('getAuthoritativeRates lit uniquement finance_config et hydrate le cache partagé', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ taux_change_eur_kmf: '501.5', taux_aed_kmf: '139.25' }],
    });

    await expect(rates.getAuthoritativeRates()).resolves.toEqual({
      eur_kmf: 501.5,
      aed_kmf: 139.25,
    });

    // Le checkout appelle ensuite getRates(): même snapshot, aucune seconde
    // lecture et aucune possibilité de basculer sur un fallback.
    await expect(rates.getRates()).resolves.toEqual({
      eur_kmf: 501.5,
      aed_kmf: 139.25,
    });
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    expect(mockFallbackProvider).not.toHaveBeenCalled();
  });

  test('le chemin autoritatif refuse une finance_config inaccessible sans fallback silencieux', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('finance db unavailable'));
    mockFallbackProvider.mockResolvedValue(492);

    await expect(rates.getAuthoritativeRates()).rejects.toMatchObject({
      code: 'fx_rate_unavailable',
      statusCode: 503,
    });
    expect(mockFallbackProvider).not.toHaveBeenCalled();
  });

  test('le chemin autoritatif refuse un taux canonique absent ou invalide', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ taux_change_eur_kmf: null, taux_aed_kmf: '138' }],
    });

    await expect(rates.getAuthoritativeRates()).rejects.toMatchObject({
      code: 'fx_rate_unavailable',
    });
  });

  test('le boundary checkout protège Stripe et PayPal mais pas le cash KMF', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../routes/orders/create.js'),
      'utf8'
    );

    expect(source).toContain("const EUR_PAYMENT_MODES = new Set(['stripe_eur', 'paypal_eur'])");
    expect(source).toContain('await getAuthoritativeRates()');
    expect(source).toContain("code: 'fx_rate_unavailable'");
    expect(source).not.toContain("EUR_PAYMENT_MODES = new Set(['stripe_eur', 'paypal_eur', 'cash_relais'])");
  });
});
