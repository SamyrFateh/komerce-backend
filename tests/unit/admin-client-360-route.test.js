'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockAllowedMarkets = new Set(['market-cm-id']);
let mockGlobalAllowed = false;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => next(),
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => {
    req.authorizedMarkets = new Set(mockAllowedMarkets);
    next();
  },
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => mockGlobalAllowed),
}));

const mockNormalizePhone = jest.fn(value => String(value || '').replace(/[\s().-]+/g, ''));
const mockResolveClient = jest.fn();
const mockLoadClient360 = jest.fn();
jest.mock('../../services/client-360', () => ({
  normalizePhone: (...args) => mockNormalizePhone(...args),
  resolveClient: (...args) => mockResolveClient(...args),
  loadClient360: (...args) => mockLoadClient360(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-client-360');

function app() {
  const instance = express();
  instance.use('/api/admin/entities', router);
  return instance;
}

function resolvedClient() {
  return {
    user_id: '11111111-1111-4111-8111-111111111111',
    full_name: 'Client CM',
    normalized_phone: '+2691234567',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAllowedMarkets = new Set(['market-cm-id']);
  mockGlobalAllowed = false;
  mockNormalizePhone.mockImplementation(value => {
    const phone = String(value || '').replace(/[\s().-]+/g, '');
    return /^\+?[0-9]{6,20}$/.test(phone) ? phone : null;
  });
  mockResolveClient.mockResolvedValue({ invalid: false, client: resolvedClient() });
  mockLoadClient360.mockResolvedValue({
    client: { name: 'Client CM', phone: '+2691234567' },
    scope: { mode: 'market', markets: [{ code: 'CM' }] },
    security: { visibility: 'restricted' },
  });
});

test('opérateur CM résout le client uniquement dans son MarketScope', async () => {
  const res = await request(app()).get('/api/admin/entities/clients/%2B2691234567');

  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockResolveClient).toHaveBeenCalledWith('+2691234567', { marketIds: ['market-cm-id'] });
  expect(mockLoadClient360).toHaveBeenCalledWith(
    expect.objectContaining({ normalized_phone: '+2691234567' }),
    { marketIds: ['market-cm-id'], includeSecurity: false }
  );
});

test('client existant uniquement hors périmètre reste indistinguable d’un client absent', async () => {
  mockResolveClient.mockResolvedValue({ invalid: false, client: null });

  const res = await request(app()).get('/api/admin/entities/clients/%2B2425551234');

  expect(res.status).toBe(404);
  expect(res.body.code).toBe('client_not_found');
  expect(mockLoadClient360).not.toHaveBeenCalled();
});

test('autorité globale explicite voit la projection globale et les facettes compte', async () => {
  mockGlobalAllowed = true;

  const res = await request(app()).get('/api/admin/entities/clients/%2B2691234567');

  expect(res.status).toBe(200);
  expect(mockResolveClient).toHaveBeenCalledWith('+2691234567', { marketIds: null });
  expect(mockLoadClient360).toHaveBeenCalledWith(
    expect.any(Object),
    { marketIds: null, includeSecurity: true }
  );
});

test('opérateur sans marché autorisé est refusé avant toute résolution client', async () => {
  mockAllowedMarkets = new Set();

  const res = await request(app()).get('/api/admin/entities/clients/%2B2691234567');

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('client_market_scope_required');
  expect(mockResolveClient).not.toHaveBeenCalled();
  expect(mockLoadClient360).not.toHaveBeenCalled();
});

test('téléphone invalide est refusé avant accès aux données', async () => {
  const res = await request(app()).get('/api/admin/entities/clients/not-a-phone');

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('invalid_client_phone');
  expect(mockResolveClient).not.toHaveBeenCalled();
  expect(mockLoadClient360).not.toHaveBeenCalled();
});
