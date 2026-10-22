'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/pricing-rates.test.js
 *
 * Couvre services/pricing-rates.js (REFACTO-R1), extrait de
 * routes/pricing.js (GET/PUT /api/pricing/rates) :
 *
 *   ✅ getCurrentRates() → { current, history }
 *   ✅ getCurrentRates() AED indisponible = null (pas de repli)
 *   ✅ updateRates() → finance_config + exchange_rates + invalidateCache
 *   ✅ updateRates() → ROLLBACK si erreur DB
 */

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

const mockInvalidateCache = jest.fn();

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
const mockGetRates = jest.fn();
jest.mock('../../utils/rates', () => ({
  invalidateCache: (...args) => mockInvalidateCache(...args),
  getRates: (...args) => mockGetRates(...args),
}));

const db = require('../../db');
const { getCurrentRates, updateRates } = require('../../services/pricing-rates');

describe('pricing-rates', () => {
  describe('getCurrentRates', () => {
    it('retourne current (autorité FX) + history (exchange_rates)', async () => {
      mockGetRates.mockResolvedValueOnce({ toJSON: () => ({ eur_kmf: 491.96775, aed_kmf: 134, usd_kmf: 450 }) });
      db.query.mockResolvedValueOnce({ rows: [{ eur_kmf: 500, aed_kmf: 140, valid_from: '2026-06-01' }] });

      const result = await getCurrentRates();

      expect(result).toEqual({
        current: { eur_kmf: 491.96775, aed_kmf: 134 },
        history: [{ eur_kmf: 500, aed_kmf: 140, valid_from: '2026-06-01' }],
      });
    });

    it('AED sans observation approuvée : null, jamais 138', async () => {
      mockGetRates.mockResolvedValueOnce({ toJSON: () => ({ eur_kmf: 491.96775, aed_kmf: null, usd_kmf: null }) });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await getCurrentRates();

      expect(result.current).toEqual({ eur_kmf: 491.96775, aed_kmf: null });
    });
  });

  describe('updateRates', () => {
    it("retiré : refus 410 fx_rate_editor_retired, aucune écriture", async () => {
      await expect(updateRates({ eur_kmf: 510, aed_kmf: 142 }, 'user-admin-1')).rejects.toMatchObject({
        code: 'fx_rate_editor_retired', statusCode: 410,
      });
      expect(db.getClient).not.toHaveBeenCalled();
      expect(mockInvalidateCache).not.toHaveBeenCalled();
    });
  });
});
