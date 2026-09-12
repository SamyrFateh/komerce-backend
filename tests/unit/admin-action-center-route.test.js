'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const express = require('express');
const request = require('supertest');

let mockUser = { id: 'admin-1', role: 'admin' };
let mockAllowGrant = true;

jest.mock('../../db', () => ({ query: jest.fn() }));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'unauthorized' });
    req.user = mockUser;
    next();
  },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'forbidden' }),
}));

const mockHasGlobalAuthority = jest.fn(() => Promise.resolve(mockAllowGrant));
jest.mock('../../middleware/require-decision-signal-global-authority', () => ({
  hasDecisionSignalGlobalAuthority: (...args) => mockHasGlobalAuthority(...args),
  requireDecisionSignalGlobalAuthority: (req, res, next) => mockAllowGrant ? next() : res.status(403).json({ code: 'decision_signal_global_access_denied' }),
}));

const mockResolveAssignment = jest.fn();
const mockResolveAuthorization = jest.fn();
const mockAudit = jest.fn();
jest.mock('../../services/market-delegation-service', () => ({
  resolveActiveAssignmentByMarketCode: (...args) => mockResolveAssignment(...args),
  resolveAuthorization: (...args) => mockResolveAuthorization(...args),
  audit: (...args) => mockAudit(...args),
}));

const mockWorkspace = {
  buildWorkspace: jest.fn(),
  buildMarketWorkspace: jest.fn(),
  generateSignals: jest.fn(),
  acknowledge: jest.fn(),
  snooze: jest.fn(),
  resolve: jest.fn(),
};
jest.mock('../../services/action-center-workspace', () => mockWorkspace);

const router = require('../../routes/admin-action-center');

const MARKET_AUTHZ = {
  market_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  market_code: 'CM',
  market_name: 'Cameroun',
  currency: 'XAF',
  assignment_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  membership_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
};

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/action-center', router);
  instance.use((err, req, res, next) => res.status(500).json({ error: err.message, code: err.code || null }));
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
  mockAllowGrant = true;
  mockHasGlobalAuthority.mockImplementation(() => Promise.resolve(mockAllowGrant));
  mockResolveAssignment.mockResolvedValue({ ...MARKET_AUTHZ, membership_id: undefined });
  mockResolveAuthorization.mockResolvedValue(MARKET_AUTHZ);
  mockAudit.mockResolvedValue(undefined);
});

test('authenticated admin without explicit global grant is denied on global Action Center', async () => {
  mockAllowGrant = false;
  const res = await request(app()).get('/api/admin/action-center');
  expect(res.status).toBe(403);
  expect(mockWorkspace.buildWorkspace).not.toHaveBeenCalled();
});

test('global GET returns only the global Canonical projection and disables caching', async () => {
  mockWorkspace.buildWorkspace.mockResolvedValue({ scope: { mode: 'global_decision_signals' }, signals: [] });
  const res = await request(app()).get('/api/admin/action-center?family=ops');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(mockWorkspace.buildWorkspace).toHaveBeenCalledWith(expect.objectContaining({ family: 'ops' }));
});

test('browser cannot inject market or internal signal/entity authority', async () => {
  const res = await request(app())
    .post('/api/admin/action-center/generate')
    .send({ market_id: 'uuid-market', entity_id: 'uuid-entity' });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('action_center_internal_authority_forbidden');
});

test('market_operator GET resolves market server-side through dashboard.market.read', async () => {
  mockUser = { id: 'operator-cm', role: 'market_operator' };
  mockWorkspace.buildMarketWorkspace.mockResolvedValue({
    scope: { mode: 'market_decision_signals', market: { code: 'CM', name: 'Cameroun' } }, signals: [],
  });

  const res = await request(app()).get('/api/admin/action-center/market/CM');

  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), {
    userId: 'operator-cm', marketCode: 'CM', requiredCapability: 'dashboard.market.read',
  });
  expect(mockWorkspace.buildMarketWorkspace).toHaveBeenCalledWith(
    { id: MARKET_AUTHZ.market_id, code: 'CM', name: 'Cameroun', currency: 'XAF' },
    expect.any(Object)
  );
  expect(JSON.stringify(res.body)).not.toContain(MARKET_AUTHZ.market_id);
});

