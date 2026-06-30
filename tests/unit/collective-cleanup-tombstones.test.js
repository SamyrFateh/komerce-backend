/**
 * KOMERCE — Tests Unitaires : tombstones collective-cleanup (P0 shared-cart)
 *
 * Couvre les modules démontés du flow collective_workspaces (2026-05-30) :
 * - services/collective-close-order-service.js
 * - services/collective-ready-to-order-orchestrator.js
 * - routes/collective-workspaces.js
 * - routes/baskets.js
 *
 * Objectif : garantir que ces stubs no-op continuent de lever/répondre 410,
 * pour qu'une ré-exposition accidentelle de route ne réintroduise pas
 * silencieusement le flow désactivé (payment_mode='collective' absent de l'enum).
 *
 * Run : npx jest tests/unit/collective-cleanup-tombstones.test.js
 */

'use strict';

describe('services/collective-close-order-service (tombstone)', () => {
  const { createOrderFromReadyWorkspace } = require('../../services/collective-close-order-service');

  test('createOrderFromReadyWorkspace lève collective_workspace_disabled', async () => {
    await expect(createOrderFromReadyWorkspace()).rejects.toThrow('collective_workspace_disabled');
  });

  test('lève même avec des arguments fournis', async () => {
    await expect(createOrderFromReadyWorkspace({ workspaceId: 'ws-1' })).rejects.toThrow(
      'collective_workspace_disabled'
    );
  });
});

describe('services/collective-ready-to-order-orchestrator (tombstone)', () => {
  const {
    markSessionReadyToOrder,
    onPaymentAuthorized,
    confirmCashContribution,
    closeReadyToOrderByCreator,
  } = require('../../services/collective-ready-to-order-orchestrator');

  test.each([
    ['markSessionReadyToOrder', markSessionReadyToOrder],
    ['onPaymentAuthorized', onPaymentAuthorized],
    ['confirmCashContribution', confirmCashContribution],
    ['closeReadyToOrderByCreator', closeReadyToOrderByCreator],
  ])('%s lève collective_workspace_disabled', async (_name, fn) => {
    await expect(fn()).rejects.toThrow('collective_workspace_disabled');
  });
});

describe('routes/collective-workspaces (tombstone)', () => {
  jest.mock('../../utils/logger', () => ({
    child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
  }));

  const express = require('express');
  const request = require('supertest');
  const { router, paymentsRouter, stripeWebhookHandler } = require('../../routes/collective-workspaces');

  function buildApp() {
    const app = express();
    app.use(express.json());
    // stripeWebhookHandler monté sur un chemin distinct car router.use(disabled)
    // intercepterait sinon tout sous-chemin de /api/collective-workspaces.
    app.post('/stripe-webhook-standalone', stripeWebhookHandler);
    app.use('/api/collective-workspaces', router);
    app.use('/api/collective-workspaces/payments', paymentsRouter);
    return app;
  }

  test('router renvoie 410 quelle que soit la méthode/route', async () => {
    const app = buildApp();
    const get = await request(app).get('/api/collective-workspaces/anything');
    const post = await request(app).post('/api/collective-workspaces/anything').send({});

    expect(get.status).toBe(410);
    expect(get.body.error).toBe('collective_workspace_disabled');
    expect(get.body.redirect_to).toBe('/boutique');
    expect(post.status).toBe(410);
  });

  test('paymentsRouter renvoie 410', async () => {
    const res = await request(buildApp()).post('/api/collective-workspaces/payments/anything').send({});
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('collective_workspace_disabled');
  });

  test('stripeWebhookHandler accepte la requête mais ignore le contenu (410, received: true)', async () => {
    const res = await request(buildApp())
      .post('/stripe-webhook-standalone')
      .send({ type: 'payment_intent.succeeded' });

    expect(res.status).toBe(410);
    expect(res.body).toEqual({ received: true, ignored: 'collective_workspace_disabled' });
  });
});

describe('routes/baskets (tombstone)', () => {
  jest.mock('../../utils/logger', () => ({
    child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
  }));

  const express = require('express');
  const request = require('supertest');
  const router = require('../../routes/baskets');

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/baskets', router);
    return app;
  }

  test('toute requête renvoie 410 avec message de migration', async () => {
    const res = await request(buildApp()).get('/api/baskets/123');

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('baskets_disabled');
    expect(res.body.migration).toMatch(/from-basket/);
  });

  test('POST renvoie aussi 410', async () => {
    const res = await request(buildApp()).post('/api/baskets').send({ items: [] });
    expect(res.status).toBe(410);
  });
});
