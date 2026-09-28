'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockSourcingAllowed = true;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'u', role: 'admin' };
    next();
  },
  requireRole: (roles) => (req, res, next) => (
    roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ code: 'role_forbidden' })
  ),
}));

jest.mock('../../middleware/require-sourcing-global-authority', () => ({
  requireSourcingGlobalAuthority: (req, res, next) => (
    mockSourcingAllowed
      ? next()
      : res.status(403).json({ code: 'sourcing_global_access_denied' })
  ),
}));

const mockRuns = {
  getRun: jest.fn(),
  listRuns: jest.fn(),
  getProductTrace: jest.fn(),
};

jest.mock('../../services/import-runtime-runs', () => ({
  getRun: (...args) => mockRuns.getRun(...args),
  listRuns: (...args) => mockRuns.listRuns(...args),
  getProductTrace: (...args) => mockRuns.getProductTrace(...args),
}));

const mockReplay = jest.fn();
jest.mock('../../services/sourcing-workspace', () => ({
  SourcingWorkspaceError: class extends Error {},
  replayImport: (...args) => mockReplay(...args),
}));
jest.mock('../../services/sourcing-catalog-change-observation', () => ({}));
jest.mock('../../services/sourcing-integrity-service', () => ({}));
jest.mock('../../services/sourcing-provider-control-policy', () => ({}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-sourcing-workspace');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/workspaces/sourcing', router);
  return instance;
}

const BASE = '/api/admin/workspaces/sourcing/import-runs';

describe('import runtime run routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSourcingAllowed = true;
  });

  test('récupère un run par business ref', async () => {
    mockRuns.getRun.mockResolvedValue({ run_ref: 'KIR-000001', status: 'RUNNING' });
    const response = await request(app()).get(`${BASE}/KIR-000001`);
    expect(response.status).toBe(200);
    expect(response.body.run_ref).toBe('KIR-000001');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  test('retourne 404 pour un run absent', async () => {
    mockRuns.getRun.mockResolvedValue(null);
    const response = await request(app()).get(`${BASE}/KIR-999999`);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('import_run_not_found');
  });

  test('ref interne / mal formée rejetée sans appel service', async () => {
    const response = await request(app()).get(
      `${BASE}/3f2b6c1e-0000-4000-8000-000000000000`
    );
    expect(response.status).toBe(404);
    expect(mockRuns.getRun).not.toHaveBeenCalled();
  });

  test('liste les runs récents', async () => {
    mockRuns.listRuns.mockResolvedValue([{ run_ref: 'KIR-000002' }]);
    const response = await request(app()).get(BASE);
    expect(response.status).toBe(200);
    expect(response.body.runs).toHaveLength(1);
  });

  test('autorité sourcing globale obligatoire', async () => {
    mockSourcingAllowed = false;
    const response = await request(app()).get(`${BASE}/KIR-000001`);
    expect(response.status).toBe(403);
    expect(mockRuns.getRun).not.toHaveBeenCalled();
  });

  test('replay délègue à la chaîne canonique', async () => {
    mockReplay.mockResolvedValue({ run_ref: 'KIR-000003' });
    const response = await request(app())
      .post(`${BASE}/replay`)
      .send({
        supplier_name: 'AliExpress',
        source_type: 'api',
        supplier_id: 'aliexpress',
      });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, action: 'replay_import' });
    expect(mockReplay).toHaveBeenCalled();
  });
});
