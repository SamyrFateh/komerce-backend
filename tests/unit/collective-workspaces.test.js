'use strict';

/**
 * tests/unit/collective-workspaces.test.js
 * Couvre routes/collective-workspaces.js
 *
 * Module "tombstone" : tout endpoint legacy répond 410 Gone, sans auth,
 * sans accès DB. router et paymentsRouter délèguent tous les deux à
 * disabled(). stripeWebhookHandler ignore poliment le webhook legacy.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

const { router, paymentsRouter, stripeWebhookHandler } = require('../../routes/collective-workspaces');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/collective-workspaces', router);
  app.post('/api/collective-payments/stripe-webhook', stripeWebhookHandler);
  app.use('/api/collective-payments', paymentsRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('router — endpoints legacy désactivés', () => {
  it('GET / → 410 Gone, sans authentification requise', async () => {
    const res = await request(buildApp()).get('/api/collective-workspaces');
    expect(res.status).toBe(410);
    expect(res.body).toEqual({
      error: 'collective_workspace_disabled',
      message: 'Ce parcours collectif est désactivé. Le panier partagé se crée désormais depuis la boutique.',
      redirect_to: '/boutique',
    });
  });

  it('toute sous-route arbitraire → 410 Gone (catch-all)', async () => {
    const res = await request(buildApp()).get('/api/collective-workspaces/ws-123/items');
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('collective_workspace_disabled');
  });

  it('toute méthode HTTP (POST, PATCH, DELETE) → 410 Gone', async () => {
    const app = buildApp();
    const post = await request(app).post('/api/collective-workspaces').send({ foo: 'bar' });
    const patch = await request(app).patch('/api/collective-workspaces/ws-1');
    const del = await request(app).delete('/api/collective-workspaces/ws-1');
    expect(post.status).toBe(410);
    expect(patch.status).toBe(410);
    expect(del.status).toBe(410);
  });
});

describe('paymentsRouter — endpoints legacy désactivés', () => {
  it('GET / → 410 Gone', async () => {
    const res = await request(buildApp()).get('/api/collective-payments');
    expect(res.status).toBe(410);
    expect(res.body.redirect_to).toBe('/boutique');
  });

  it('sous-route arbitraire → 410 Gone', async () => {
    const res = await request(buildApp()).post('/api/collective-payments/checkout');
    expect(res.status).toBe(410);
  });
});

describe('stripeWebhookHandler', () => {
  it('ignore le webhook et renvoie 410 avec received:true', async () => {
    const res = await request(buildApp()).post('/api/collective-payments/stripe-webhook').send({ type: 'checkout.session.completed' });
    expect(res.status).toBe(410);
    expect(res.body).toEqual({ received: true, ignored: 'collective_workspace_disabled' });
  });

  it('fonctionne meme avec un body vide/malformé (pas de parsing strict)', async () => {
    const res = await request(buildApp()).post('/api/collective-payments/stripe-webhook');
    expect(res.status).toBe(410);
    expect(res.body.received).toBe(true);
  });
});

describe('disabled — exports cohérents', () => {
  it('expose router, paymentsRouter (express.Router) et stripeWebhookHandler (fonction)', () => {
    expect(typeof router).toBe('function');
    expect(typeof paymentsRouter).toBe('function');
    expect(typeof stripeWebhookHandler).toBe('function');
  });
});
