/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/dashboard-ops (Lot B4)
 *
 * Façade R9 : lectures déléguées à services/dashboard-ops-queries.js
 * (mocké — non retesté ici). Couvre le cache mémoire (dashboard-shared,
 * mocké), la validation format `mois` (YYYY-MM) et `target_date` (futur).
 *
 * Run : npx jest tests/unit/dashboard-ops-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../routes/dashboard-shared', () => ({
  cached: jest.fn(() => null),
  setCache: jest.fn(),
}));

jest.mock('../../services/dashboard-ops-queries', () => ({
  getOps: jest.fn(),
  getPilotage: jest.fn(),
  getPipeline: jest.fn(),
  getRetards: jest.fn(),
  getForecast: jest.fn(),
  getGlobal: jest.fn(),
  getStats: jest.fn(),
}));

const { cached, setCache } = require('../../routes/dashboard-shared');
const queries = require('../../services/dashboard-ops-queries');
const router = require('../../routes/dashboard-ops');

function buildApp() {
  const app = express();
  app.use('/api/dashboard', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/dashboard-ops', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /ops', () => {
    test('renvoie le cache si présent (pas d\'appel au service)', async () => {
      cached.mockReturnValueOnce({ hit: true });
      const res = await request(buildApp()).get('/api/dashboard/ops');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hit: true });
      expect(queries.getOps).not.toHaveBeenCalled();
    });

    test('appelle le service et met en cache si pas de hit', async () => {
      queries.getOps.mockResolvedValueOnce({ a_optimiser: 3 });
      const res = await request(buildApp()).get('/api/dashboard/ops');
      expect(res.status).toBe(200);
      expect(setCache).toHaveBeenCalledWith('ops', { a_optimiser: 3 });
    });
  });

  describe('GET /pilotage', () => {
    test('400 si format mois invalide', async () => {
      const res = await request(buildApp()).get('/api/dashboard/pilotage').query({ mois: '2026' });
      expect(res.status).toBe(400);
      expect(queries.getPilotage).not.toHaveBeenCalled();
    });

    test('utilise le mois courant par défaut', async () => {
      queries.getPilotage.mockResolvedValueOnce({ ok: true });
      const res = await request(buildApp()).get('/api/dashboard/pilotage');
      expect(res.status).toBe(200);
      expect(queries.getPilotage).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/));
    });

    test('accepte un mois explicite valide', async () => {
      queries.getPilotage.mockResolvedValueOnce({ ok: true });
      const res = await request(buildApp()).get('/api/dashboard/pilotage').query({ mois: '2026-03' });
      expect(res.status).toBe(200);
      expect(queries.getPilotage).toHaveBeenCalledWith('2026-03');
    });
  });

  describe('GET /pipeline', () => {
    test('délègue au service', async () => {
      queries.getPipeline.mockResolvedValueOnce({ steps: [] });
      const res = await request(buildApp()).get('/api/dashboard/pipeline');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ steps: [] });
    });
  });

  describe('GET /retards', () => {
    test('transmet le paramètre niveau', async () => {
      queries.getRetards.mockResolvedValueOnce([]);
      await request(buildApp()).get('/api/dashboard/retards').query({ niveau: 'critique' });
      expect(queries.getRetards).toHaveBeenCalledWith('critique');
    });
  });

  describe('GET /forecast', () => {
    test('400 si target_date manquant', async () => {
      const res = await request(buildApp()).get('/api/dashboard/forecast');
      expect(res.status).toBe(400);
    });

    test('400 si target_date invalide', async () => {
      const res = await request(buildApp()).get('/api/dashboard/forecast').query({ target_date: 'pas-une-date' });
      expect(res.status).toBe(400);
    });

    test('400 si target_date dans le passé', async () => {
      const res = await request(buildApp()).get('/api/dashboard/forecast').query({ target_date: '2020-01-01' });
      expect(res.status).toBe(400);
      expect(queries.getForecast).not.toHaveBeenCalled();
    });

    test('accepte une target_date future', async () => {
      queries.getForecast.mockResolvedValueOnce({ eta: '2027-01-01' });
      const res = await request(buildApp()).get('/api/dashboard/forecast').query({ target_date: '2099-01-01' });
      expect(res.status).toBe(200);
      expect(queries.getForecast).toHaveBeenCalledWith({ target_date: '2099-01-01', ref_period: 30 });
    });
  });

  describe('GET /global', () => {
    test('renvoie le cache si présent', async () => {
      cached.mockReturnValueOnce({ hit: true });
      const res = await request(buildApp()).get('/api/dashboard/global');
      expect(res.status).toBe(200);
      expect(queries.getGlobal).not.toHaveBeenCalled();
    });

    test('appelle le service sinon', async () => {
      queries.getGlobal.mockResolvedValueOnce({ total: 42 });
      const res = await request(buildApp()).get('/api/dashboard/global');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ total: 42 });
    });
  });

  describe('GET /stats', () => {
    test('délègue au service', async () => {
      queries.getStats.mockResolvedValueOnce({ stats: true });
      const res = await request(buildApp()).get('/api/dashboard/stats');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ stats: true });
    });
  });
});
