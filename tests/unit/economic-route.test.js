/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/economic (Lot B4)
 *
 * Façade R9 : lectures/mutations déléguées à
 * services/economic-engine-queries.js (mocké — non retesté ici). Couvre :
 * guard requireAdmin, invalidation cache (utils/eco-bridge) après chaque
 * mutation, et le pattern `{ error, status }` renvoyé par le service que
 * la route traduit en code HTTP. seedEconomicData() est appelée au require
 * (effet de bord module-level) — mockée pour ne rien faire.
 *
 * Run : npx jest tests/unit/economic-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant' });
    req.user = mockUser;
    next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé' });
    }
    next();
  },
}));

jest.mock('../../utils/eco-bridge', () => ({
  invalidateEcoCache: jest.fn(),
  invalidateChargesCache: jest.fn(),
}));

jest.mock('../../services/economic-engine-queries', () => ({
  seedEconomicData: jest.fn().mockResolvedValue(undefined),
  buildExecutiveSummary: jest.fn(),
  getVariables: jest.fn(),
  getCharges: jest.fn(),
  getCoherence: jest.fn(),
  getHistory: jest.fn(),
  updateVariable: jest.fn(),
  createCharge: jest.fn(),
  updateCharge: jest.fn(),
  toggleCharge: jest.fn(),
  deleteCharge: jest.fn(),
  redistribute: jest.fn(),
}));

const ecoBridge = require('../../utils/eco-bridge');
const queries = require('../../services/economic-engine-queries');
const router = require('../../routes/economic');

// jest.config.js a `clearMocks: true` (global) : Jest efface l'historique de
// TOUS les mocks avant CHAQUE test, y compris le tout premier — le beforeEach
// local n'y est donc pour rien. On capture l'état ici, en synchrone, juste
// après le require() du module (qui déclenche seedEconomicData() en effet
// de bord ligne 49 de routes/economic.js), avant que Jest ne nettoie quoi
// que ce soit.
const seedCalledAtModuleLoad = queries.seedEconomicData.mock.calls.length > 0;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/economic', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

test('appelle seedEconomicData au chargement du module', () => {
  // On n'appelle pas toHaveBeenCalled() sur le mock lui-même : avec
  // `clearMocks: true` en config globale, son historique est déjà à zéro au
  // moment où ce test s'exécute (Jest nettoie avant CHAQUE test). On vérifie
  // donc le booléen capturé en synchrone au chargement du fichier, juste
  // après le require() de routes/economic.js.
  expect(seedCalledAtModuleLoad).toBe(true);
});

