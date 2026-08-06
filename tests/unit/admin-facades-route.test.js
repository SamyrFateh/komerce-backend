/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : façades de montage (Lot B4)
 *
 * routes/admin.js, routes/admin/index.js et routes/parcel-api-v2.js sont de
 * pures façades rétrocompat (`module.exports = require('./sous-module')`)
 * ou des routers qui ne font que monter des sous-routers + guards globaux.
 * Aucune logique métier ici — la logique est dans les sous-routers, testés
 * (ou à tester) séparément. On vérifie : (1) le require ne lève pas, (2) le
 * guard global est bien appliqué avant les sous-routes, (3) le câblage
 * atteint effectivement chaque sous-router (pas de typo de chemin).
 *
 * Run : npx jest tests/unit/admin-facades-route.test.js
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

function buildApp(router, mountPath) {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/admin.js — façade rétrocompat', () => {
  beforeEach(() => { mockUser = { id: 'admin-1', role: 'admin' }; jest.resetModules(); });

  test('se require sans lever et exporte un Router Express', () => {
    const router = require('../../routes/admin');
    expect(typeof router).toBe('function');
    expect(Array.isArray(router.stack)).toBe(true);
    expect(router.stack.length).toBeGreaterThan(0);
  });

  test('délègue bien à routes/admin/index (même router)', () => {
    const facade = require('../../routes/admin');
    const inner = require('../../routes/admin/index');
    expect(facade).toBe(inner);
  });
});

describe('routes/admin/index.js — câblage des sous-routers', () => {
  beforeEach(() => { mockUser = { id: 'admin-1', role: 'admin' }; });

  test('monte les 7 groupes de sous-routers (documents, customs, partners, users, dashboard, system, orders)', () => {
    const router = require('../../routes/admin/index');
    // Chaque router.use('/', require('./X')) ajoute une couche au stack Express.
    expect(router.stack.length).toBeGreaterThanOrEqual(7);
  });

  test('atteint effectivement le sous-router customs (pas de typo de chemin)', async () => {
    const router = require('../../routes/admin/index');
    const res = await request(buildApp(router, '/api/admin')).get('/api/admin/customs');
    // 200 si customs.js répond, ou au pire un guard 403/401 — jamais 404 (ce
    // qui indiquerait que le sous-router n'est pas monté / mauvais chemin).
    expect(res.status).not.toBe(404);
  });

  test('atteint effectivement le sous-router dashboard (redirections)', async () => {
    const router = require('../../routes/admin/index');
    const res = await request(buildApp(router, '/api/admin')).get('/api/admin/dashboard');
    expect(res.status).not.toBe(404);
  });
});

describe('routes/parcel-api-v2.js — façade rétrocompat', () => {
  test('se require sans lever et exporte un Router Express', () => {
    const router = require('../../routes/parcel-api-v2');
    expect(typeof router).toBe('function');
    expect(Array.isArray(router.stack)).toBe(true);
    expect(router.stack.length).toBeGreaterThan(0);
  });

  test('délègue bien à routes/parcel-api-v2/index (même router)', () => {
    const facade = require('../../routes/parcel-api-v2');
    const inner = require('../../routes/parcel-api-v2/index');
    expect(facade).toBe(inner);
  });

  test('applique le guard auth avant les sous-routes (401 sans authentification)', async () => {
    mockUser = null;
    const router = require('../../routes/parcel-api-v2');
    const res = await request(buildApp(router, '/api/parcels-v2')).get('/api/parcels-v2/anything');
    expect(res.status).toBe(401);
  });
});
