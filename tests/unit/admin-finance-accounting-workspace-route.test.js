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
    if (!roles.includes(req.user.role)) return res.status(403).json({ code: 'role_forbidden' });
    next();
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
      return res.status(403).json({ code: 'market_scope_denied' });
    }
    next();
  },
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => mockGlobalAllowed),
}));

const mockBuildWorkspace = jest.fn();
const mockCreateDeposit = jest.fn();
const mockVerifyDeposit = jest.fn();
const mockDisputeDeposit = jest.fn();

jest.mock('../../services/finance-accounting-workspace', () => {
  class FinanceAccountingWorkspaceError extends Error {
    constructor(code, message, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    FinanceAccountingWorkspaceError,
    buildWorkspace: (...args) => mockBuildWorkspace(...args),
    createDeposit: (...args) => mockCreateDeposit(...args),
    verifyDeposit: (...args) => mockVerifyDeposit(...args),
    disputeDeposit: (...args) => mockDisputeDeposit(...args),
  };
});

jest.mock('../../utils/logger', () => ({ child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }) }));

jest.mock('../../db', () => ({
  query: jest.fn(async (sql, params) => {
    if (String(sql).includes('FROM markets')) {
      const ids = { CM: 'market-cm-id', CG: 'market-cg-id' };
      const code = params[0];
      return { rows: ids[code] ? [{ id: ids[code], code, name: `Market ${code}`, currency: 'KMF' }] : [] };
    }
    return { rows: [] };
  }),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-finance-accounting-workspace');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/workspaces/accounting', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAllowedMarkets = new Set(['market-cm-id']);
  mockGlobalAllowed = false;
  mockUserRole = 'admin';
  mockBuildWorkspace.mockResolvedValue({
    scope: { code: 'CM', name: 'Market CM', currency: 'KMF' },
    filters: { from: '2026-08-20', to: '2026-08-26', hours: 48 },
    summary: {}, reconciliation: {}, deposits: [], uncollected: [], collections: [], invoices: [],
  });
  mockCreateDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'pending' });
  mockVerifyDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'verified' });
  mockDisputeDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'disputed' });
});

test.each(['admin', 'finance', 'agent_relais'])('%s peut lire la comptabilité de son marché', async role => {
  mockUserRole = role;
  const res = await request(app()).get('/api/admin/workspaces/accounting/market/CM?from=2026-08-20&to=2026-08-26&hours=72');
  expect(res.status).toBe(200);
  expect(mockBuildWorkspace).toHaveBeenCalledWith({
    market: expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
    from: '2026-08-20',
    to: '2026-08-26',
    hours: '72',
  });
});

test('opérateur CM ne peut pas ouvrir CG', async () => {
  const res = await request(app()).get('/api/admin/workspaces/accounting/market/CG');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('market_scope_denied');
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
});

test('autorité dashboard globale entre dans un marché seulement après sélection explicite', async () => {
  mockGlobalAllowed = true;
  const res = await request(app()).get('/api/admin/workspaces/accounting/market/CG');
  expect(res.status).toBe(200);
  expect(mockBuildWorkspace).toHaveBeenCalledWith(expect.objectContaining({
    market: expect.objectContaining({ id: 'market-cg-id', code: 'CG' }),
  }));
});

test('market_id client est rejeté', async () => {
  const res = await request(app()).get('/api/admin/workspaces/accounting/market/CM?market_id=market-cg-id');
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('client_market_id_forbidden');
});

test('agent_relais déclare son propre dépôt sans agent_id client', async () => {
  mockUserRole = 'agent_relais';
  const body = {
    amount_kmf: 15000,
    deposit_method: 'mobile_money',
    period_start: '2026-08-20',
    period_end: '2026-08-26',
  };
  const res = await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits').send(body);
  expect(res.status).toBe(201);
  expect(mockCreateDeposit).toHaveBeenCalledWith(
    body,
    expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
    expect.objectContaining({ id: 'agent_relais-1', role: 'agent_relais' })
  );
});

test('agent_id client est interdit lors de la déclaration', async () => {
  mockUserRole = 'agent_relais';
  const res = await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits').send({
    agent_id: 'other-agent', amount_kmf: 1000, deposit_method: 'bank', period_start: '2026-08-20', period_end: '2026-08-26',
  });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('client_agent_id_forbidden');
  expect(mockCreateDeposit).not.toHaveBeenCalled();
});

test('finance lit mais ne valide ni ne conteste', async () => {
  mockUserRole = 'finance';
  const verify = await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits/KDP-000001/verify').send({});
  const dispute = await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits/KDP-000001/dispute').send({ reason: 'écart' });
  expect(verify.status).toBe(403);
  expect(dispute.status).toBe(403);
  expect(mockVerifyDeposit).not.toHaveBeenCalled();
  expect(mockDisputeDeposit).not.toHaveBeenCalled();
});

test('admin agit avec deposit_ref et jamais UUID navigateur', async () => {
  const verify = await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits/KDP-000001/verify').send({ notes: 'OK' });
  expect(verify.status).toBe(200);
  expect(mockVerifyDeposit).toHaveBeenCalledWith(
    'KDP-000001',
    { notes: 'OK' },
    expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
    expect.objectContaining({ id: 'admin-1', role: 'admin' })
  );
});
