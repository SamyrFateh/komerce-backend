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

const mockResolveProduct = jest.fn();
const mockLoadProduct360 = jest.fn();
jest.mock('../../services/product-360', () => ({
  normalizeProductRef: value => {
    const ref = String(value || '').trim().toUpperCase();
    return /^KPR-\d{6,}$/.test(ref) ? ref : null;
  },
  resolveProduct: (...args) => mockResolveProduct(...args),
  loadProduct360: (...args) => mockLoadProduct360(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-product-360');

function app() {
  const instance = express();
  instance.use('/api/admin/entities', router);
  return instance;
}

function resolvedProduct() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    product_ref: 'KPR-000123',
    name: 'Golden Elite Pro',
    inventory_model: 'SKU',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAllowedMarkets = new Set(['market-cm-id']);
  mockGlobalAllowed = false;
  mockResolveProduct.mockResolvedValue({ invalid: false, product: resolvedProduct() });
  mockLoadProduct360.mockResolvedValue({
    product: { product_ref: 'KPR-000123', name: 'Golden Elite Pro' },
    scope: { mode: 'market', markets: [{ code: 'CM' }] },
    central: { visibility: 'restricted' },
  });
});

test('opérateur pays lit le produit global mais ses facettes sont market-scoped', async () => {
  const res = await request(app()).get('/api/admin/entities/products/KPR-000123');

  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockResolveProduct).toHaveBeenCalledWith('KPR-000123');
  expect(mockLoadProduct360).toHaveBeenCalledWith(
    expect.objectContaining({ product_ref: 'KPR-000123' }),
    { marketIds: ['market-cm-id'], includeCentral: false }
  );
  expect(JSON.stringify(res.body)).not.toContain('11111111-1111-4111-8111-111111111111');
});

test('aucun marché autorisé ferme la route avant les facettes', async () => {
  mockAllowedMarkets = new Set();

  const res = await request(app()).get('/api/admin/entities/products/KPR-000123');

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('product_market_scope_required');
  expect(mockResolveProduct).not.toHaveBeenCalled();
  expect(mockLoadProduct360).not.toHaveBeenCalled();
});

test('autorité globale explicite ouvre sourcing et audit central', async () => {
  mockGlobalAllowed = true;

  const res = await request(app()).get('/api/admin/entities/products/KPR-000123');

  expect(res.status).toBe(200);
  expect(mockLoadProduct360).toHaveBeenCalledWith(
    expect.objectContaining({ product_ref: 'KPR-000123' }),
    { marketIds: null, includeCentral: true }
  );
});

test('référence invalide est rejetée avant toute résolution DB', async () => {
  const res = await request(app()).get('/api/admin/entities/products/not-a-product');

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('invalid_product_ref');
  expect(mockResolveProduct).not.toHaveBeenCalled();
});

test('produit absent retourne 404 sans charger les facettes', async () => {
  mockResolveProduct.mockResolvedValue({ invalid: false, product: null });

  const res = await request(app()).get('/api/admin/entities/products/KPR-999999');

  expect(res.status).toBe(404);
  expect(res.body.code).toBe('product_not_found');
  expect(mockLoadProduct360).not.toHaveBeenCalled();
});
