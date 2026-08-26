'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockAllowedMarkets = new Set(['market-cm-id']);
let mockGlobalAllowed = false;
let mockUserRole = 'admin';

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: `${mockUserRole}-1`,
      role: mockUserRole,
      full_name: `${mockUserRole} Test`,
      email: `${mockUserRole}@example.test`,
    };
    next();
  },
  requireRole: roles => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Rôle interdit', code: 'role_forbidden' });
    }
    return next();
  },
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
  mockUserRole = 'admin';
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

test('admin ouvre uniquement le Workspace CM autorisé', async () => {
  const res = await request(app()).get('/api/admin/workspaces/operations/market/CM');

  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockBuildWorkspace).toHaveBeenCalledWith({
    market: expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
  });
});

test.each(['agent_hub', 'agent_relais'])('%s peut lire le Workspace de son marché', async role => {
  mockUserRole = role;

  const res = await request(app()).get('/api/admin/workspaces/operations/market/CM');

  expect(res.status).toBe(200);
  expect(mockBuildWorkspace).toHaveBeenCalledTimes(1);
});

test('un client ne peut jamais entrer dans le Workspace', async () => {
  mockUserRole = 'client';

  const res = await request(app()).get('/api/admin/workspaces/operations/market/CM');

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('role_forbidden');
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
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
    expect.objectContaining({ id: 'admin-1', role: 'admin', full_name: 'admin Test' })
  );
});

test('agent_hub peut commander mais ne peut pas encaisser au relais', async () => {
  mockUserRole = 'agent_hub';

  const hubAction = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/orders/CMD-CM-001/mark-ordered')
    .send({});
  const relayAction = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/orders/CMD-CM-001/confirm-cash')
    .send({});

  expect(hubAction.status).toBe(200);
  expect(relayAction.status).toBe(403);
  expect(mockMarkOrdered).toHaveBeenCalledTimes(1);
  expect(mockConfirmCash).not.toHaveBeenCalled();
});

test('agent_relais peut encaisser mais ne peut pas commander au sourcing', async () => {
  mockUserRole = 'agent_relais';

  const relayAction = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/orders/CMD-CM-001/confirm-cash')
    .send({});
  const hubAction = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/orders/CMD-CM-001/mark-ordered')
    .send({});

  expect(relayAction.status).toBe(200);
  expect(hubAction.status).toBe(403);
  expect(mockConfirmCash).toHaveBeenCalledTimes(1);
  expect(mockMarkOrdered).not.toHaveBeenCalled();
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