test('market lifecycle requires decision_signal.manage, exact market id and writes delegation audit', async () => {
  mockUser = { id: 'operator-cm', role: 'market_operator' };
  mockWorkspace.acknowledge.mockResolvedValue({ signal_ref: 'KSG-000010', status: 'acknowledged' });

  const res = await request(app())
    .post('/api/admin/action-center/market/CM/signals/KSG-000010/acknowledge')
    .send({});

  expect(res.status).toBe(200);
  expect(mockResolveAuthorization).toHaveBeenCalledWith(expect.anything(), {
    userId: 'operator-cm', marketCode: 'CM', requiredCapability: 'decision_signal.manage',
  });
  expect(mockWorkspace.acknowledge).toHaveBeenCalledWith('KSG-000010', MARKET_AUTHZ.market_id);
  expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    actorUserId: 'operator-cm',
    assignmentId: MARKET_AUTHZ.assignment_id,
    membershipId: MARKET_AUTHZ.membership_id,
    capability: 'decision_signal.manage',
    action: 'DECISION_SIGNAL_ACKNOWLEDGED',
  }));
});

test('admin market view still requires explicit global decision-signal authority', async () => {
  mockAllowGrant = false;
  const res = await request(app()).get('/api/admin/action-center/market/CM');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('decision_signal_global_access_denied');
  expect(mockResolveAssignment).not.toHaveBeenCalled();
});

test('market route accepts market code only as route locator, never body/query authority', async () => {
  mockUser = { id: 'operator-cm', role: 'market_operator' };
  const res = await request(app())
    .post('/api/admin/action-center/market/CM/signals/KSG-000010/snooze?market_id=evil')
    .send({ hours: 24 });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('action_center_internal_authority_forbidden');
  expect(mockResolveAuthorization).not.toHaveBeenCalled();
});

test('global acknowledge uses URL signal_ref and NULL market scope by default', async () => {
  mockWorkspace.acknowledge.mockResolvedValue({ signal_ref: 'KSG-000001', status: 'acknowledged' });
  const res = await request(app()).post('/api/admin/action-center/signals/KSG-000001/acknowledge').send({});
  expect(res.status).toBe(200);
  expect(mockWorkspace.acknowledge).toHaveBeenCalledWith('KSG-000001');
  expect(res.body.action).toBe('acknowledge_signal');
});

test('global snooze and resolve delegate with authenticated actor but no browser UUID', async () => {
  mockWorkspace.snooze.mockResolvedValue({ signal_ref: 'KSG-000002', status: 'snoozed' });
  mockWorkspace.resolve.mockResolvedValue({ signal_ref: 'KSG-000002', status: 'resolved' });

  const snooze = await request(app()).post('/api/admin/action-center/signals/KSG-000002/snooze').send({ hours: 24 });
  const resolve = await request(app()).post('/api/admin/action-center/signals/KSG-000002/resolve').send({});

  expect(snooze.status).toBe(200);
  expect(resolve.status).toBe(200);
  expect(mockWorkspace.snooze).toHaveBeenCalledWith('KSG-000002', 24);
  expect(mockWorkspace.resolve).toHaveBeenCalledWith('KSG-000002', mockUser);
});

test('domain errors preserve status and code', async () => {
  mockWorkspace.acknowledge.mockRejectedValue(Object.assign(new Error('Référence signal invalide'), { status: 400, code: 'action_center_signal_ref_invalid' }));
  const res = await request(app()).post('/api/admin/action-center/signals/BAD/acknowledge');
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('action_center_signal_ref_invalid');
});
