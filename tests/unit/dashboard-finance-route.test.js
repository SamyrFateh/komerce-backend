/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/dashboard-finance (Lot B4)
 *
 * Façade R9 pure : zéro logique, délègue directement à
 * services/dashboard-finance-metrics.js (mocké — non retesté ici).
 *
 * Run : npx jest tests/unit/dashboard-finance-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/dashboard-finance-metrics', () => ({
  getFinanceSummary: jest.fn(),
  getAnnulationsParcels: jest.fn(),
  getPaymentsDetail: jest.fn(),
  getSalesAnalysis: jest.fn(),
}));

const metrics = require('../../services/dashboard-finance-metrics');
const router = require('../../routes/dashboard-finance');

function buildApp() {
  const app = express();
  app.use('/api/dashboard', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/dashboard-finance', () => {
  beforeEach(() => jest.clearAllMocks());

  test('GET /finance délègue à getFinanceSummary avec les query params', async () => {
    metrics.getFinanceSummary.mockResolvedValueOnce({ revenue: 1000 });
    const res = await request(buildApp()).get('/api/dashboard/finance').query({ month: '2026-03' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revenue: 1000 });
    expect(metrics.getFinanceSummary).toHaveBeenCalledWith(expect.objectContaining({ month: '2026-03' }));
  });

  test('GET /annulations-parcels délègue à getAnnulationsParcels', async () => {
    metrics.getAnnulationsParcels.mockResolvedValueOnce({ count: 2 });
    const res = await request(buildApp()).get('/api/dashboard/annulations-parcels');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 2 });
  });

  test('GET /payments délègue à getPaymentsDetail', async () => {
    metrics.getPaymentsDetail.mockResolvedValueOnce({ payments: [] });
    const res = await request(buildApp()).get('/api/dashboard/payments');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ payments: [] });
  });

  test('GET /sales délègue à getSalesAnalysis', async () => {
    metrics.getSalesAnalysis.mockResolvedValueOnce({ total: 5000 });
    const res = await request(buildApp()).get('/api/dashboard/sales');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 5000 });
  });

  test('propage une erreur du service au middleware next(err)', async () => {
    metrics.getFinanceSummary.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(buildApp()).get('/api/dashboard/finance');
    expect(res.status).toBe(500);
  });
});
