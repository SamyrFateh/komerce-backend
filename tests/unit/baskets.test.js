'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/baskets.test.js
 * Couvre routes/baskets.js
 *
 * Module "tombstone" (2026-05-30) : toute requête répond 410 Gone, sans
 * auth, sans accès DB. Le panier partagé vit désormais sous /api/shared-carts.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const basketsRouter = require('../../routes/baskets');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/baskets', basketsRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('router — endpoint legacy désactivé', () => {
  it('GET / → 410 Gone, sans authentification requise', async () => {
    const res = await request(buildApp()).get('/api/baskets');
    expect(res.status).toBe(410);
    expect(res.body).toEqual({
      error: 'baskets_disabled',
      message: 'Ce parcours est désactivé. Utilisez /api/shared-carts pour le panier partagé.',
      migration: 'POST /api/shared-carts/from-basket si vous avez un basket_id existant.',
    });
  });

  it('toute sous-route arbitraire → 410 Gone (catch-all)', async () => {
    const res = await request(buildApp()).get('/api/baskets/b1/items');
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('baskets_disabled');
  });

  it('toute méthode HTTP (POST, PATCH, DELETE) → 410 Gone', async () => {
    const app = buildApp();
    const post = await request(app).post('/api/baskets').send({ foo: 'bar' });
    const patch = await request(app).patch('/api/baskets/b1');
    const del = await request(app).delete('/api/baskets/b1');
    expect(post.status).toBe(410);
    expect(patch.status).toBe(410);
    expect(del.status).toBe(410);
  });

  it('fonctionne même avec un body vide/malformé', async () => {
    const res = await request(buildApp()).post('/api/baskets');
    expect(res.status).toBe(410);
  });
});

describe('exports', () => {
  it('expose router (express.Router, fonction)', () => {
    expect(typeof basketsRouter).toBe('function');
  });
});
