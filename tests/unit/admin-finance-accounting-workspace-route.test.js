'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockGlobalAllowed = false;
let mockUserRole = 'admin';
let mockGrantedCapabilities = new Set(['finance.read@CM', 'finance.act@CM']);
let mockRelayMarketIds = new Set(['market-cm-id']);

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
const mockCreateDeposit = jest.fn();
const mockVerifyDeposit = jest.fn();
const mockDisputeDeposit = jest.fn();
const mockResolveActorRelaisInMarket = jest.fn();
const mockCustody = { receiveTransfer: jest.fn(), controlFinal: jest.fn(), reverseReceipt: jest.fn(), decideLoss: jest.fn(), reverseLoss: jest.fn() };

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
    resolveActorRelaisInMarket: (...args) => mockResolveActorRelaisInMarket(...args),
    receiveTransfer: (...args) => mockCustody.receiveTransfer(...args),
    controlFinal: (...args) => mockCustody.controlFinal(...args),
    reverseReceipt: (...args) => mockCustody.reverseReceipt(...args),
    decideLoss: (...args) => mockCustody.decideLoss(...args),
    reverseLoss: (...args) => mockCustody.reverseLoss(...args),
  };
});

jest.mock('../../services/financial-journal-reporting', () => ({
  projection: jest.fn(async () => ({ lines: [], journal_empty: true })),
  listMovements: jest.fn(async () => ({ total: 0, rows: [] })),
  listDocuments: jest.fn(async () => ({ documents: [], missing_documents: [] })),
  reconcileWithSources: jest.fn(async () => ({ ok: true, checks: [] })),
}));

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

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-finance-accounting-workspace');

const routeSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'routes', 'admin-finance-accounting-workspace.js'),
  'utf8'
);

test('D2 retire complètement require-market-scope de Finance et branche les capabilities explicites', () => {
  expect(routeSource).not.toMatch(/require\(['"][^'"]*require-market-scope/);
  expect(routeSource).not.toMatch(/\b(?:attachAuthorizedMarkets|requireMarketScope)\b/);
  expect(routeSource).toContain("requireMarketDelegatedCapability('finance.read'");
  expect(routeSource).toContain("requireMarketDelegatedCapability('finance.act'");
  expect(routeSource).toContain('resolveActorRelaisInMarket');
});

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/workspaces/accounting', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGlobalAllowed = false;
  mockUserRole = 'admin';
  mockGrantedCapabilities = new Set(['finance.read@CM', 'finance.act@CM']);
  mockRelayMarketIds = new Set(['market-cm-id']);

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

  mockResolveActorRelaisInMarket.mockImplementation(async (_actorId, marketId) => {
    if (mockRelayMarketIds.has(marketId)) {
      return { user_id: 'agent_relais-1', relais_id: 'relais-cm', relais_name: 'Relais CM' };
    }
    const err = new Error('Le déclarant doit être affecté à un relais du marché sélectionné');
    err.code = 'deposit_actor_market_mismatch';
    err.status = 403;
    err.name = 'FinanceAccountingWorkspaceError';
    const WorkspaceError = require('../../services/finance-accounting-workspace').FinanceAccountingWorkspaceError;
    throw new WorkspaceError(err.code, err.message, err.status);
  });

  mockBuildWorkspace.mockResolvedValue({
    scope: { code: 'CM', name: 'Market CM', currency: 'KMF' },
    filters: { from: '2026-08-20', to: '2026-08-26', hours: 48 },
    summary: {}, reconciliation: {}, deposits: [], uncollected: [], collections: [], invoices: [],
  });
  mockCreateDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'pending' });
  mockVerifyDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'verified' });
  mockDisputeDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'disputed' });
});

test.each(['admin', 'finance', 'agent_relais', 'market_operator'])('%s peut lire la comptabilité de son marché avec une autorité serveur explicite', async role => {
  mockUserRole = role;
  const res = await request(app()).get('/api/admin/workspaces/accounting/market/CM?from=2026-08-20&to=2026-08-26&hours=72');
  expect(res.status).toBe(200);
  expect(mockBuildWorkspace).toHaveBeenCalledWith({
    market: expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
    from: '2026-08-20',
    to: '2026-08-26',
    hours: '72',
  });
  if (role === 'agent_relais') {
    expect(mockResolveActorRelaisInMarket).toHaveBeenCalledWith('agent_relais-1', 'market-cm-id');
  } else {
    expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      marketCode: 'CM',
      requiredCapability: 'finance.read',
    }));
  }
});

const VERIFY_CM = '/api/admin/workspaces/accounting/market/CM/deposits/KDP-000001/verify';
const DISPUTE_CM = '/api/admin/workspaces/accounting/market/CM/deposits/KDP-000001/dispute';

