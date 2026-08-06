/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/dashboard (Lot B4)
 *
 * Point d'entrée dashboard v12.0 — applique le guard admin une seule fois
 * puis monte 4 sous-routers (ops, finance, clients, hub). Les sous-routers
 * sont mockés ici (testés séparément) — on isole le rôle propre à ce
 * fichier : authentification + câblage.
 *
 * Run : npx jest tests/unit/dashboard-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant' });
    req.user = mockUser;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès réservé' });
    }
    next();
  },
}));

function stubRouter(path, payload) {
  const r = express.Router();
  r.get(path, (req, res) => res.json(payload));
  return r;
}

jest.mock('../../routes/dashboard-ops', () => {
  const express = require('express');
  const r = express.Router();
  r.get('/ops', (req, res) => res.json({ from: 'ops' }));
  return r;
});
jest.mock('../../routes/dashboard-finance', () => {
  const express = require('express');
  const r = express.Router();
  r.get('/finance', (req, res) => res.json({ from: 'finance' }));
  return r;
});
jest.mock('../../routes/dashboard-clients', () => {
  const express = require('express');
  const r = express.Router();
  r.get('/clients', (req, res) => res.json({ from: 'clients' }));
  return r;
});
jest.mock('../../routes/dashboard-hub', () => {
  const express = require('express');
  const r = express.Router();
  r.get('/hub-dubai', (req, res) => res.json({ from: 'hub' }));
  return r;
});

const router = require('../../routes/dashboard');

function buildApp() {
  const app = express();
  app.use('/api/dashboard', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/dashboard — point d\'entrée', () => {
  beforeEach(() => {
    mockUser = { id: 'admin-1', role: 'admin' };
  });

  test('refuse un rôle non admin avant même d\'atteindre les sous-routers', async () => {
    mockUser = { id: 'u1', role: 'agent_hub' };
    const res = await request(buildApp()).get('/api/dashboard/ops');
    expect(res.status).toBe(403);
  });

  test('refuse sans authentification', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/dashboard/ops');
    expect(res.status).toBe(401);
  });

  test('route vers dashboard-ops', async () => {
    const res = await request(buildApp()).get('/api/dashboard/ops');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: 'ops' });
  });

  test('route vers dashboard-finance', async () => {
    const res = await request(buildApp()).get('/api/dashboard/finance');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: 'finance' });
  });

  test('route vers dashboard-clients', async () => {
    const res = await request(buildApp()).get('/api/dashboard/clients');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: 'clients' });
  });

  test('route vers dashboard-hub (hub-dubai)', async () => {
    const res = await request(buildApp()).get('/api/dashboard/hub-dubai');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: 'hub' });
  });

  test('404 sur un chemin non monté', async () => {
    const res = await request(buildApp()).get('/api/dashboard/inexistant');
    expect(res.status).toBe(404);
  });
});
