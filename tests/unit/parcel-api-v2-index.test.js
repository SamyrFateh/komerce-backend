'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcel-api-v2-index.test.js
 * Tests unitaires de routes/parcel-api-v2/index.js — Bloc 7.
 *
 * index.js ne contient aucune logique propre : il monte dans l'ordre
 *   authenticate -> requireRole([...]) -> relayAgentScopeMiddleware -> read.js -> scans.js
 * On vérifie donc l'ORDRE d'exécution et la délégation, en mockant
 * chaque dépendance individuellement (read.js/scans.js sont déjà testés
 * ailleurs en détail).
 */

const calls = [];

jest.mock('../../middleware/auth', () => ({
  authenticate: jest.fn((req, res, next) => { calls.push('authenticate'); next(); }),
  requireRole: jest.fn((roles) => {
    return (req, res, next) => { calls.push(`requireRole:${roles.join(',')}`); next(); };
  }),
}));

jest.mock('../../routes/parcel-api-v2/helpers', () => ({
  relayAgentScopeMiddleware: jest.fn((req, res, next) => { calls.push('relayAgentScopeMiddleware'); next(); }),
}));

jest.mock('../../routes/parcel-api-v2/read', () => {
  const express = require('express');
  const r = express.Router();
  r.get('/from-read', (req, res) => { calls.push('read-route'); res.json({ from: 'read' }); });
  return r;
});

jest.mock('../../routes/parcel-api-v2/scans', () => {
  const express = require('express');
  const r = express.Router();
  r.post('/from-scans/scan', (req, res) => { calls.push('scans-route'); res.json({ from: 'scans' }); });
  return r;
});

const express = require('express');
const request = require('supertest');

let app, authenticate, requireRole, relayAgentScopeMiddleware;

function mountApp() {
  jest.isolateModules(() => {
    // require les mocks DANS le même registre isolé que index.js, sinon
    // les références capturées par le test divergent de celles utilisées
    // réellement par le router (cf. bug rencontré sur scans.js).
    ({ authenticate, requireRole } = require('../../middleware/auth'));
    ({ relayAgentScopeMiddleware } = require('../../routes/parcel-api-v2/helpers'));
    const router = require('../../routes/parcel-api-v2/index');
    app = express();
    app.use(express.json());
    app.use('/api/v2/parcels', router);
  });
}

beforeEach(() => {
  calls.length = 0;
  mountApp();
});

describe('routes/parcel-api-v2/index.js — montage', () => {
  test('requireRole est appelé avec les rôles admin + agent_hub + agent_relais', () => {
    expect(requireRole).toHaveBeenCalledWith(['admin', 'agent_hub', 'agent_relais']);
  });

  test("l'ordre d'exécution est authenticate -> requireRole -> relayAgentScopeMiddleware -> sous-routeur", async () => {
    const res = await request(app).get('/api/v2/parcels/from-read');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: 'read' });
    expect(calls).toEqual([
      'authenticate',
      'requireRole:admin,agent_hub,agent_relais',
      'relayAgentScopeMiddleware',
      'read-route',
    ]);
  });

  test('le sous-routeur scans.js est bien monté et atteint après les middlewares', async () => {
    const res = await request(app).post('/api/v2/parcels/from-scans/scan');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: 'scans' });
    expect(calls).toEqual([
      'authenticate',
      'requireRole:admin,agent_hub,agent_relais',
      'relayAgentScopeMiddleware',
      'scans-route',
    ]);
  });

  test('si authenticate bloque la requête (ex: 401), les sous-routeurs ne sont jamais atteints', async () => {
    authenticate.mockImplementationOnce((req, res) => {
      calls.push('authenticate-blocked');
      res.status(401).json({ error: 'unauthenticated' });
    });

    const res = await request(app).get('/api/v2/parcels/from-read');

    expect(res.status).toBe(401);
    expect(calls).toEqual(['authenticate-blocked']);
  });

  test('si relayAgentScopeMiddleware bloque (ex: 403), les sous-routeurs ne sont jamais atteints', async () => {
    relayAgentScopeMiddleware.mockImplementationOnce((req, res) => {
      calls.push('scope-blocked');
      res.status(403).json({ error: 'Configuration agent incomplète — aucun relais associé' });
    });

    const res = await request(app).get('/api/v2/parcels/from-read');

    expect(res.status).toBe(403);
    expect(calls).toEqual(['authenticate', 'requireRole:admin,agent_hub,agent_relais', 'scope-blocked']);
  });
});
