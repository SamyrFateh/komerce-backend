'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
}));
jest.mock('../../services/shared-cart-library', () => ({
  removeSavedSharedCartForUser: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { removeSavedSharedCartForUser } = require('../../services/shared-cart-library');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/shared-carts/saved', require('../../routes/shared-cart-saved'));
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('DELETE /api/shared-carts/saved/:sharedCartId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('retire seulement le signet de l’utilisateur courant', async () => {
    removeSavedSharedCartForUser.mockResolvedValue({ removed: true, shared_cart_id: 'sc-1' });
    const res = await request(makeApp()).delete('/api/shared-carts/saved/sc-1');
    expect(res.status).toBe(200);
    expect(removeSavedSharedCartForUser).toHaveBeenCalledWith('user-1', 'sc-1');
    expect(res.body.removed).toBe(true);
  });

  test('propage une erreur métier structurée sans la convertir en 500', async () => {
    removeSavedSharedCartForUser.mockRejectedValue(Object.assign(new Error('Liste introuvable'), { status: 404, code: 'not_found' }));
    const res = await request(makeApp()).delete('/api/shared-carts/saved/missing');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  test('une erreur inconnue va au handler central', async () => {
    removeSavedSharedCartForUser.mockRejectedValue(new Error('boom'));
    const res = await request(makeApp()).delete('/api/shared-carts/saved/sc-1');
    expect(res.status).toBe(500);
  });
});