describe('routes/economic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: 'admin-1', role: 'admin' };
  });

  test('refuse un rôle non admin', async () => {
    mockUser = { id: 'u1', role: 'agent_hub' };
    const res = await request(buildApp()).get('/api/economic/executive');
    expect(res.status).toBe(403);
  });

  test('refuse sans authentification', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/economic/executive');
    expect(res.status).toBe(401);
  });

  describe('GET /executive', () => {
    test('délègue à buildExecutiveSummary', async () => {
      queries.buildExecutiveSummary.mockResolvedValueOnce({ margin: 12 });
      const res = await request(buildApp()).get('/api/economic/executive');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ margin: 12 });
    });
  });

  describe('GET /variables', () => {
    test('délègue à getVariables', async () => {
      queries.getVariables.mockResolvedValueOnce([{ key: 'eur_kmf' }]);
      const res = await request(buildApp()).get('/api/economic/variables');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ key: 'eur_kmf' }]);
    });
  });

  describe('PUT /variables/:key', () => {
    test('met à jour et invalide les deux caches', async () => {
      queries.updateVariable.mockResolvedValueOnce({ key: 'eur_kmf', value: 750 });
      const res = await request(buildApp()).put('/api/economic/variables/eur_kmf').send({ value: 750 });
      expect(res.status).toBe(200);
      expect(queries.updateVariable).toHaveBeenCalledWith('eur_kmf', { value: 750 }, 'admin-1');
      expect(ecoBridge.invalidateEcoCache).toHaveBeenCalled();
      expect(ecoBridge.invalidateChargesCache).toHaveBeenCalled();
    });

    test('renvoie le code d\'erreur du service sans invalider le cache', async () => {
      queries.updateVariable.mockResolvedValueOnce({ error: 'Valeur invalide', status: 422 });
      const res = await request(buildApp()).put('/api/economic/variables/eur_kmf').send({ value: -1 });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: 'Valeur invalide' });
      expect(ecoBridge.invalidateEcoCache).not.toHaveBeenCalled();
    });

    test('défaut 400 si le service ne précise pas de status', async () => {
      queries.updateVariable.mockResolvedValueOnce({ error: 'Erreur générique' });
      const res = await request(buildApp()).put('/api/economic/variables/eur_kmf').send({ value: -1 });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /charges', () => {
    test('délègue à getCharges', async () => {
      queries.getCharges.mockResolvedValueOnce([{ id: 'c1' }]);
      const res = await request(buildApp()).get('/api/economic/charges');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: 'c1' }]);
    });
  });

  describe('POST /charges', () => {
    test('crée et invalide les caches', async () => {
      queries.createCharge.mockResolvedValueOnce({ id: 'c1', label: 'Loyer' });
      const res = await request(buildApp()).post('/api/economic/charges').send({ label: 'Loyer' });
      expect(res.status).toBe(200);
      expect(ecoBridge.invalidateEcoCache).toHaveBeenCalled();
      expect(ecoBridge.invalidateChargesCache).toHaveBeenCalled();
    });

    test('renvoie l\'erreur du service sans invalider le cache', async () => {
      queries.createCharge.mockResolvedValueOnce({ error: 'label requis', status: 400 });
      const res = await request(buildApp()).post('/api/economic/charges').send({});
      expect(res.status).toBe(400);
      expect(ecoBridge.invalidateEcoCache).not.toHaveBeenCalled();
    });
  });

  describe('PUT /charges/:id', () => {
    test('met à jour et invalide les caches', async () => {
      queries.updateCharge.mockResolvedValueOnce({ id: 'c1', label: 'Loyer 2' });
      const res = await request(buildApp()).put('/api/economic/charges/c1').send({ label: 'Loyer 2' });
      expect(res.status).toBe(200);
      expect(queries.updateCharge).toHaveBeenCalledWith('c1', { label: 'Loyer 2' });
      expect(ecoBridge.invalidateEcoCache).toHaveBeenCalled();
    });
  });

  describe('PUT /charges/:id/toggle', () => {
    test('bascule et invalide les caches', async () => {
      queries.toggleCharge.mockResolvedValueOnce({ id: 'c1', active: false });
      const res = await request(buildApp()).put('/api/economic/charges/c1/toggle');
      expect(res.status).toBe(200);
      expect(queries.toggleCharge).toHaveBeenCalledWith('c1');
      expect(ecoBridge.invalidateEcoCache).toHaveBeenCalled();
    });

    test('défaut 404 si le service ne précise pas de status', async () => {
      queries.toggleCharge.mockResolvedValueOnce({ error: 'Charge introuvable' });
      const res = await request(buildApp()).put('/api/economic/charges/c404/toggle');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /charges/:id', () => {
    test('supprime et invalide les caches', async () => {
      queries.deleteCharge.mockResolvedValueOnce({ success: true });
      const res = await request(buildApp()).delete('/api/economic/charges/c1');
      expect(res.status).toBe(200);
      expect(queries.deleteCharge).toHaveBeenCalledWith('c1', false);
      expect(ecoBridge.invalidateEcoCache).toHaveBeenCalled();
    });

    test('force=true/1 est transmis au service', async () => {
      queries.deleteCharge.mockResolvedValueOnce({ success: true });
      await request(buildApp()).delete('/api/economic/charges/c1').query({ force: 'true' });
      expect(queries.deleteCharge).toHaveBeenCalledWith('c1', true);
    });

    test('renvoie l\'erreur + hint du service sans invalider le cache', async () => {
      queries.deleteCharge.mockResolvedValueOnce({ error: 'Charge liée à des commandes', status: 409, hint: 'Désactivez-la plutôt' });
      const res = await request(buildApp()).delete('/api/economic/charges/c1');
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Charge liée à des commandes', hint: 'Désactivez-la plutôt' });
      expect(ecoBridge.invalidateEcoCache).not.toHaveBeenCalled();
    });
  });

  describe('GET /coherence', () => {
    test('délègue à getCoherence', async () => {
      queries.getCoherence.mockResolvedValueOnce({ checks_passed: true });
      const res = await request(buildApp()).get('/api/economic/coherence');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ checks_passed: true });
    });
  });

  describe('GET /history', () => {
    test('délègue à getHistory', async () => {
      queries.getHistory.mockResolvedValueOnce([{ date: '2026-06' }]);
      const res = await request(buildApp()).get('/api/economic/history');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ date: '2026-06' }]);
    });
  });

  describe('POST /redistribute', () => {
    test('force la redistribution puis renvoie le résumé exécutif', async () => {
      queries.redistribute.mockResolvedValueOnce(undefined);
      queries.buildExecutiveSummary.mockResolvedValueOnce({ margin: 15 });

      const res = await request(buildApp()).post('/api/economic/redistribute');

      expect(res.status).toBe(200);
      expect(queries.redistribute).toHaveBeenCalledWith('manual_force');
      expect(res.body).toEqual({ margin: 15 });
    });
  });
});
