'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockAllowedMarkets = new Set(['market-cm-id']);
let mockGlobalAllowed = false;
let mockRole = 'admin';

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'user-1', role: mockRole }; next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ code: 'role_forbidden' }),
}));

jest.mock('../../middleware/require-market-delegated-role', () => ({
  attachMarketDelegatedRoleFor: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/require-market-delegated-capability', () => ({
  attachAuthorizedMarketsForCapability: capability => (req, res, next) => {
    if (!mockAllowedMarkets.size) {
      return res.status(403).json({ code: 'MARKET_CAPABILITY_REQUIRED', error: `${capability} required` });
    }
    req.authorizedMarkets = new Set(mockAllowedMarkets);
    return next();
  },
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => mockGlobalAllowed),
}));

const mockResolveOrder = jest.fn();
const mockLoadOrder360 = jest.fn();
jest.mock('../../services/order-360', () => ({
  resolveOrder: (...args) => mockResolveOrder(...args),
  loadOrder360: (...args) => mockLoadOrder360(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-order-360');

function app() {
  const instance = express();
  instance.use('/api/admin/entities', router);
  return instance;
}

function resolvedOrder(marketId = 'market-cm-id', code = 'CM') {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    reference: 'CMD-CM-001',
    market_id: marketId,
    market_code: code,
    status: 'confirmed',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAllowedMarkets = new Set(['market-cm-id']);
  mockGlobalAllowed = false;
  mockRole = 'admin';
  mockResolveOrder.mockResolvedValue({ invalid: false, order: resolvedOrder() });
  mockLoadOrder360.mockResolvedValue({
    order: { reference: 'CMD-CM-001', market: { code: 'CM' } },
    summary: { parcels: 1 },
  });
});

test('operations.read CM permet de lire une commande CM après résolution serveur', async () => {
  const res = await request(app()).get('/api/admin/entities/orders/CMD-CM-001');

  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockResolveOrder).toHaveBeenCalledWith('CMD-CM-001');
  expect(mockLoadOrder360).toHaveBeenCalledWith(expect.objectContaining({ market_id: 'market-cm-id' }), { includePurchasing: true });
  expect(JSON.stringify(res.body)).not.toContain('market-cm-id');
});

test('market_operator garde Order 360 mais sans projection Achats admin-only', async () => {
  mockRole = 'market_operator';

  const res = await request(app()).get('/api/admin/entities/orders/CMD-CM-001');

  expect(res.status).toBe(200);
  expect(mockLoadOrder360).toHaveBeenCalledWith(
    expect.objectContaining({ market_id: 'market-cm-id' }),
    { includePurchasing: false }
  );
});

test('operations.read CM ne permet pas de lire une commande CG', async () => {
  mockResolveOrder.mockResolvedValue({ invalid: false, order: resolvedOrder('market-cg-id', 'CG') });

  const res = await request(app()).get('/api/admin/entities/orders/CMD-CG-001');

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockLoadOrder360).not.toHaveBeenCalled();
});

test('autorité globale explicite peut investiguer un autre marché', async () => {
  mockResolveOrder.mockResolvedValue({ invalid: false, order: resolvedOrder('market-cg-id', 'CG') });
  mockGlobalAllowed = true;

  const res = await request(app()).get('/api/admin/entities/orders/CMD-CG-001');

  expect(res.status).toBe(200);
  expect(mockLoadOrder360).toHaveBeenCalled();
});

test('référence invalide et commande absente sont arrêtées avant les facettes', async () => {
  mockResolveOrder.mockResolvedValueOnce({ invalid: true, order: null });
  let res = await request(app()).get('/api/admin/entities/orders/%24%24bad');
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('invalid_order_reference');

  mockResolveOrder.mockResolvedValueOnce({ invalid: false, order: null });
  res = await request(app()).get('/api/admin/entities/orders/CMD-404');
  expect(res.status).toBe(404);
  expect(res.body.code).toBe('order_not_found');
  expect(mockLoadOrder360).not.toHaveBeenCalled();
});

test('commande sans marché est fail-closed pour un opérateur pays', async () => {
  mockResolveOrder.mockResolvedValue({ invalid: false, order: resolvedOrder(null, null) });

  const res = await request(app()).get('/api/admin/entities/orders/CMD-OLD-001');

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('order_market_unresolved');
  expect(mockLoadOrder360).not.toHaveBeenCalled();
});
