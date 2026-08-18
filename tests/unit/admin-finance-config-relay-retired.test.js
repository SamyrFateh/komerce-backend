'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));
jest.mock('../../services/loyalty-service', () => ({ invalidateConfigCache: jest.fn() }));
jest.mock('../../utils/logger', () => ({ forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
jest.mock('../../utils/rates', () => ({
  resolveFxRates: () => ({ eur_kmf: 495, aed_kmf: 139, usd_kmf: 455.4, usd_eur_ratio: 0.92 }),
  resolvePricingViewCurrentCompatRates: () => ({ eur_kmf: 492, aed_kmf: 138, usd_kmf: 452.64, usd_eur_ratio: 0.92 }),
  invalidateCache: jest.fn(),
}));

const router = require('../../routes/admin-finance-config');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin/finance-config', router);
  return a;
}

beforeEach(() => jest.clearAllMocks());

describe('LOT 1A-3 — anciens champs commission relais', () => {
  test('commission_relais_pct disparaît du schéma éditable', async () => {
    const res = await request(app()).get('/api/admin/finance-config/schema');
    expect(res.status).toBe(200);
    expect(res.body.commission_relais_pct).toBeUndefined();
  });

  test.each([
    'commission_relais_pct',
    'commission_relais_standard_kmf',
    'commission_relais_showroom_kmf',
  ])('%s répond 410 et ne touche pas la DB', async (field) => {
    const res = await request(app())
      .put('/api/admin/finance-config')
      .send({ [field]: 999 });

    expect(res.status).toBe(410);
    expect(res.body).toEqual(expect.objectContaining({
      error: 'relay_commission_editor_retired',
      source_of_truth: 'cost_components.commission_relais_kmf',
      component_key: 'commission_relais_kmf',
    }));
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
