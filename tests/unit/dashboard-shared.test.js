'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/dashboard-shared.test.js
 * Couvre routes/dashboard-shared.js
 *
 * Malgré son emplacement dans routes/, ce module n'expose pas de router :
 * ce sont des helpers partagés (cache mémoire + config dynamique) importés
 * par dashboard-ops/finance/clients/hub. Pas d'auth/HTTP à tester ici.
 */

const mockGetRates = jest.fn();
jest.mock('../../utils/rates', () => ({ getRates: (...args) => mockGetRates(...args) }));

const mockGetRule = jest.fn();
jest.mock('../../utils/rules', () => ({ getRule: (...args) => mockGetRule(...args) }));

let dashboardShared;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  dashboardShared = require('../../routes/dashboard-shared');
});

describe('cached / setCache', () => {
  it('cle absente → retourne null', () => {
    expect(dashboardShared.cached('inexistant')).toBeNull();
  });

  it('setCache puis cached → retourne la donnee stockee', () => {
    dashboardShared.setCache('k1', { foo: 'bar' });
    expect(dashboardShared.cached('k1')).toEqual({ foo: 'bar' });
  });

  it('entree expiree (TTL depasse) → retourne null', () => {
    jest.useFakeTimers();
    dashboardShared.setCache('k1', { foo: 'bar' });
    jest.advanceTimersByTime(31_000); // TTL par defaut = 30_000ms
    expect(dashboardShared.cached('k1')).toBeNull();
    jest.useRealTimers();
  });

  it('entree encore fraiche (avant expiration) → retourne la donnee', () => {
    jest.useFakeTimers();
    dashboardShared.setCache('k1', { foo: 'bar' });
    jest.advanceTimersByTime(10_000);
    expect(dashboardShared.cached('k1')).toEqual({ foo: 'bar' });
    jest.useRealTimers();
  });

  it('plus de 100 entrees → la plus ancienne est evincee', () => {
    for (let i = 0; i < 101; i++) dashboardShared.setCache(`k${i}`, i);
    expect(dashboardShared.cached('k0')).toBeNull();
    expect(dashboardShared.cached('k100')).toBe(100);
  });

  it('setCache peut ecraser une cle existante', () => {
    dashboardShared.setCache('k1', 'v1');
    dashboardShared.setCache('k1', 'v2');
    expect(dashboardShared.cached('k1')).toBe('v2');
  });
});

describe('getEurKmf', () => {
  it('nominal → ne renvoie que eur_kmf et aed_kmf depuis getRates()', async () => {
    mockGetRates.mockResolvedValue({ eur_kmf: 500, aed_kmf: 130, extra_field: 'ignore' });
    const result = await dashboardShared.getEurKmf();
    expect(result).toEqual({ eur_kmf: 500, aed_kmf: 130 });
  });

  it('getRates() rejette → propage l\'erreur', async () => {
    mockGetRates.mockRejectedValue(new Error('rates service down'));
    await expect(dashboardShared.getEurKmf()).rejects.toThrow('rates service down');
  });
});

describe('loadDashConfig', () => {
  it('nominal → mappe chaque regle business vers sa cle de config', async () => {
    mockGetRule.mockImplementation((key, def) => Promise.resolve(def + 1));
    const config = await dashboardShared.loadDashConfig();

    expect(config).toEqual({
      SLA_WARNING_DAYS: 36,
      SLA_LATE_DAYS: 43,
      SLA_BLOCKED_DAYS: 57,
      INACTIVE_DAYS: 8,
      DELAY_PREVENTIF: 29,
      DELAY_AVOIR: 36,
      DELAY_REMISE: 43,
      DELAY_REMBOURSEMENT: 57,
      FRAUD_REVERSE_CRIT_DAYS: 8,
      FRAUD_PENDING_CRIT_H: 37,
      FRAUD_PENDING_WARN_H: 13,
      FRAUD_STALE_DAYS: 15,
      FRAUD_REVERSE_SQL_DAYS: 4,
    });
  });

  it('appelle getRule avec les bonnes cles et valeurs par defaut documentees', async () => {
    mockGetRule.mockResolvedValue(0);
    await dashboardShared.loadDashConfig();
    expect(mockGetRule).toHaveBeenCalledWith('SLA_WARNING_DAYS', 35);
    expect(mockGetRule).toHaveBeenCalledWith('SLA_LATE_DAYS', 42);
    expect(mockGetRule).toHaveBeenCalledWith('SLA_BLOCKED_DAYS', 56);
    expect(mockGetRule).toHaveBeenCalledWith('SLA_INACTIVE_DAYS', 7);
    expect(mockGetRule).toHaveBeenCalledWith('COMP_PREVENTIVE_DAYS', 28);
    expect(mockGetRule).toHaveBeenCalledWith('COMP_CREDIT_DAYS', 35);
    expect(mockGetRule).toHaveBeenCalledWith('COMP_DISCOUNT_DAYS', 42);
    expect(mockGetRule).toHaveBeenCalledWith('COMP_REFUND_DAYS', 56);
    expect(mockGetRule).toHaveBeenCalledWith('DASHBOARD_CACHE_TTL_SEC', 30);
    expect(mockGetRule).toHaveBeenCalledWith('FRAUD_REVERSE_CRITICAL_DAYS', 7);
    expect(mockGetRule).toHaveBeenCalledWith('FRAUD_PENDING_CRITICAL_HOURS', 36);
    expect(mockGetRule).toHaveBeenCalledWith('FRAUD_PENDING_WARNING_HOURS', 12);
    expect(mockGetRule).toHaveBeenCalledWith('FRAUD_STALE_PARCEL_DAYS', 14);
    expect(mockGetRule).toHaveBeenCalledWith('FRAUD_REVERSE_SQL_DAYS', 3);
  });

  it('met a jour le TTL du cache memoire a partir de DASHBOARD_CACHE_TTL_SEC', async () => {
    mockGetRule.mockImplementation((key) => {
      if (key === 'DASHBOARD_CACHE_TTL_SEC') return Promise.resolve(1); // 1s
      return Promise.resolve(0);
    });
    await dashboardShared.loadDashConfig();

    jest.useFakeTimers();
    dashboardShared.setCache('k1', 'v1');
    jest.advanceTimersByTime(1_500); // > 1s TTL
    expect(dashboardShared.cached('k1')).toBeNull();
    jest.useRealTimers();
  });

  it('une regle qui rejette → propage l\'erreur (Promise.all fail-fast)', async () => {
    mockGetRule.mockImplementation((key) => {
      if (key === 'SLA_LATE_DAYS') return Promise.reject(new Error('regle corrompue'));
      return Promise.resolve(0);
    });
    await expect(dashboardShared.loadDashConfig()).rejects.toThrow('regle corrompue');
  });
});
