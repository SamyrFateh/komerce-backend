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

const mockRegistry = {
  listLots: jest.fn(),
  getLot: jest.fn(),
};
jest.mock('../../services/import-lot-registry', () => ({
  listLots: (...args) => mockRegistry.listLots(...args),
  getLot: (...args) => mockRegistry.getLot(...args),
}));

const mockReplay = jest.fn();
const mockListSourceControls = jest.fn();
jest.mock('../../services/sourcing-workspace', () => ({
  SourcingWorkspaceError: class extends Error {},
  replayImport: (...args) => mockReplay(...args),
  listSourceControls: (...args) => mockListSourceControls(...args),
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
    mockListSourceControls.mockResolvedValue([]);
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

  test('cockpit agrège registre de lots et détail sélectionné sans calcul client', async () => {
    mockRegistry.listLots.mockResolvedValue([
      { run_ref:'KIR-000004', business_status:'ACTION_REQUIRED', decisions:{ commercial:15 } },
      { run_ref:'KIR-000003', business_status:'CLOSED', decisions:{ commercial:0 } },
    ]);
    mockRuns.getRun.mockResolvedValue({ run_ref:'KIR-000004', status:'COMPLETED' });
    mockListSourceControls.mockResolvedValue([{
      source_ref:'api:aliexpress',
      label:'AliExpress',
      autopilot_enabled:true,
      autopilot_ready:true,
    }]);
    const response = await request(app()).get('/api/admin/workspaces/sourcing/import-cockpit?run=KIR-000004');
    expect(response.status).toBe(200);
    expect(response.body.source_controls).toEqual([
      expect.objectContaining({ source_ref:'api:aliexpress', autopilot_enabled:true, autopilot_ready:true }),
    ]);
    expect(response.body.lots).toHaveLength(2);
    expect(response.body.selected).toMatchObject({
      run_ref:'KIR-000004',
      business:{ business_status:'ACTION_REQUIRED', decisions:{ commercial:15 } },
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  test('cockpit sait ouvrir un ancien KIR hors de la fenêtre récente', async () => {
    mockRegistry.listLots.mockResolvedValue([{ run_ref:'KIR-000004' }]);
    mockRegistry.getLot.mockResolvedValue({ run_ref:'KIR-000001', business_status:'CLOSED' });
    mockRuns.getRun.mockResolvedValue({ run_ref:'KIR-000001', status:'COMPLETED' });
    const response = await request(app()).get('/api/admin/workspaces/sourcing/import-cockpit?run=KIR-000001');
    expect(response.status).toBe(200);
    expect(mockRegistry.getLot).toHaveBeenCalledWith('KIR-000001');
    expect(response.body.selected.business.business_status).toBe('CLOSED');
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
