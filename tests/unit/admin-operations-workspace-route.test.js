'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

let mockGlobalAllowed = false;
let mockUserRole = 'admin';
let mockRelayMarketIds = new Set(['market-cm-id']);
let mockGrantedCapabilities = new Set();

const EXECUTION_CAPS = [
  'execution.order.mark_ordered',
  'execution.distribution.run',
  'execution.parcel.ship',
  'execution.inventory.assign',
  'execution.parcel.receive',
  'execution.parcel.collect',
  'execution.cash.confirm',
];

function grant(capability, marketCode = 'CM') {
  mockGrantedCapabilities.add(`${capability}@${marketCode}`);
}

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

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => mockGlobalAllowed),
}));

const mockResolveAuthorization = jest.fn();
const mockAudit = jest.fn(async () => undefined);
jest.mock('../../services/market-delegation-service', () => ({
  resolveAuthorization: (...args) => mockResolveAuthorization(...args),
  audit: (...args) => mockAudit(...args),
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
    const text = String(sql);
    if (text.includes('FROM markets')) {
      const code = params[0];
      const ids = { CM: 'market-cm-id', CG: 'market-cg-id' };
      return {
        rows: ids[code]
          ? [{ id: ids[code], code, name: `Market ${code}`, currency: 'XAF' }]
          : [],
      };
    }
    if (text.includes('FROM users u') && text.includes('JOIN relais r')) {
      const marketId = params[1];
      return {
        rows: mockRelayMarketIds.has(marketId)
          ? [{ user_id: params[0], relais_id: 'relay-cm', market_id: marketId }]
          : [],
      };
    }
    return { rows: [] };
  }),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-operations-workspace');

const routeSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'routes', 'admin-operations-workspace.js'),
  'utf8'
);

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/workspaces/operations', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGlobalAllowed = false;
  mockUserRole = 'admin';
  mockRelayMarketIds = new Set(['market-cm-id']);
  mockGrantedCapabilities = new Set(['operations.read@CM']);
  for (const capability of EXECUTION_CAPS) grant(capability, 'CM');

  mockResolveAuthorization.mockImplementation(async (_db, { marketCode, requiredCapability }) => {
    if (mockGrantedCapabilities.has(`${requiredCapability}@${marketCode}`)) {
      const marketId = marketCode === 'CM' ? 'market-cm-id' : marketCode === 'CG' ? 'market-cg-id' : `market-${marketCode}-id`;
      return {
        market_id: marketId,
        market_code: marketCode,
        assignment_id: 'assignment-1',
        membership_id: 'membership-1',
      };
    }
    const error = new Error(`Capability ${requiredCapability} requise.`);
    error.code = 'MARKET_CAPABILITY_REQUIRED';
    error.status = 403;
    throw error;
  });

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

test('D3 retire complètement require-market-scope du Workspace Opérations', () => {
  expect(routeSource).not.toMatch(/require\(['"][^'"]*require-market-scope/);
  expect(routeSource).not.toMatch(/\b(?:attachAuthorizedMarkets|requireMarketScope|operator_market_scopes)\b/);
  expect(routeSource).toContain("requireMarketDelegatedCapability('operations.read'");
  expect(routeSource).toContain('forceCapability: true');
});

test('admin lit CM uniquement avec operations.read ou autorité globale explicite', async () => {
  const ok = await request(app()).get('/api/admin/workspaces/operations/market/CM');
  expect(ok.status).toBe(200);
  expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    marketCode: 'CM',
    requiredCapability: 'operations.read',
  }));

  mockGrantedCapabilities.delete('operations.read@CM');
  const denied = await request(app()).get('/api/admin/workspaces/operations/market/CM');
  expect(denied.status).toBe(403);
  expect(denied.body.code).toBe('MARKET_CAPABILITY_REQUIRED');

  mockGlobalAllowed = true;
  const global = await request(app()).get('/api/admin/workspaces/operations/market/CG');
  expect(global.status).toBe(200);
});

test('agent_hub ne tire aucun Market ID de son rôle : operations.read est obligatoire', async () => {
  mockUserRole = 'agent_hub';
  const ok = await request(app()).get('/api/admin/workspaces/operations/market/CM');
  expect(ok.status).toBe(200);

  mockGrantedCapabilities.delete('operations.read@CM');
  const denied = await request(app()).get('/api/admin/workspaces/operations/market/CM');
  expect(denied.status).toBe(403);
  expect(denied.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
});

test('agent_relais lit uniquement le marché de son relais serveur', async () => {
  mockUserRole = 'agent_relais';
  mockGrantedCapabilities.clear();

  const own = await request(app()).get('/api/admin/workspaces/operations/market/CM');
  const cross = await request(app()).get('/api/admin/workspaces/operations/market/CG');

  expect(own.status).toBe(200);
  expect(cross.status).toBe(403);
  expect(cross.body.code).toBe('relay_actor_market_mismatch');
  expect(mockResolveAuthorization).not.toHaveBeenCalled();
});

test('market_operator CM ne peut pas lire CG', async () => {
  mockUserRole = 'market_operator';
  const res = await request(app()).get('/api/admin/workspaces/operations/market/CG');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
});

test('un membre sans rôle opérationnel lit uniquement avec operations.read', async () => {
  mockUserRole = 'client';

  const allowed = await request(app()).get('/api/admin/workspaces/operations/market/CM');
  expect(allowed.status).toBe(200);
  expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    marketCode: 'CM',
    requiredCapability: 'operations.read',
  }));

  mockGrantedCapabilities.delete('operations.read@CM');
  const denied = await request(app()).get('/api/admin/workspaces/operations/market/CM');
  expect(denied.status).toBe(403);
  expect(denied.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
});