test('market_operator avec finance.act valide et conteste dans son Market, mais sans cash.custody.receive ne crée pas de remise', async () => {
  mockUserRole = 'market_operator';
  const create = await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits').send({
    amount_kmf: 1000,
    deposit_method: 'bank',
    period_start: '2026-08-20',
    period_end: '2026-08-26',
  });
  const verify = await request(app()).post(VERIFY_CM).send({ notes: 'OK' });
  const dispute = await request(app()).post(DISPUTE_CM).send({ reason: 'écart' });

  expect(create.status).toBe(403);
  expect(verify.status).toBe(200);
  expect(dispute.status).toBe(200);
  expect(mockCreateDeposit).not.toHaveBeenCalled();
  expect(mockVerifyDeposit).toHaveBeenCalledWith('KDP-000001', { notes: 'OK' }, expect.objectContaining({ id: 'market-cm-id', code: 'CM' }), expect.objectContaining({ role: 'market_operator' }));
  expect(mockDisputeDeposit).toHaveBeenCalledWith('KDP-000001', { reason: 'écart' }, expect.objectContaining({ id: 'market-cm-id', code: 'CM' }), expect.anything());
});

test('market_operator sans finance.act, ou sur un autre Market, est refusé avant toute mutation', async () => {
  mockUserRole = 'market_operator';
  mockGrantedCapabilities = new Set(['finance.read@CM']);
  const noAct = await request(app()).post(VERIFY_CM).send({});
  expect(noAct.status).toBe(403);
  expect(noAct.body.code).toBe('MARKET_CAPABILITY_REQUIRED');

  mockGrantedCapabilities = new Set(['finance.read@CM', 'finance.act@CM']);
  const otherMarket = await request(app()).post('/api/admin/workspaces/accounting/market/CG/deposits/KDP-000001/verify').send({});
  const otherDispute = await request(app()).post('/api/admin/workspaces/accounting/market/CG/deposits/KDP-000001/dispute').send({ reason: 'x' });
  expect(otherMarket.status).toBe(403);
  expect(otherDispute.status).toBe(403);
  expect(mockVerifyDeposit).not.toHaveBeenCalled();
  expect(mockDisputeDeposit).not.toHaveBeenCalled();
});

test('révocation de finance.act retire immédiatement le droit de valider', async () => {
  mockUserRole = 'market_operator';
  expect((await request(app()).post(VERIFY_CM).send({})).status).toBe(200);
  mockGrantedCapabilities = new Set(['finance.read@CM']);
  expect((await request(app()).post(VERIFY_CM).send({})).status).toBe(403);
});

test.each(['agent_hub', 'agent_transitaire', 'sourcing', 'support'])('le rôle %s ne valide ni ne conteste, même avec finance.act', async role => {
  mockUserRole = role;
  expect((await request(app()).post(VERIFY_CM).send({})).status).toBe(403);
  expect((await request(app()).post(DISPUTE_CM).send({ reason: 'x' })).status).toBe(403);
  expect(mockVerifyDeposit).not.toHaveBeenCalled();
  expect(mockDisputeDeposit).not.toHaveBeenCalled();
});

test('market_operator CM ne peut pas ouvrir CG', async () => {
  mockUserRole = 'market_operator';
  const res = await request(app()).get('/api/admin/workspaces/accounting/market/CG');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
});

test('révocation de finance.read retire immédiatement la lecture', async () => {
  mockUserRole = 'market_operator';
  mockGrantedCapabilities = new Set(['finance.act@CM']);

  const res = await request(app()).get('/api/admin/workspaces/accounting/market/CM');

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockBuildWorkspace).not.toHaveBeenCalled();
});

test('admin et finance ne tirent aucun droit marché de leur rôle', async () => {
  mockGrantedCapabilities = new Set();
  for (const role of ['admin', 'finance']) {
    mockUserRole = role;
    const res = await request(app()).get('/api/admin/workspaces/accounting/market/CM');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  }
});

test('agent_relais lit uniquement le marché de son relais serveur, sans capability déléguée', async () => {
  mockUserRole = 'agent_relais';
  mockGrantedCapabilities = new Set();

  const own = await request(app()).get('/api/admin/workspaces/accounting/market/CM');
  const cross = await request(app()).get('/api/admin/workspaces/accounting/market/CG');

  expect(own.status).toBe(200);
  expect(cross.status).toBe(403);
  expect(cross.body.code).toBe('deposit_actor_market_mismatch');
  expect(mockResolveAuthorization).not.toHaveBeenCalled();
});

