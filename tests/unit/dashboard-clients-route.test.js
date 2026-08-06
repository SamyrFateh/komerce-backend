/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/dashboard-clients (Lot B4)
 *
 * Façade R9 : lectures déléguées à services/dashboard-clients-queries.js
 * (mocké — non retesté ici). Couvre le clamping des query params
 * (top, page, page_size), le cache mémoire (dashboard-shared, mocké) et
 * les guards 400/404 de /clients/detail.
 *
 * Run : npx jest tests/unit/dashboard-clients-route.test.js
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

jest.mock('../../services/dashboard-clients-queries', () => ({
  getClientsAnalysis: jest.fn(),
  getClientsList: jest.fn(),
  getClientDetail: jest.fn(),
  getHistory: jest.fn(),
  getRelais: jest.fn(),
}));

const { cached, setCache } = require('../../routes/dashboard-shared');
const queries = require('../../services/dashboard-clients-queries');
const router = require('../../routes/dashboard-clients');

function buildApp() {
  const app = express();
  app.use('/api/dashboard', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/dashboard-clients', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /clients', () => {
    test('renvoie le cache si présent', async () => {
      cached.mockReturnValueOnce({ hit: true });
      const res = await request(buildApp()).get('/api/dashboard/clients');
      expect(res.status).toBe(200);
      expect(queries.getClientsAnalysis).not.toHaveBeenCalled();
    });

    test('applique les défauts (top=20, seuil VIP=200000)', async () => {
      queries.getClientsAnalysis.mockResolvedValueOnce({ ok: true });
      await request(buildApp()).get('/api/dashboard/clients');
      expect(queries.getClientsAnalysis).toHaveBeenCalledWith(expect.objectContaining({
        top: 20, seuilVipKmf: 200000,
      }));
    });

    test('clamp top à 50 maximum', async () => {
      queries.getClientsAnalysis.mockResolvedValueOnce({ ok: true });
      await request(buildApp()).get('/api/dashboard/clients').query({ top: '999' });
      expect(queries.getClientsAnalysis).toHaveBeenCalledWith(expect.objectContaining({ top: 50 }));
    });

    test('clamp top à 1 minimum (valeur négative)', async () => {
      queries.getClientsAnalysis.mockResolvedValueOnce({ ok: true });
      await request(buildApp()).get('/api/dashboard/clients').query({ top: '-5' });
      expect(queries.getClientsAnalysis).toHaveBeenCalledWith(expect.objectContaining({ top: 1 }));
    });

    test('top=0 retombe sur le défaut 20 (falsy — pas cliniquement clampé à 1)', async () => {
      queries.getClientsAnalysis.mockResolvedValueOnce({ ok: true });
      await request(buildApp()).get('/api/dashboard/clients').query({ top: '0' });
      expect(queries.getClientsAnalysis).toHaveBeenCalledWith(expect.objectContaining({ top: 20 }));
    });

    test('met en cache le résultat avec une clé dépendant des filtres', async () => {
      queries.getClientsAnalysis.mockResolvedValueOnce({ ok: true });
      await request(buildApp()).get('/api/dashboard/clients').query({ top: '10', debut: '2025-01-01', fin: '2025-12-31' });
      expect(setCache).toHaveBeenCalledWith('clients_v2_2025-01-01_2025-12-31_10_200000', { ok: true });
    });
  });

  describe('GET /clients/list', () => {
    test('applique les défauts (page=1, page_size=25, segment=all)', async () => {
      queries.getClientsList.mockResolvedValueOnce({ items: [] });
      await request(buildApp()).get('/api/dashboard/clients/list');
      expect(queries.getClientsList).toHaveBeenCalledWith(expect.objectContaining({
        page: 1, pageSize: 25, search: '', segment: 'all', island: null, seuilVipKmf: 200000,
      }));
    });

    test('clamp page_size entre 10 et 100', async () => {
      queries.getClientsList.mockResolvedValueOnce({ items: [] });
      await request(buildApp()).get('/api/dashboard/clients/list').query({ page_size: '500' });
      expect(queries.getClientsList).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 }));
    });

    test('trim la recherche', async () => {
      queries.getClientsList.mockResolvedValueOnce({ items: [] });
      await request(buildApp()).get('/api/dashboard/clients/list').query({ search: '  Ali  ' });
      expect(queries.getClientsList).toHaveBeenCalledWith(expect.objectContaining({ search: 'Ali' }));
    });
  });

  describe('GET /clients/detail', () => {
    test('400 si phone manquant', async () => {
      const res = await request(buildApp()).get('/api/dashboard/clients/detail');
      expect(res.status).toBe(400);
      expect(queries.getClientDetail).not.toHaveBeenCalled();
    });

    test('404 si client introuvable', async () => {
      queries.getClientDetail.mockResolvedValueOnce(null);
      const res = await request(buildApp()).get('/api/dashboard/clients/detail').query({ phone: '+269123' });
      expect(res.status).toBe(404);
    });

    test('renvoie le détail client', async () => {
      queries.getClientDetail.mockResolvedValueOnce({ phone: '+269123', name: 'Ali' });
      const res = await request(buildApp()).get('/api/dashboard/clients/detail').query({ phone: '+269123' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ phone: '+269123', name: 'Ali' });
    });
  });

  describe('GET /history', () => {
    test('clamp nbMois entre 1 et 24', async () => {
      queries.getHistory.mockResolvedValueOnce([]);
      await request(buildApp()).get('/api/dashboard/history').query({ mois: '999' });
      expect(queries.getHistory).toHaveBeenCalledWith(24);
    });

    test('défaut à 6 mois', async () => {
      queries.getHistory.mockResolvedValueOnce([]);
      await request(buildApp()).get('/api/dashboard/history');
      expect(queries.getHistory).toHaveBeenCalledWith(6);
    });
  });

  describe('GET /relais', () => {
    test('renvoie le cache si présent', async () => {
      cached.mockReturnValueOnce({ hit: true });
      const res = await request(buildApp()).get('/api/dashboard/relais');
      expect(res.status).toBe(200);
      expect(queries.getRelais).not.toHaveBeenCalled();
    });

    test('appelle le service et met en cache sinon', async () => {
      queries.getRelais.mockResolvedValueOnce({ list: [] });
      const res = await request(buildApp()).get('/api/dashboard/relais');
      expect(res.status).toBe(200);
      expect(setCache).toHaveBeenCalledWith('relais', { list: [] });
    });
  });
});