test('market_id navigateur est rejeté avant toute autorité', async () => {
  const read = await request(app()).get('/api/admin/workspaces/operations/market/CM?market_id=market-cg-id');
  const act = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/distribution/run')
    .send({ market_id: 'market-cg-id' });

  expect(read.status).toBe(400);
  expect(act.status).toBe(400);
  expect(read.body.code).toBe('client_market_id_forbidden');
  expect(act.body.code).toBe('client_market_id_forbidden');
});

test('admin ne peut muter sans la capability execution exacte', async () => {
  mockGrantedCapabilities.delete('execution.order.mark_ordered@CM');
  const res = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/orders/CMD-CM-001/mark-ordered')
    .send({});

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockMarkOrdered).not.toHaveBeenCalled();
});

test('chaque mutation Hub exige sa capability exacte et audite avant mutation', async () => {
  const mark = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/orders/CMD-CM-001/mark-ordered').send({});
  const distribute = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/distribution/run').send({});
  const ship = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/parcels/PCL-CM-001/ship').send({});
  const assign = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/inventory/items/item-1/assign')
    .send({ parcel_ref: 'PCL-CM-001' });

  expect([mark.status, distribute.status, ship.status, assign.status]).toEqual([200, 200, 200, 200]);
  for (const capability of [
    'execution.order.mark_ordered',
    'execution.distribution.run',
    'execution.parcel.ship',
    'execution.inventory.assign',
  ]) {
    expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      marketCode: 'CM',
      requiredCapability: capability,
    }));
  }
  expect(mockAudit).toHaveBeenCalledTimes(4);
});

test('une execution capability exacte projette le rôle de compatibilité sans modifier users.role', async () => {
  mockUserRole = 'client';
  mockGrantedCapabilities = new Set(['execution.distribution.run@CM']);

  const res = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/distribution/run').send({});

  expect(res.status).toBe(200);
  expect(mockRunDistribution).toHaveBeenCalledTimes(1);
  expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    requiredCapability: 'execution.distribution.run',
    marketCode: 'CM',
  }));
  expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    capability: 'execution.distribution.run',
    action: 'EXECUTION_AUTHORIZED',
  }));
});

test('agent_relais exige capability + rattachement physique au même marché', async () => {
  mockUserRole = 'agent_relais';

  const own = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/orders/CMD-CM-001/confirm-cash').send({});
  expect(own.status).toBe(200);
  expect(mockConfirmCash).toHaveBeenCalledTimes(1);

  mockGrantedCapabilities.add('execution.cash.confirm@CG');
  const cross = await request(app())
    .post('/api/admin/workspaces/operations/market/CG/orders/CMD-CG-001/confirm-cash').send({});
  expect(cross.status).toBe(403);
  expect(cross.body.code).toBe('relay_actor_market_mismatch');
  expect(mockConfirmCash).toHaveBeenCalledTimes(1);
});

test('users.role seul ne bloque ni n accorde une action : seule la capability exacte décide', async () => {
  mockUserRole = 'agent_hub';
  mockGrantedCapabilities = new Set(['execution.cash.confirm@CM']);

  const res = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/orders/CMD-CM-001/confirm-cash').send({});

  expect(res.status).toBe(200);
  expect(mockConfirmCash).toHaveBeenCalledTimes(1);
});

test('market_operator peut consommer une execution capability explicitement déléguée', async () => {
  mockUserRole = 'market_operator';
  const res = await request(app())
    .post('/api/admin/workspaces/operations/market/CM/parcels/PCL-CM-001/ship').send({});

  expect(res.status).toBe(200);
  expect(mockScanParcel).toHaveBeenCalledWith(
    'PCL-CM-001',
    'ship',
    expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
    expect.objectContaining({ role: 'agent_hub' })
  );
});

test('autorité dashboard globale ne donne aucun droit de mutation Opérations', async () => {
  mockGlobalAllowed = true;
  mockGrantedCapabilities.clear();

  const read = await request(app()).get('/api/admin/workspaces/operations/market/CG');
  const act = await request(app())
    .post('/api/admin/workspaces/operations/market/CG/distribution/run').send({});

  expect(read.status).toBe(200);
  expect(act.status).toBe(403);
  expect(act.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockRunDistribution).not.toHaveBeenCalled();
});