test('autorité dashboard globale est un bypass de lecture explicite, jamais un rôle admin implicite', async () => {
  mockGlobalAllowed = true;
  mockGrantedCapabilities = new Set();
  const res = await request(app()).get('/api/admin/workspaces/accounting/market/CG');
  expect(res.status).toBe(200);
  expect(mockBuildWorkspace).toHaveBeenCalledWith(expect.objectContaining({
    market: expect.objectContaining({ id: 'market-cg-id', code: 'CG' }),
  }));
  expect(mockResolveAuthorization).not.toHaveBeenCalled();
});

test('autorité dashboard globale seule ne valide jamais un dépôt', async () => {
  mockGlobalAllowed = true;
  mockGrantedCapabilities = new Set();
  const res = await request(app())
    .post('/api/admin/workspaces/accounting/market/CM/deposits/KDP-000001/verify')
    .send({});
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockVerifyDeposit).not.toHaveBeenCalled();
});

test('market_id client est rejeté avant toute autorité Finance', async () => {
  const res = await request(app()).get('/api/admin/workspaces/accounting/market/CM?market_id=market-cg-id');
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('client_market_id_forbidden');
});

test('agent_relais déclare son propre dépôt uniquement dans son marché relais', async () => {
  mockUserRole = 'agent_relais';
  const body = {
    amount_kmf: 15000,
    deposit_method: 'mobile_money',
    period_start: '2026-08-20',
    period_end: '2026-08-26',
  };
  const res = await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits').send(body);
  expect(res.status).toBe(201);
  expect(mockResolveActorRelaisInMarket).toHaveBeenCalledWith('agent_relais-1', 'market-cm-id');
  expect(mockCreateDeposit).toHaveBeenCalledWith(
    body,
    expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
    expect.objectContaining({ id: 'agent_relais-1', role: 'agent_relais' })
  );

  const cross = await request(app()).post('/api/admin/workspaces/accounting/market/CG/deposits').send(body);
  expect(cross.status).toBe(403);
  expect(cross.body.code).toBe('deposit_actor_market_mismatch');
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

test('finance lit mais ne valide ni ne conteste même avec finance.act', async () => {
  mockUserRole = 'finance';
  const verify = await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits/KDP-000001/verify').send({});
  const dispute = await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits/KDP-000001/dispute').send({ reason: 'écart' });
  expect(verify.status).toBe(403);
  expect(dispute.status).toBe(403);
  expect(mockVerifyDeposit).not.toHaveBeenCalled();
  expect(mockDisputeDeposit).not.toHaveBeenCalled();
});

test('admin valide avec finance.act sur le marché exact, jamais par son rôle', async () => {
  const verify = await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits/KDP-000001/verify').send({ notes: 'OK' });
  expect(verify.status).toBe(200);
  expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    marketCode: 'CM',
    requiredCapability: 'finance.act',
  }));
  expect(mockVerifyDeposit).toHaveBeenCalledWith(
    'KDP-000001',
    { notes: 'OK' },
    expect.objectContaining({ id: 'market-cm-id', code: 'CM' }),
    expect.objectContaining({ id: 'admin-1', role: 'admin' })
  );
  expect(mockAudit).toHaveBeenCalled();
});

test('admin doté de finance.act sur CM est refusé pour valider un dépôt CG', async () => {
  mockGrantedCapabilities = new Set(['finance.read@CM', 'finance.act@CM']);
  const res = await request(app())
    .post('/api/admin/workspaces/accounting/market/CG/deposits/KDP-000001/verify')
    .send({});
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('MARKET_CAPABILITY_REQUIRED');
  expect(mockVerifyDeposit).not.toHaveBeenCalled();
});

