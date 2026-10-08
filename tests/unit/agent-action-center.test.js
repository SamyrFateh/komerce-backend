'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const express = require('express');
const request = require('supertest');

let mockUser = null;
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'unauthorized' });
    req.user = mockUser;
    next();
  },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'forbidden' }),
}));
const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
const mockAck = jest.fn();
const mockSnooze = jest.fn();
jest.mock('../../services/signal-admin-service', () => ({ acknowledgeByRef: (...a) => mockAck(...a), snoozeByRef: (...a) => mockSnooze(...a) }));

const router = require('../../routes/agent-action-center');
const service = require('../../services/action-center-agent-scope');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/agent/action-center', router);
  a.use((err, req, res, next) => res.status(500).json({ error: err.message })); // eslint-disable-line no-unused-vars
  return a;
}

const ROW = { signal_ref: 'KSG-000001', signal_type: 'hub_tension', severity: 'warning', title: 'T', summary: null, recommendation: 'R', owner_role: 'hub', status: 'open', created_at: '2026-10-08', entity_type: 'order', entity_id: 'SECRET', market_id: 'SECRET' };

const HUB_MARKETS = { rows: [{ market_id: 'mk-1' }] };
beforeEach(() => {
  mockQuery.mockReset(); mockAck.mockReset(); mockSnooze.mockReset();
});
function listRows(markets) {
  if (markets) mockQuery.mockResolvedValueOnce(markets);
  mockQuery.mockResolvedValueOnce({ rows: [ROW] }).mockResolvedValueOnce({ rows: [{ total: '1', urgent: '0', warning: '1', info: '0' }] });
}

test('agent_hub : ne voit que les signaux hub de ses marchés rattachés, projection sans identifiants internes', async () => {
  mockUser = { id: 'u1', role: 'agent_hub' };
  listRows(HUB_MARKETS);
  const res = await request(app()).get('/api/agent/action-center');
  expect(res.status).toBe(200);
  expect(mockQuery.mock.calls[1][1]).toEqual([['hub'], null, ['mk-1'], 50, 0]);
  expect(mockQuery.mock.calls[1][0]).toContain('s.market_id = ANY($3::uuid[])');
  expect(res.body.signals[0]).toEqual(expect.objectContaining({ signal_ref: 'KSG-000001', actions: ['acknowledge', 'snooze'] }));
  expect(JSON.stringify(res.body)).not.toContain('SECRET');
  expect(res.headers['cache-control']).toContain('no-store');
});

test('agent_relais : borné à SON relais issu de la session, jamais du navigateur', async () => {
  mockUser = { id: 'u2', role: 'agent_relais', relais_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  listRows();
  const res = await request(app()).get('/api/agent/action-center');
  expect(res.status).toBe(200);
  expect(mockQuery.mock.calls[0][1]).toEqual([['relais'], 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 50, 0]);
  expect(mockQuery.mock.calls[0][0]).toContain('o.relais_id = $2::uuid');
  expect(mockQuery.mock.calls[0][0]).toContain('p.relais_id = $2::uuid');
});

test('agent_relais sans relais rattaché : refus fail-closed, aucune requête', async () => {
  mockUser = { id: 'u3', role: 'agent_relais', relais_id: null };
  const res = await request(app()).get('/api/agent/action-center');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('agent_action_center_relay_scope_missing');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('agent_transitaire : signaux customs uniquement', async () => {
  mockUser = { id: 'u4', role: 'agent_transitaire' };
  listRows(HUB_MARKETS);
  await request(app()).get('/api/agent/action-center?limit=500&offset=-4');
  expect(mockQuery.mock.calls[1][1]).toEqual([['customs'], null, ['mk-1'], 100, 0]);
});

test('hub/transitaire sans marché rattaché : 403 fail-closed, aucun signal lu', async () => {
  mockUser = { id: 'u5', role: 'agent_hub' };
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const res = await request(app()).get('/api/agent/action-center');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('agent_action_center_market_scope_missing');
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('acquitter / reporter via HTTP ; resolve n’existe pas pour les agents', async () => {
  mockUser = { id: 'u2', role: 'agent_relais', relais_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  mockQuery.mockResolvedValue({ rows: [{ signal_ref: 'KSG-000001', status: 'open', market_id: 'mk' }] });
  mockAck.mockResolvedValueOnce({ signal_ref: 'KSG-000001', status: 'acknowledged' });
  const ack = await request(app()).post('/api/agent/action-center/KSG-000001/acknowledge');
  expect(ack.status).toBe(200);
  expect(ack.body.status).toBe('acknowledged');
  mockSnooze.mockResolvedValueOnce({ signal_ref: 'KSG-000001', status: 'snoozed', snoozed_until: 'T' });
  const sn = await request(app()).post('/api/agent/action-center/KSG-000001/snooze').send({ hours: 4 });
  expect(sn.status).toBe(200);
  expect(mockSnooze).toHaveBeenCalledWith('KSG-000001', 4, 'mk');
  expect((await request(app()).post('/api/agent/action-center/KSG-000001/resolve')).status).toBe(404);
  expect((await request(app()).post('/api/agent/action-center/KSG-000001/snooze').send({ hours: 99 })).status).toBe(400);
  expect((await request(app()).post('/api/agent/action-center/KSG-000001/snooze').send({ market_id: 'x' })).status).toBe(400);
});

test('actions : rôles non agents refusés', async () => {
  mockUser = { id: 'a', role: 'admin' };
  expect((await request(app()).post('/api/agent/action-center/KSG-1/acknowledge')).status).toBe(403);
});

test('le navigateur ne peut imposer ni owner_role, ni relais, ni marché', async () => {
  mockUser = { id: 'u2', role: 'agent_relais', relais_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  for (const q of ['owner_role=admin', 'relais_id=x', 'market_code=KM', 'role=admin']) {
    const res = await request(app()).get(`/api/agent/action-center?${q}`);
    expect(res.status).toBe(400);
  }
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rôles hors agents (admin, client, anonyme) refusés ; pas de mutation sur la liste', async () => {
  mockUser = { id: 'a', role: 'admin' };
  expect((await request(app()).get('/api/agent/action-center')).status).toBe(403);
  mockUser = { id: 'c', role: 'client' };
  expect((await request(app()).get('/api/agent/action-center')).status).toBe(403);
  mockUser = null;
  expect((await request(app()).get('/api/agent/action-center')).status).toBe(401);
  mockUser = { id: 'u1', role: 'agent_hub' };
  for (const m of ['post', 'put', 'patch', 'delete']) {
    expect((await request(app())[m]('/api/agent/action-center')).status).toBe(404);
  }
});

test('resolveScope refuse un rôle inconnu', async () => {
  await expect(service.resolveScope({ role: 'finance' })).rejects.toThrow(/Rôle sans accès/);
});
