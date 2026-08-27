'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const express = require('express');
const request = require('supertest');

let mockUser = { id: 'admin-1', role: 'admin' };
let allowGrant = true;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'unauthorized' });
    req.user = mockUser;
    next();
  },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'forbidden' }),
}));

jest.mock('../../middleware/require-decision-signal-global-authority', () => ({
  requireDecisionSignalGlobalAuthority: (req, res, next) => allowGrant ? next() : res.status(403).json({ code: 'decision_signal_global_access_denied' }),
}));

const mockWorkspace = {
  buildWorkspace: jest.fn(),
  generateSignals: jest.fn(),
  acknowledge: jest.fn(),
  snooze: jest.fn(),
  resolve: jest.fn(),
};
jest.mock('../../services/action-center-workspace', () => mockWorkspace);

const router = require('../../routes/admin-action-center');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/action-center', router);
  instance.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', role: 'admin' };
  allowGrant = true;
});

test('authenticated admin without explicit global grant is denied', async () => {
  allowGrant = false;
  const res = await request(app()).get('/api/admin/action-center');
  expect(res.status).toBe(403);
  expect(mockWorkspace.buildWorkspace).not.toHaveBeenCalled();
});

test('GET returns the Canonical projection and disables caching', async () => {
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

test('acknowledge uses the URL signal_ref only', async () => {
  mockWorkspace.acknowledge.mockResolvedValue({ signal_ref: 'KSG-000001', status: 'acknowledged' });
  const res = await request(app()).post('/api/admin/action-center/signals/KSG-000001/acknowledge').send({});
  expect(res.status).toBe(200);
  expect(mockWorkspace.acknowledge).toHaveBeenCalledWith('KSG-000001');
  expect(res.body.action).toBe('acknowledge_signal');
});

test('snooze and resolve delegate with authenticated actor but no browser UUID', async () => {
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
