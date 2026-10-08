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

const router = require('../../routes/agent-action-center');
const service = require('../../services/action-center-agent-scope');

function app() {
  const a = express();
  a.use('/api/agent/action-center', router);
  a.use((err, req, res, next) => res.status(500).json({ error: err.message })); // eslint-disable-line no-unused-vars
  return a;
}

const ROW = { signal_ref: 'KSG-000001', signal_type: 'hub_tension', severity: 'warning', title: 'T', summary: null, recommendation: 'R', owner_role: 'hub', status: 'open', created_at: '2026-10-08', entity_type: 'order', entity_id: 'SECRET', market_id: 'SECRET' };

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValueOnce({ rows: [ROW] }).mockResolvedValueOnce({ rows: [{ count: '1' }] });
});

test('agent_hub : ne voit que les signaux hub, sans borne relais, projection sans identifiants internes', async () => {
  mockUser = { id: 'u1', role: 'agent_hub' };
  const res = await request(app()).get('/api/agent/action-center');
  expect(res.status).toBe(200);
  expect(mockQuery.mock.calls[0][1]).toEqual([['hub'], null, 50, 0]);
  expect(res.body.signals[0]).toEqual(expect.objectContaining({ signal_ref: 'KSG-000001', actions: [] }));
  expect(JSON.stringify(res.body)).not.toContain('SECRET');
  expect(res.headers['cache-control']).toContain('no-store');
});

test('agent_relais : borné à SON relais issu de la session, jamais du navigateur', async () => {
  mockUser = { id: 'u2', role: 'agent_relais', relais_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const res = await request(app()).get('/api/agent/action-center');
  expect(res.status).toBe(200);
  expect(mockQuery.mock.calls[0][1]).toEqual([['relais'], 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 50, 0]);
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
  await request(app()).get('/api/agent/action-center?limit=500&offset=-4');
  expect(mockQuery.mock.calls[0][1]).toEqual([['customs'], null, 100, 0]);
});

test('le navigateur ne peut imposer ni owner_role, ni relais, ni marché', async () => {
  mockUser = { id: 'u2', role: 'agent_relais', relais_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  for (const q of ['owner_role=admin', 'relais_id=x', 'market_code=KM', 'role=admin']) {
    const res = await request(app()).get(`/api/agent/action-center?${q}`);
    expect(res.status).toBe(400);
  }
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rôles hors agents (admin, client, anonyme) refusés ; aucune méthode mutante', async () => {
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

test('resolveScope refuse un rôle inconnu', () => {
  expect(() => service.resolveScope({ role: 'finance' })).toThrow(/Rôle sans accès/);
});