describe('garde des espèces : réception, contrôle indépendant, décisions centrales', () => {
  const BASE = '/api/admin/workspaces/accounting/market/CM/custody';
  beforeEach(() => {
    for (const fn of Object.values(mockCustody)) fn.mockReset().mockResolvedValue({ ok: 1 });
  });

  test('une personne habilitée non-relais déclare une remise (cash.custody.receive sur le Market), jamais sans cette capability', async () => {
    mockUserRole = 'market_operator';
    mockGrantedCapabilities = new Set(['finance.read@CM', 'cash.custody.receive@CM']);
    const res = await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits').send({ destination_id: 'dest-1', declared_amount: 100, declared_currency: 'XAF' });
    expect(res.status).toBe(201);
    expect(mockCreateDeposit).toHaveBeenCalledWith(expect.objectContaining({ destination_id: 'dest-1' }), expect.objectContaining({ code: 'CM' }), expect.objectContaining({ role: 'market_operator' }));
    mockGrantedCapabilities = new Set(['finance.read@CM']);
    expect((await request(app()).post('/api/admin/workspaces/accounting/market/CM/deposits').send({ destination_id: 'dest-1' })).status).toBe(403);
  });

  test('réception / refus : cash.custody.receive requis sur le Market exact, Market serveur, acteur de session', async () => {
    mockUserRole = 'market_operator';
    mockGrantedCapabilities = new Set(['finance.read@CM', 'cash.custody.receive@CM']);
    const ok = await request(app()).post(`${BASE}/KDP-000001/receipt`).send({ outcome: 'received', received_amount: 500, proof_ref: 'REL-1' });
    expect(ok.status).toBe(201);
    expect(mockCustody.receiveTransfer).toHaveBeenCalledWith('KDP-000001', { outcome: 'received', received_amount: 500, proof_ref: 'REL-1' }, expect.objectContaining({ id: 'market-cm-id' }), expect.objectContaining({ id: 'market_operator-1' }));
    const other = await request(app()).post('/api/admin/workspaces/accounting/market/CG/custody/KDP-000001/receipt').send({ outcome: 'refused', reason: 'x' });
    expect(other.status).toBe(403);
    mockGrantedCapabilities = new Set(['finance.read@CM']);
    expect((await request(app()).post(`${BASE}/KDP-000001/receipt`).send({})).status).toBe(403);
    expect(mockCustody.receiveTransfer).toHaveBeenCalledTimes(1);
  });

  test('contrôle final : finance.act sur le Market ET rôle admin / market_operator ; finance seule ne contrôle jamais', async () => {
    mockUserRole = 'market_operator';
    expect((await request(app()).post(`${BASE}/KDP-000001/control`).send({ controlled_kmf: 5 })).status).toBe(201);
    expect(mockCustody.controlFinal).toHaveBeenCalledWith('KDP-000001', { controlled_kmf: 5 }, expect.objectContaining({ code: 'CM' }), expect.objectContaining({ id: 'market_operator-1' }));
    mockUserRole = 'finance';
    expect((await request(app()).post(`${BASE}/KDP-000001/control`).send({})).status).toBe(403);
    mockUserRole = 'market_operator';
    mockGrantedCapabilities = new Set(['finance.read@CM']);
    expect((await request(app()).post(`${BASE}/KDP-000001/control`).send({})).status).toBe(403);
    expect(mockCustody.controlFinal).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['reversal', `${BASE}/KDP-000001/reversal`, 'reverseReceipt'],
    ['perte', `${BASE}/losses`, 'decideLoss'],
    ['contre-écriture de perte', `${BASE}/losses/loss-1/reversal`, 'reverseLoss'],
  ])('décision centrale (%s) : admin + autorité dashboard globale, jamais une délégation de Market', async (_label, url, fn) => {
    mockUserRole = 'admin';
    mockGrantedCapabilities = new Set(['finance.read@CM', 'finance.act@CM', 'cash.custody.receive@CM']);
    mockGlobalAllowed = false;
    const denied = await request(app()).post(url).send({ amount_kmf: 1, reason: 'motif détaillé' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('central_authority_required');
    mockGlobalAllowed = true;
    mockUserRole = 'market_operator';
    expect((await request(app()).post(url).send({})).status).toBe(403);
    mockUserRole = 'admin';
    const ok = await request(app()).post(url).send({ amount_kmf: 1, reason: 'motif détaillé' });
    expect(ok.status).toBe(201);
    expect(mockCustody[fn]).toHaveBeenCalledTimes(1);
  });

  test('une erreur métier de garde est restituée avec son code et son statut', async () => {
    mockUserRole = 'market_operator';
    mockGrantedCapabilities = new Set(['finance.read@CM', 'finance.act@CM']);
    const { FinanceAccountingWorkspaceError } = require('../../services/finance-accounting-workspace');
    mockCustody.controlFinal.mockRejectedValueOnce(new FinanceAccountingWorkspaceError('custody_rule_violation', 'acteur non indépendant', 409));
    const res = await request(app()).post(`${BASE}/KDP-000001/control`).send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'custody_rule_violation' });
    expect(router._test.requireCentralAuthority).toBeInstanceOf(Function);
  });
});

test.each(['summary', 'movements', 'documents', 'reconciliation'])('journal %s : jamais exposé à un agent relais, même lié à son marché', async view => {
  mockUserRole = 'agent_relais';
  const res = await request(app()).get(`/api/admin/workspaces/accounting/market/CM/journal/${view}`);
  expect(res.status).toBe(403);
  expect(res.body.error).toMatch(/journal financier/);
});

test.each(['admin', 'finance'])('journal summary : %s autorisé avec une autorité serveur explicite', async role => {
  mockUserRole = role;
  mockGlobalAllowed = role === 'admin';
  const res = await request(app()).get('/api/admin/workspaces/accounting/market/CM/journal/summary');
  expect(res.status).toBe(200);
  expect(res.body.journal_empty).toBe(true);
});
