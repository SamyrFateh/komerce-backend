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
  getPopulation: jest.fn(),
  listPassages: jest.fn(),
  getRunNeighbors: jest.fn(),
};

jest.mock('../../services/import-runtime-runs', () => ({
  getRun: (...args) => mockRuns.getRun(...args),
  listRuns: (...args) => mockRuns.listRuns(...args),
  getProductTrace: (...args) => mockRuns.getProductTrace(...args),
  getPopulation: (...args) => mockRuns.getPopulation(...args),
  listPassages: (...args) => mockRuns.listPassages(...args),
  getRunNeighbors: (...args) => mockRuns.getRunNeighbors(...args),
  POPULATION_KINDS: ['received', 'ready', 'discarded'],
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
const mockListSourceRequests = jest.fn();
jest.mock('../../services/sourcing-workspace', () => ({
  SourcingWorkspaceError: class extends Error {},
  replayImport: (...args) => mockReplay(...args),
  listSourceControls: (...args) => mockListSourceControls(...args),
  listSourceRequests: (...args) => mockListSourceRequests(...args),
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
    mockListSourceRequests.mockResolvedValue([]);
    mockRuns.getRunNeighbors.mockResolvedValue({ older_ref:null, newer_ref:null });
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

  test('population : les produits qui composent un chiffre du cockpit', async () => {
    mockRuns.getPopulation.mockResolvedValue({ kind: 'ready', total: 12, items: [], unlisted: [] });
    const response = await request(app()).get(`${BASE}/KIR-000001/population?kind=ready`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ kind: 'ready', total: 12 });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(mockRuns.getPopulation).toHaveBeenCalledWith('KIR-000001', 'ready');
  });

  test('objet d’un passage : expose identité produit et trace sans perdre le KIR', async () => {
    mockRuns.getProductTrace.mockResolvedValue({
      run_ref:'KIR-000001',
      supplier_product_id:'SP-1',
      product_name:'Coque test',
      image_url:'https://img.test/coque.jpg',
      canonical_category:'accessoires',
      product_ref:null,
      certification:{ outcome:'ready_for_refinery', sourcing_certified:true, reasons:[] },
      catalogue_status:'scanned',
    });
    const response = await request(app()).get(`${BASE}/KIR-000001/items/SP-1`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      run_ref:'KIR-000001',
      supplier_product_id:'SP-1',
      product_name:'Coque test',
      canonical_category:'accessoires',
    });
    expect(mockRuns.getProductTrace).toHaveBeenCalledWith('KIR-000001', 'SP-1');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  test('population : kind inconnu → 400, run absent → 404, ref mal formée → 404 sans appel', async () => {
    const bad = await request(app()).get(`${BASE}/KIR-000001/population?kind=history`);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('import_population_kind_invalid');
    mockRuns.getPopulation.mockResolvedValue(null);
    expect((await request(app()).get(`${BASE}/KIR-999999/population?kind=received`)).status).toBe(404);
    mockRuns.getPopulation.mockClear();
    expect((await request(app()).get(`${BASE}/not-a-ref/population?kind=received`)).status).toBe(404);
    expect(mockRuns.getPopulation).not.toHaveBeenCalled();
  });

  test('passages : historique Sourcing des runs KIR', async () => {
    mockRuns.listPassages.mockResolvedValue({
      passages:[{ run_ref: 'KIR-000006', certified: 12, handoff_label: 'En attente' }],
      offset:20,
      next_offset:40,
    });
    const response = await request(app()).get('/api/admin/workspaces/sourcing/import-passages?limit=20&offset=20');
    expect(response.status).toBe(200);
    expect(response.body.passages).toHaveLength(1);
    expect(response.body).toMatchObject({ offset:20, next_offset:40 });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(mockRuns.listPassages).toHaveBeenCalledWith({ limit: '20', offset: '20' });
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
    mockRuns.getRunNeighbors.mockResolvedValue({ older_ref:'KIR-000003', newer_ref:'KIR-000005' });
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
    expect(response.body.run_nav).toEqual({ older_ref:'KIR-000003', newer_ref:'KIR-000005' });
    expect(mockRuns.getRunNeighbors).toHaveBeenCalledWith('KIR-000004');
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
