'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/simulator-route.test.js
 *
 * Tests du router routes/simulator.js (Control Tower — moteur de simulation)
 *
 * Couverture :
 *   ✓ auth : authenticate + requireRole(['admin']) sur toutes les routes
 *   ✓ POST /start → config par défaut appliquée + engine.start()
 *   ✓ POST /start → erreur engine → 400 { error }
 *   ✓ POST /stop → engine.stop()
 *   ✓ POST /stop → erreur → 400
 *   ✓ GET /status → engine.getStatus(), catch → { running:false, error }
 *   ✓ GET /journal → journal.getAll(), catch → { entries: [], error }
 *   ✓ POST /cleanup → arrête la simulation (best-effort, n'échoue pas si stop() throw) puis cleanup()
 *   ✓ POST /cleanup → erreur cleanup() → next(err)
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const mockStart = jest.fn();
const mockStop = jest.fn();
const mockGetStatus = jest.fn();
jest.mock('../../services/simulator/engine', () => ({
  start: (...a) => mockStart(...a),
  stop: (...a) => mockStop(...a),
  getStatus: (...a) => mockGetStatus(...a),
}));

const mockGetAll = jest.fn();
jest.mock('../../services/simulator/journal', () => ({
  getAll: (...a) => mockGetAll(...a),
}));

const mockCleanup = jest.fn();
jest.mock('../../services/simulator/cleanup', () => ({
  cleanup: (...a) => mockCleanup(...a),
}));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/simulator');
    app.use('/api/simulator', router);
  });
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });
});

describe('routes/simulator — POST /start', () => {
  it('applique les valeurs par défaut si non fournies', async () => {
    mockStart.mockResolvedValueOnce({ running: true });

    const res = await request(app).post('/api/simulator/start').send({});

    expect(res.status).toBe(200);
    expect(mockStart).toHaveBeenCalledWith({
      cadence_minutes: 3,
      max_orders: 20,
      chaos_level: 0.1,
      scenarios: ['nominal', 'abandoned', 'cancelled'],
    });
    expect(res.body.message).toMatch(/démarrée/);
    expect(res.body.running).toBe(true);
  });

  it('utilise les valeurs fournies par le body', async () => {
    mockStart.mockResolvedValueOnce({ running: true });

    await request(app).post('/api/simulator/start').send({
      cadence_minutes: 5, max_orders: 50, chaos_level: 0.3, scenarios: ['nominal'],
    });

    expect(mockStart).toHaveBeenCalledWith({
      cadence_minutes: 5, max_orders: 50, chaos_level: 0.3, scenarios: ['nominal'],
    });
  });

  it('400 si engine.start() rejette (ex: simulation déjà en cours)', async () => {
    mockStart.mockRejectedValueOnce(new Error('Simulation déjà en cours'));

    const res = await request(app).post('/api/simulator/start').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Simulation déjà en cours');
  });
});

describe('routes/simulator — POST /stop', () => {
  it('arrête la simulation', async () => {
    mockStop.mockResolvedValueOnce({ running: false });

    const res = await request(app).post('/api/simulator/stop');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/arrêtée/);
    expect(res.body.running).toBe(false);
  });

  it('400 si engine.stop() rejette', async () => {
    mockStop.mockRejectedValueOnce(new Error('boom'));

    const res = await request(app).post('/api/simulator/stop');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('boom');
  });
});

describe('routes/simulator — GET /status', () => {
  it('renvoie le statut du moteur', async () => {
    mockGetStatus.mockReturnValueOnce({ running: true, tick_count: 5 });

    const res = await request(app).get('/api/simulator/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ running: true, tick_count: 5 });
  });

  it('renvoie { running:false, error } si getStatus() lève une exception (jamais de 500)', async () => {
    mockGetStatus.mockImplementationOnce(() => { throw new Error('state corrupted'); });

    const res = await request(app).get('/api/simulator/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ running: false, error: 'state corrupted' });
  });
});

describe('routes/simulator — GET /journal', () => {
  it('renvoie les entrées du journal', async () => {
    mockGetAll.mockReturnValueOnce([{ message: 'tick 1' }]);

    const res = await request(app).get('/api/simulator/journal');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: [{ message: 'tick 1' }] });
  });

  it('renvoie { entries: [], error } si journal.getAll() lève une exception', async () => {
    mockGetAll.mockImplementationOnce(() => { throw new Error('journal corrompu'); });

    const res = await request(app).get('/api/simulator/journal');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: [], error: 'journal corrompu' });
  });
});

describe('routes/simulator — POST /cleanup', () => {
  it('arrête la simulation puis nettoie et renvoie les résultats', async () => {
    mockStop.mockResolvedValueOnce({ running: false });
    mockCleanup.mockResolvedValueOnce({ orders_deleted: 12 });

    const res = await request(app).post('/api/simulator/cleanup');

    expect(res.status).toBe(200);
    expect(mockStop).toHaveBeenCalled();
    expect(res.body.message).toMatch(/Nettoyage terminé/);
    expect(res.body.orders_deleted).toBe(12);
  });

  it('continue le nettoyage même si stop() échoue (best-effort)', async () => {
    mockStop.mockRejectedValueOnce(new Error('pas de simulation en cours'));
    mockCleanup.mockResolvedValueOnce({ orders_deleted: 0 });

    const res = await request(app).post('/api/simulator/cleanup');

    expect(res.status).toBe(200);
    expect(mockCleanup).toHaveBeenCalled();
  });

  it('propage vers next(err) si cleanup() échoue', async () => {
    mockStop.mockResolvedValueOnce({ running: false });
    mockCleanup.mockRejectedValueOnce(new Error('cleanup failed'));

    const res = await request(app).post('/api/simulator/cleanup');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('cleanup failed');
  });
});

describe('routes/simulator — auth', () => {
  it('403 si le rôle n\'est pas admin', async () => {
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'u1', role: 'client' }; next(); });
    jest.isolateModules(() => {
      const router = require('../../routes/simulator');
      app.use('/api/simulator', router);
    });

    const res = await request(app).get('/api/simulator/status');
    expect(res.status).toBe(403);
  });
});
