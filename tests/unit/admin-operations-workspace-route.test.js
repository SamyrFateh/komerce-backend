'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockAllowedMarkets = new Set(['market-cm-id']);
let mockGlobalAllowed = false;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: 'admin-1',
      role: 'admin',
      full_name: 'Admin Test',
      email: 'admin@example.test',
    };
    next();
  },
  requireAdmin: (req, res, next) => next(),
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => {
    req.authorizedMarkets = new Set(mockAllowedMarkets);
    next();
  },
  requireMarketScope: getTarget => (req, res, next) => {
    const target = getTarget(req);
    if (!req.authorizedMarkets || !req.authorizedMarkets.has(target)) {
      return res.status(403).json({ error: 'Marché hors périmètre', code: 'market_scope_denied' });
    }
    return next();
  },
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => mockGlobalAllowed),
}));

const mockBuildWorkspace = jest.fn();
const mockMarkOrdered = jest.fn();
const mockRunDistribution = jest.fn();
const mockScanParcel = jest.fn();
const mockConfirmCash = jest.fn();
const mockAssignInventory = jest.fn();

jest.mock('../../services/operations-workspace', () => {
  class OperationsWorkspaceError extends Error {
    constructor(code, message, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    OperationsWorkspaceError,
    buildWorkspace: (...args) => mockBuildWorkspace(...args),
    markOrdered: (...args) => mockMarkOrdered(...args),
    runDistribution: (...args) => mockRunDistribution(...args),
    scanParcel: (...args) => mockScanParcel(...args),
    confirmCash: (...args) => mockConfirmCash(...args),
    assignInventory: (...args) => mockAssignInventory(...args),
  };
});

jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../db', () => ({
  query: jest.fn(async (sql, params) => {
    if (String(sql).includes('FROM markets')) {
      const code = params[0];
      const ids = { CM: 'market-cm-id', CG: 'market-cg-id' };
      return {
        rows: ids[code]
          ? [{ id: ids[code], code, name: `Market ${code}`, currency: 'XAF' }]
          : [],
      };
    }
    return { rows: [] };
  }),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-operations-workspace');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/workspaces/operations', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAllowedMarkets = new Set(['market-cm-id']);
  mockGlobalAllowed = false;
  mockBuildWorkspace.mockResolvedValue({
    scope: { code: 'CM', name: 'Market CM', currency: 'XAF' },
    summary: {},
    queues: { hub: { to_order: [], to_ship: [] }, relay: { cash_pending: [], to_receive: [], to_collect: [] } },
    distribution: { parcels: [], unassigned: [] },
    inventory: { items: [], open_parcels: [] },
  });
  mockMarkOrdered.mockResolvedValue({ reference: 'CMD-CM-001', status: 'ordered' });
  mockRunDistribution.mockResolvedValue({ market: 'CM', attempted: 0, distributed: 0 });
  mockScanParcel.mockResolvedValue({ reference: 'PCL-CM-001', status: 'shipped' });
  mockConfirmCash.mockResolvedValue({ reference: 'CMD-CM-001', payment_status: 'paid' });
  mockAssignInventory.mockResolvedValue({ item_id: 'item-1', parcel_ref: 'PCL-CM-001', assigned: true });
});

test('opérateur CM ouvre uniquement le Workspace CM', async () => {
  const res = await request(app()).get('/api/admin/workspaces/operations/market/CM');

  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockBuildWorkspace).toHaveBeenCalledWith({
    market: expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
  });
});

test('opérateur CM ne peut pas ouvrir CG', async () => {
  const res = await request(app()).get('/api/admin/workspaces/operations/market/CG');

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('market_scope_denied');
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
});

test('autorité globale explicite peut agir après sélection explicite de CG', async () => {
  mockGlobalAllowed = true;

  const res = await request(app()).get('/api/admin/workspaces/operations/market/CG');

  expect(res.status).toBe(200);
  expect(mockBuildWorkspace).toHaveBeenCalledWith({
    market: expect.objectContaining({ id: 'market-cg-id', code: 'CG' }),
  });
});

test('market_id en query est rejeté avant le service', async () => {
  const res = await request(app())
    .get('/api/admin/workspaces/operations/market/CM?market_id=market-cg-id');

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('client_market_id_forbidden');
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
});

test('market_id en body est rejeté avant une mutation', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/distribution/run')
    .send({ market_id: 'market-cg-id' });

  expect(res.status).toBe(400);
  expect(res.body.code).toBe('client_market_id_forbidden');
  expect(mockRunDistribution).not.toHaveBeenCalled();
});

test('mark-ordered reçoit le marché serveur et l acteur authentifié', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/orders/CMD-CM-001/mark-ordered')
    .send({});

  expect(res.status).toBe(200);
  expect(mockMarkOrdered).toHaveBeenCalledWith(
    'CMD-CM-001',
    expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
    expect.objectContaining({ id: 'admin-1', role: 'admin', full_name: 'Admin Test' })
  );
});

test('assign inventory ne reçoit que parcel_ref, jamais market_id', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/inventory/items/item-1/assign')
    .send({ parcel_ref: 'PCL-CM-001' });

  expect(res.status).toBe(200);
  expect(mockAssignInventory).toHaveBeenCalledWith(
    'item-1',
    'PCL-CM-001',
    expect.objectContaining({ id: 'market-cm-id', code: 'CM' })
  );
});
