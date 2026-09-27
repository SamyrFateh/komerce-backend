'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-market-config.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(ROOT, 'features', 'market-delegation.feature.js'), 'utf8');

describe('market-delegation market-config route — static checks', () => {
  test('the route is authenticated and gated by market_config.read, never role-based', () => {
    expect(routeSource).toMatch(/authenticate/);
    expect(routeSource).toMatch(/requireMarketDelegatedCapability\(CAPABILITY/);
    expect(routeSource).toContain(`'market_config.read'`);
    expect(routeSource).not.toMatch(/requireRole\(/);
  });

  test('only name/created_at are exposed in the response — code/currency/minor_unit/is_active stay central', () => {
    expect(routeSource).toMatch(/SELECT name, created_at FROM markets/);
    expect(routeSource).not.toMatch(/rows\[0\]\.currency/);
    expect(routeSource).not.toMatch(/rows\[0\]\.minor_unit/);
    expect(routeSource).not.toMatch(/rows\[0\]\.is_active/);
    expect(routeSource).not.toMatch(/rows\[0\]\.code\b/);
  });

  test('read-only surface — no mutation endpoint', () => {
    expect(routeSource).not.toMatch(/router\.(post|put|delete|patch)/);
  });

  test('mounted exactly once at the composition root and declared in the feature manifest', () => {
    expect(bootstrapSource).toMatch(/const marketDelegationMarketConfigRouter = require\('\.\.\/routes\/market-delegation-market-config'\)/);
    const mounts = bootstrapSource.match(/app\.use\('\/api\/market-delegation', marketDelegationMarketConfigRouter\)/g) || [];
    expect(mounts).toHaveLength(1);
    expect(featureSource).toMatch(/routes\/market-delegation-market-config\.js/);
  });
});

describe('market-delegation market-config route — behavior', () => {
  let mockGranted = true;
  jest.mock('../../middleware/auth', () => ({
    authenticate: (req, res, next) => { req.user = { id: 'mo-1', role: 'market_operator' }; next(); },
  }));
  jest.mock('../../services/market-delegation-service', () => ({
    resolveAuthorization: jest.fn(async (_executor, { marketCode, requiredCapability }) => {
      if (requiredCapability !== 'market_config.read' || !mockGranted) {
        const error = new Error(`Capability ${requiredCapability} requise.`);
        error.code = 'MARKET_CAPABILITY_REQUIRED';
        error.status = 403;
        throw error;
      }
      return { market_id: 'market-cm', market_code: marketCode, assignment_id: 'a1', membership_id: 'm1' };
    }),
    audit: jest.fn(async () => {}),
  }));
  jest.mock('../../db', () => ({ query: jest.fn() }));

  const db = require('../../db');
  const express = require('express');
  const request = require('supertest');
  const router = require('../../routes/market-delegation-market-config');
  function app() { const a = express(); a.use('/api/market-delegation', router); return a; }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGranted = true;
    db.query.mockResolvedValue({ rows: [{ name: 'Comores', created_at: '2026-01-01T00:00:00.000Z' }] });
  });

  test('returns name/created_at when market_config.read is granted', async () => {
    const res = await request(app()).get('/api/market-delegation/markets/CM/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ market_code: 'CM', name: 'Comores', created_at: '2026-01-01T00:00:00.000Z' });
  });

  test('403 when market_config.read is not granted', async () => {
    mockGranted = false;
    const res = await request(app()).get('/api/market-delegation/markets/CM/config');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
    expect(db.query).not.toHaveBeenCalled();
  });

  test('404 when the resolved market row is missing', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app()).get('/api/market-delegation/markets/CM/config');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('market_not_found');
  });
});
