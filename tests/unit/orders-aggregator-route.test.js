'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/orders-aggregator-route.test.js
 *
 * Tests du router routes/orders.js — fichier mince qui agrège les
 * sous-routers (list, qr, parcels, cancel, status, create, detail).
 *
 * routes/orders/list.js, routes/orders/qr.js et routes/orders/detail.js
 * ont déjà leur propre suite (orders-list, qr, orders-detail) ; ce fichier
 * NE reteste PAS leur logique métier. Son seul rôle est de vérifier que
 * routes/orders.js monte bien les 7 sous-routers, dans le bon ordre, sans
 * collision de route — c'est la garantie que le commentaire "l'ordre est
 * critique pour éviter les collisions Express" dans le fichier source reste
 * vraie dans le temps.
 *
 * Stratégie : chaque sous-router réel est remplacé par un stub minimal et
 * identifiable (un seul endpoint qui répond avec son propre nom). On vérifie
 * ensuite que chaque endpoint attendu atteint bien le bon stub.
 */

jest.mock('../../routes/orders/list', () => {
  const express = require('express');
  const r = express.Router();
  r.get('/', (req, res) => res.json({ from: 'list', path: '/' }));
  r.get('/relais', (req, res) => res.json({ from: 'list', path: '/relais' }));
  r.get('/problems', (req, res) => res.json({ from: 'list', path: '/problems' }));
  r.get('/credits', (req, res) => res.json({ from: 'list', path: '/credits' }));
  return r;
});

jest.mock('../../routes/orders/qr', () => {
  const express = require('express');
  const r = express.Router();
  r.get('/retrait/:token', (req, res) => res.json({ from: 'qr', token: req.params.token }));
  r.post('/:id/qr-token', (req, res) => res.json({ from: 'qr', id: req.params.id }));
  return r;
});

jest.mock('../../routes/orders/parcels', () => {
  const express = require('express');
  const r = express.Router();
  r.get('/:id/parcels', (req, res) => res.json({ from: 'parcels', id: req.params.id }));
  r.patch('/parcels/:parcelId/status', (req, res) => res.json({ from: 'parcels', parcelId: req.params.parcelId }));
  return r;
});

jest.mock('../../routes/orders/cancel', () => {
  const express = require('express');
  const r = express.Router();
  r.post('/:id/cancel', (req, res) => res.json({ from: 'cancel', id: req.params.id }));
  r.post('/:id/cancel-backorder', (req, res) => res.json({ from: 'cancel', sub: 'backorder', id: req.params.id }));
  return r;
});

jest.mock('../../routes/orders/status', () => {
  const express = require('express');
  const r = express.Router();
  r.patch('/:id/status', (req, res) => res.json({ from: 'status', id: req.params.id }));
  r.patch('/:id/cost', (req, res) => res.json({ from: 'status', sub: 'cost', id: req.params.id }));
  return r;
});

jest.mock('../../routes/orders/create', () => {
  const express = require('express');
  const r = express.Router();
  r.post('/', (req, res) => res.json({ from: 'create' }));
  return r;
});

jest.mock('../../routes/orders/detail', () => {
  const express = require('express');
  const r = express.Router();
  r.get('/:ref', (req, res) => res.json({ from: 'detail', ref: req.params.ref }));
  r.get('/:id/history', (req, res) => res.json({ from: 'detail', sub: 'history', id: req.params.id }));
  return r;
});

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());

  jest.isolateModules(() => {
    const router = require('../../routes/orders');
    app.use('/api/orders', router);
  });
});

describe('routes/orders.js — agrégation des sous-routers', () => {
  it('GET /api/orders → list (route racine)', async () => {
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: 'list', path: '/' });
  });

  it('GET /api/orders/relais → list', async () => {
    const res = await request(app).get('/api/orders/relais');
    expect(res.body.from).toBe('list');
  });

  it('GET /api/orders/problems → list', async () => {
    const res = await request(app).get('/api/orders/problems');
    expect(res.body.from).toBe('list');
  });

  it('GET /api/orders/credits → list', async () => {
    const res = await request(app).get('/api/orders/credits');
    expect(res.body.from).toBe('list');
  });

  it('GET /api/orders/retrait/:token → qr (route publique de retrait)', async () => {
    const res = await request(app).get('/api/orders/retrait/abc123');
    expect(res.body).toEqual({ from: 'qr', token: 'abc123' });
  });

  it('POST /api/orders/:id/qr-token → qr', async () => {
    const res = await request(app).post('/api/orders/42/qr-token');
    expect(res.body).toEqual({ from: 'qr', id: '42' });
  });

  it('GET /api/orders/:id/parcels → parcels', async () => {
    const res = await request(app).get('/api/orders/42/parcels');
    expect(res.body).toEqual({ from: 'parcels', id: '42' });
  });

  it('PATCH /api/orders/parcels/:parcelId/status → parcels', async () => {
    const res = await request(app).patch('/api/orders/parcels/p1/status');
    expect(res.body).toEqual({ from: 'parcels', parcelId: 'p1' });
  });

  it('POST /api/orders/:id/cancel → cancel', async () => {
    const res = await request(app).post('/api/orders/42/cancel');
    expect(res.body).toEqual({ from: 'cancel', id: '42' });
  });

  it('POST /api/orders/:id/cancel-backorder → cancel (pas confondu avec /:id/cancel)', async () => {
    const res = await request(app).post('/api/orders/42/cancel-backorder');
    expect(res.body).toEqual({ from: 'cancel', sub: 'backorder', id: '42' });
  });

  it('PATCH /api/orders/:id/status → status', async () => {
    const res = await request(app).patch('/api/orders/42/status');
    expect(res.body).toEqual({ from: 'status', id: '42' });
  });

  it('PATCH /api/orders/:id/cost → status', async () => {
    const res = await request(app).patch('/api/orders/42/cost');
    expect(res.body).toEqual({ from: 'status', sub: 'cost', id: '42' });
  });

  it('POST /api/orders → create (pas confondu avec GET /)', async () => {
    const res = await request(app).post('/api/orders');
    expect(res.body).toEqual({ from: 'create' });
  });

  it('GET /api/orders/:ref → detail (catch-all paramétré, monté en dernier)', async () => {
    const res = await request(app).get('/api/orders/CMD-2026-001');
    expect(res.body).toEqual({ from: 'detail', ref: 'CMD-2026-001' });
  });

  it('GET /api/orders/:id/history → detail', async () => {
    const res = await request(app).get('/api/orders/42/history');
    expect(res.body).toEqual({ from: 'detail', sub: 'history', id: '42' });
  });

  it('monte les 7 sous-routers dans l\'ordre déclaré (list, qr, parcels, cancel, status, create, detail)', () => {
    jest.isolateModules(() => {
      const order = [];
      jest.doMock('../../routes/orders/list', () => { order.push('list'); return require('express').Router(); });
      jest.doMock('../../routes/orders/qr', () => { order.push('qr'); return require('express').Router(); });
      jest.doMock('../../routes/orders/parcels', () => { order.push('parcels'); return require('express').Router(); });
      jest.doMock('../../routes/orders/cancel', () => { order.push('cancel'); return require('express').Router(); });
      jest.doMock('../../routes/orders/status', () => { order.push('status'); return require('express').Router(); });
      jest.doMock('../../routes/orders/create', () => { order.push('create'); return require('express').Router(); });
      jest.doMock('../../routes/orders/detail', () => { order.push('detail'); return require('express').Router(); });

      require('../../routes/orders');

      expect(order).toEqual(['list', 'qr', 'parcels', 'cancel', 'status', 'create', 'detail']);
    });
  });
});
