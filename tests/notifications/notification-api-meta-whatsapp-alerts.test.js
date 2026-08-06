/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch
 * @role          notification-routes-tests
 * @domain        notification
 * @layer         test
 * @criticality   medium
 * @inputs        express route fixtures
 * @outputs       jest assertions
 * @depends       routes/notification-api.js, routes/meta-whatsapp.js, routes/alerts.js
 * @used-by       feature-guard, jest
 * @doctrine      notification_non_bloquante, provider_adapter_isole
 * @impact-areas  notifications, alerts, webhooks, tests, governance
 * @version       2026-06
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { full_name: 'Admin Test' }; next(); },
  requireAdmin: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('../../services/alert-engine', () => ({
  getActiveAlerts: jest.fn(),
  runAll: jest.fn(),
  acknowledgeAlert: jest.fn(),
}));

const db = require('../../db');
const AlertEngine = require('../../services/alert-engine');

function appWith(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

describe('notification-api route', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists recent notification logs', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, event: 'payment_confirmed' }] });
    const router = require('../../routes/notification-api');

    const res = await request(appWith(router)).get('/?limit=10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 1, notifications: [{ id: 1, event: 'payment_confirmed' }] });
  });

  test('returns an empty response when notification_log is not deployed yet', async () => {
    db.query.mockRejectedValueOnce({ code: '42P01' });
    const router = require('../../routes/notification-api');

    const res = await request(appWith(router)).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, notifications: [], warning: 'Table notification_log not yet created' });
  });
});

describe('alerts route', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns active alerts', async () => {
    AlertEngine.getActiveAlerts.mockResolvedValueOnce([{ id: 'a1' }]);
    const router = require('../../routes/alerts');

    const res = await request(appWith(router)).get('/?severity=high');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ alerts: [{ id: 'a1' }], total: 1 });
    expect(AlertEngine.getActiveAlerts).toHaveBeenCalledWith({ type: undefined, severity: 'high' });
  });
});

describe('meta-whatsapp webhook route', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...OLD_ENV,
      META_WA_APP_SECRET: 'test-secret',
      META_WA_VERIFY_TOKEN: 'verify-token',
    };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('accepts the Meta verification challenge with the configured token', async () => {
    const router = require('../../routes/meta-whatsapp');

    const res = await request(appWith(router))
      .get('/webhook/meta-whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify-token',
        'hub.challenge': 'challenge-123',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge-123');
  });
});
