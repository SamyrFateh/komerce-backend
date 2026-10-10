'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockSourcingAllowed = true;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'central-sourcing', role: 'admin', full_name: 'Central Sourcing' };
    next();
  },
  requireRole: roles => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ code: 'role_forbidden' });
    next();
  },
}));

jest.mock('../../middleware/require-sourcing-global-authority', () => ({
  requireSourcingGlobalAuthority: (req, res, next) => {
    if (!mockSourcingAllowed) return res.status(403).json({ code: 'sourcing_global_access_denied' });
    req.sourcingGlobalAuthority = true;
    next();
  },
}));

const mockCalls = {
  buildWorkspace: jest.fn(),
  buildHealthDashboard: jest.fn(),
  importCatalog: jest.fn(),
  updatePortfolioProduct: jest.fn(),
  updateCandidate: jest.fn(),
  scanCandidate: jest.fn(),
  watchlistCandidate: jest.fn(),
  rejectCandidate: jest.fn(),
  promoteCandidate: jest.fn(),
  runSourceImportNow: jest.fn(),
  activateSourceAutopilot: jest.fn(),
  setSourceAutopilot: jest.fn(),
  createSupplier: jest.fn(),
  updateSupplier: jest.fn(),
  setSupplierActive: jest.fn(),
  recordUnitStockChange: jest.fn(),
  getSourceCatalog: jest.fn(),
  createSource: jest.fn(),
  createSourceRequest: jest.fn(),
  testSourceConnection: jest.fn(),
  prepareSourceForCertification: jest.fn(),
  archiveSource: jest.fn(),
  restoreSource: jest.fn(),
  updateSource: jest.fn(),
  updateSourceRequest: jest.fn(),
  deleteSourceRequest: jest.fn(),
};

jest.mock('../../services/sourcing-workspace', () => ({
  SourcingWorkspaceError: class SourcingWorkspaceError extends Error {},
  buildWorkspace: (...args) => mockCalls.buildWorkspace(...args),
  timed: (timings, label, promise) => Promise.resolve(promise).then((value) => { timings[label] = 1; return value; }),
  importCatalog: (...args) => mockCalls.importCatalog(...args),
  updatePortfolioProduct: (...args) => mockCalls.updatePortfolioProduct(...args),
  updateCandidate: (...args) => mockCalls.updateCandidate(...args),
  scanCandidate: (...args) => mockCalls.scanCandidate(...args),
  watchlistCandidate: (...args) => mockCalls.watchlistCandidate(...args),
  rejectCandidate: (...args) => mockCalls.rejectCandidate(...args),
  promoteCandidate: (...args) => mockCalls.promoteCandidate(...args),
  runSourceImportNow: (...args) => mockCalls.runSourceImportNow(...args),
  activateSourceAutopilot: (...args) => mockCalls.activateSourceAutopilot(...args),
  setSourceAutopilot: (...args) => mockCalls.setSourceAutopilot(...args),
  createSupplier: (...args) => mockCalls.createSupplier(...args),
  updateSupplier: (...args) => mockCalls.updateSupplier(...args),
  setSupplierActive: (...args) => mockCalls.setSupplierActive(...args),
  getSourceCatalog: (...args) => mockCalls.getSourceCatalog(...args),
  createSource: (...args) => mockCalls.createSource(...args),
  createSourceRequest: (...args) => mockCalls.createSourceRequest(...args),
  archiveSource: (...args) => mockCalls.archiveSource(...args),
  restoreSource: (...args) => mockCalls.restoreSource(...args),
  updateSource: (...args) => mockCalls.updateSource(...args),
  updateSourceRequest: (...args) => mockCalls.updateSourceRequest(...args),
  deleteSourceRequest: (...args) => mockCalls.deleteSourceRequest(...args),
  testSourceConnection: (...args) => mockCalls.testSourceConnection(...args),
  prepareSourceForCertification: (...args) => mockCalls.prepareSourceForCertification(...args),
}));

jest.mock('../../services/sourcing-catalog-change-observation', () => ({
  recordUnitStockChange: (...args) => mockCalls.recordUnitStockChange(...args),
}));

jest.mock('../../services/sourcing-integrity-service', () => ({
  buildHealthDashboard: (...args) => mockCalls.buildHealthDashboard(...args),
}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-sourcing-workspace');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/workspaces/sourcing', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSourcingAllowed = true;
  mockCalls.buildWorkspace.mockResolvedValue({ scope: { mode: 'global_sourcing' }, summary: {}, portfolio: {}, imports: [], candidates: [], suppliers: [], sources: [] });
  mockCalls.buildHealthDashboard.mockResolvedValue({
    schema_version: 'sourcing-health-dashboard-v1',
    scope: { mode: 'global_sourcing' },
    state: { global: 'HEALTHY', integrity: 'HEALTHY', performance: 'HEALTHY', blockers: 0, attention: 0 },
  });
  mockCalls.updatePortfolioProduct.mockResolvedValue({ product_ref: 'KPR-000001' });
  mockCalls.scanCandidate.mockResolvedValue({ candidate_ref: 'KSC-000001', state: 'scanned' });
  mockCalls.promoteCandidate.mockResolvedValue({ candidate_ref: 'KSC-000001', product_ref: 'KPR-000002' });
  mockCalls.runSourceImportNow.mockResolvedValue({ source_ref: 'api:cj', run_ref: 'KIR-000001', pipeline_status: 'CANONICAL_RESOLVED' });
  mockCalls.activateSourceAutopilot.mockResolvedValue({ source_ref: 'api:cj', autopilot_enabled: true, prepared: true });
  mockCalls.setSourceAutopilot.mockResolvedValue({ source_ref: 'api:cj', autopilot_enabled: false });
  mockCalls.createSupplier.mockResolvedValue({ partner_ref: 'KPT-000001', name: 'Supplier' });
  mockCalls.recordUnitStockChange.mockResolvedValue({ status: 'recorded', capture_id: 'capture-1', observations: 1, application_status: 'NOT_EVALUATED' });
});

test('grant sourcing ouvre une projection globale incluant la santé canonique', async () => {
  const res = await request(app()).get('/api/admin/workspaces/sourcing');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockCalls.buildWorkspace).toHaveBeenCalledTimes(1);
  expect(mockCalls.buildHealthDashboard).toHaveBeenCalledTimes(1);
  expect(res.body.health).toMatchObject({ schema_version: 'sourcing-health-dashboard-v1', state: { global: 'HEALTHY' } });
  expect(res.headers['server-timing']).toContain('health;dur=');
});

test('role admin seul ne suffit jamais sans grant sourcing', async () => {
  mockSourcingAllowed = false;
  const res = await request(app()).get('/api/admin/workspaces/sourcing');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('sourcing_global_access_denied');
  expect(mockCalls.buildWorkspace).not.toHaveBeenCalled();
  expect(mockCalls.buildHealthDashboard).not.toHaveBeenCalled();
});

test.each([
  ['/api/admin/workspaces/sourcing?market_id=cm', 'get', null, 'sourcing_market_dimension_forbidden'],
  ['/api/admin/workspaces/sourcing/imports', 'post', { marketCode: 'CM' }, 'sourcing_market_dimension_forbidden'],
  ['/api/admin/workspaces/sourcing/imports', 'post', { import_id: 'internal' }, 'sourcing_internal_id_forbidden'],
])('refuse les dimensions d’autorité navigateur', async (url, method, body, code) => {
  const call = request(app())[method](url);
  const res = body ? await call.send(body) : await call;
  expect(res.status).toBe(400);
  expect(res.body.code).toBe(code);
});

test('mutation produit délègue product_ref et acteur authentifié', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/sourcing/products/KPR-000001/update')
    .send({ sourcing_rail: 'A' });
  expect(res.status).toBe(200);
  expect(mockCalls.updatePortfolioProduct).toHaveBeenCalledWith(
    'KPR-000001',
    { sourcing_rail: 'A' },
    expect.objectContaining({ id: 'central-sourcing', role: 'admin' })
  );
});

test('mutation candidat délègue candidate_ref et jamais UUID', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/sourcing/candidates/KSC-000001/scan')
    .send({});
  expect(res.status).toBe(200);
  expect(mockCalls.scanCandidate).toHaveBeenCalledWith('KSC-000001', expect.objectContaining({ id: 'central-sourcing' }));
});

test('import-now délègue la source métier et l’acteur authentifié', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/sourcing/sources/api%3Acj/import-now')
    .send({});
  expect(res.status).toBe(200);
  expect(mockCalls.runSourceImportNow).toHaveBeenCalledWith(
    'api:cj',
    expect.objectContaining({ id: 'central-sourcing', role: 'admin' })
  );
  expect(res.body.action).toBe('import_source_now');
  expect(res.body.result.run_ref).toBe('KIR-000001');
});

test('interrupteur source ON orchestre la préparation avec l’acteur authentifié', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/sourcing/sources/api%3Acj/activate')
    .send({});
  expect(res.status).toBe(200);
  expect(mockCalls.activateSourceAutopilot).toHaveBeenCalledWith(
    'api:cj',
    expect.objectContaining({ id:'central-sourcing', role:'admin' })
  );
  expect(mockCalls.setSourceAutopilot).not.toHaveBeenCalled();
  expect(res.body.action).toBe('activate_source_autopilot');
});

test('interrupteur source OFF coupe directement l’autopilot sans relancer', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/sourcing/sources/api%3Acj/deactivate')
    .send({});
  expect(res.status).toBe(200);
  expect(mockCalls.setSourceAutopilot).toHaveBeenCalledWith('api:cj', false);
  expect(mockCalls.activateSourceAutopilot).not.toHaveBeenCalled();
  expect(res.body.action).toBe('deactivate_source_autopilot');
});

test('création fournisseur reste dans la frontière sourcing', async () => {
  const res = await request(app())
    .post('/api/admin/workspaces/sourcing/suppliers')
    .send({ name: 'Supplier', partner_type: 'sourcing' });
  expect(res.status).toBe(201);
  expect(mockCalls.createSupplier).toHaveBeenCalledWith({ name: 'Supplier', partner_type: 'sourcing' });
});


describe('first Catalog Change Intake observation seam — global Sourcing guard', () => {
  const endpoint = '/api/admin/workspaces/sourcing/sources/api%3Acj/catalog-changes/observe';
  const body = {
    source: { provider: 'cj', account_scope: 'default', source_ref: 'external-product-1' },
    method: 'PULL_EXACT', event_id: 'event-1', observed_at: '2026-09-23T20:00:00Z',
    subject: { product_ref: 'product-1', unit_ref: 'unit-1' },
    facts: { stock_available: { status: 'OBSERVED', value: 0 } },
  };

  test('authorized operator records observation without publishing or applying product updates', async () => {
    const res = await request(app()).post(endpoint).send(body);
    expect(res.status).toBe(201);
    expect(res.body.action).toBe('observe_unit_stock_change');
    expect(res.body.result).toMatchObject({ status: 'recorded', application_status: 'NOT_EVALUATED' });
    expect(mockCalls.recordUnitStockChange).toHaveBeenCalledWith({
      sourceRef: 'api:cj', envelope: body,
    });
    expect(mockCalls.updatePortfolioProduct).not.toHaveBeenCalled();
    expect(mockCalls.promoteCandidate).not.toHaveBeenCalled();
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('global sourcing grant is required before any stock observation is recorded', async () => {
    mockSourcingAllowed = false;
    const res = await request(app()).post(endpoint).send(body);
    expect(res.status).toBe(403);
    expect(mockCalls.recordUnitStockChange).not.toHaveBeenCalled();
  });

  test('backend source error is fail-closed and does not produce a successful observation', async () => {
    mockCalls.recordUnitStockChange.mockRejectedValue(
      Object.assign(new Error('Source non enregistrée'), {
        status: 409, code: 'catalog_change_source_unavailable',
      })
    );
    const res = await request(app()).post(endpoint).send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('catalog_change_source_unavailable');
  });

  test('an exact retry returns 200 with the original capture reference', async () => {
    mockCalls.recordUnitStockChange.mockResolvedValue({
      status: 'already_recorded', capture_id: 'capture-1',
      observations: 1, application_status: 'NOT_EVALUATED',
    });
    const res = await request(app()).post(endpoint).send(body);
    expect(res.status).toBe(200);
    expect(res.body.result.capture_id).toBe('capture-1');
  });
});


describe('registre opérateur des sources', () => {
  const BASE = '/api/admin/workspaces/sourcing/sources';

  test('catalogue : lecture sans cache, exposé tel que fourni par le backend', async () => {
    mockCalls.getSourceCatalog.mockResolvedValue({ connectors: [{ adapter: 'cj', can_create: true }] });
    const res = await request(app()).get(`${BASE}/catalog`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.connectors[0]).toMatchObject({ adapter: 'cj', can_create: true });
  });

  test('création : 201 et action nommée, seul « adapter » est transmis', async () => {
    mockCalls.createSource.mockResolvedValue({ source_ref: 'api:cj', created: true, source: { state: 'connection_to_test', autopilot_enabled: false } });
    const res = await request(app()).post(BASE).send({ adapter: 'cj' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, action: 'create_source', result: { source_ref: 'api:cj', created: true } });
    expect(mockCalls.createSource).toHaveBeenCalledWith({ adapter: 'cj' }, expect.objectContaining({ role: 'admin' }));
    expect(mockCalls.activateSourceAutopilot).not.toHaveBeenCalled();
    expect(mockCalls.runSourceImportNow).not.toHaveBeenCalled();
  });

  test('doublon : 409 avec la source existante, aucun second appel', async () => {
    mockCalls.createSource.mockRejectedValue(Object.assign(new Error('Cette source existe déjà'), {
      status: 409, code: 'sourcing_source_already_exists', details: { existing_source_ref: 'api:cj' },
    }));
    const res = await request(app()).post(BASE).send({ adapter: 'cj' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'sourcing_source_already_exists', details: { existing_source_ref: 'api:cj' } });
  });

  test('les identifiants internes et la dimension marché restent refusés sur les nouvelles routes', async () => {
    const withId = await request(app()).post(BASE).send({ adapter: 'cj', id: 12 });
    expect(withId.status).toBe(400);
    expect(withId.body.code).toBe('sourcing_internal_id_forbidden');
    const withMarket = await request(app()).post(`${BASE}/requests`).send({ provider_name: 'BigBuy', market_id: 3 });
    expect(withMarket.status).toBe(400);
    expect(withMarket.body.code).toBe('sourcing_market_dimension_forbidden');
    expect(mockCalls.createSource).not.toHaveBeenCalled();
    expect(mockCalls.createSourceRequest).not.toHaveBeenCalled();
  });

  test('autre fournisseur : 201 « connecteur requis », la route n’appelle jamais la création de source', async () => {
    mockCalls.createSourceRequest.mockResolvedValue({ request_ref: 'req-1', provider_name: 'BigBuy', status: 'connector_required' });
    const res = await request(app()).post(`${BASE}/requests`).send({ provider_name: 'BigBuy', requested_label: 'BigBuy EU' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ action: 'request_source_connector', result: { status: 'connector_required' } });
    expect(mockCalls.createSource).not.toHaveBeenCalled();
  });

  test('test de connexion : sans cache, résultat sans secret', async () => {
    mockCalls.testSourceConnection.mockResolvedValue({ source_ref: 'api:cj', ok: false, code: 'credentials_rejected', message: 'Le fournisseur a refusé les identifiants.' });
    const res = await request(app()).post(`${BASE}/${encodeURIComponent('api:cj')}/test-connection`).send({});
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(mockCalls.testSourceConnection).toHaveBeenCalledWith('api:cj');
    expect(res.body.result).toMatchObject({ ok: false, code: 'credentials_rejected' });
    expect(JSON.stringify(res.body)).not.toMatch(/token|secret|apiKey|stack/i);
  });

  test('préparation : appelle la préparation, jamais l’activation', async () => {
    mockCalls.prepareSourceForCertification.mockResolvedValue({ source_ref: 'api:cj', prepared: true, autopilot_enabled: false });
    const res = await request(app()).post(`${BASE}/${encodeURIComponent('api:cj')}/prepare`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ action: 'prepare_source', result: { autopilot_enabled: false } });
    expect(mockCalls.prepareSourceForCertification).toHaveBeenCalledWith('api:cj', expect.objectContaining({ role: 'admin' }));
    expect(mockCalls.activateSourceAutopilot).not.toHaveBeenCalled();
    expect(mockCalls.setSourceAutopilot).not.toHaveBeenCalled();
  });

  test('préparation refusée sans test de connexion : 409 propagé', async () => {
    mockCalls.prepareSourceForCertification.mockRejectedValue(Object.assign(new Error('Testez la connexion avant de préparer la source'), {
      status: 409, code: 'sourcing_source_connection_untested',
    }));
    const res = await request(app()).post(`${BASE}/${encodeURIComponent('api:cj')}/prepare`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('sourcing_source_connection_untested');
  });

  test('accès refusé sans grant sourcing global : aucune route du registre n’est atteignable', async () => {
    mockSourcingAllowed = false;
    for (const call of [
      () => request(app()).get(`${BASE}/catalog`),
      () => request(app()).post(BASE).send({ adapter: 'cj' }),
      () => request(app()).post(`${BASE}/requests`).send({ provider_name: 'BigBuy' }),
      () => request(app()).post(`${BASE}/api%3Acj/test-connection`).send({}),
      () => request(app()).post(`${BASE}/api%3Acj/prepare`).send({}),
      () => request(app()).post(`${BASE}/api%3Acj/archive`).send({}),
      () => request(app()).post(`${BASE}/api%3Acj/restore`).send({}),
      () => request(app()).patch(`${BASE}/api%3Acj`).send({ label: 'CJ' }),
      () => request(app()).patch(`${BASE}/requests/r1`).send({ requested_label: 'BigBuy' }),
      () => request(app()).delete(`${BASE}/requests/r1`),
    ]) {
      expect((await call()).status).toBe(403);
    }
    expect(mockCalls.createSource).not.toHaveBeenCalled();
  });
});

describe('routes archivage / mise à jour des sources', () => {
  const BASE = '/api/admin/workspaces/sourcing/sources';
  beforeEach(() => { jest.clearAllMocks(); });

  test('archiver : POST, aucune route DELETE sur une source', async () => {
    mockCalls.archiveSource.mockResolvedValue({ source_ref: 'api:cj', archived: true, changed: true });
    const res = await request(app()).post(`${BASE}/${encodeURIComponent('api:cj')}/archive`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ action: 'archive_source', result: { archived: true } });
    expect(mockCalls.archiveSource).toHaveBeenCalledWith('api:cj', expect.objectContaining({ role: 'admin' }));
    const del = await request(app()).delete(`${BASE}/${encodeURIComponent('api:cj')}`);
    expect(del.status).toBe(404);
  });

  test('restaurer : n’active jamais l’autopilot', async () => {
    mockCalls.restoreSource.mockResolvedValue({ source_ref: 'api:cj', archived: false, changed: true });
    const res = await request(app()).post(`${BASE}/api%3Acj/restore`).send({});
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('restore_source');
    expect(mockCalls.activateSourceAutopilot).not.toHaveBeenCalled();
    expect(mockCalls.setSourceAutopilot).not.toHaveBeenCalled();
  });

  test('renommer : PATCH transmet uniquement le corps à la couche workspace', async () => {
    mockCalls.updateSource.mockResolvedValue({ source_ref: 'api:cj', label: 'CJ principal' });
    const res = await request(app()).patch(`${BASE}/api%3Acj`).send({ label: 'CJ principal' });
    expect(res.status).toBe(200);
    expect(mockCalls.updateSource).toHaveBeenCalledWith('api:cj', { label: 'CJ principal' });
  });

  test('erreur métier : statut et code conservés', async () => {
    mockCalls.archiveSource.mockRejectedValue(Object.assign(new Error('Source sourcing introuvable'), { status: 404, code: 'sourcing_source_not_found' }));
    const res = await request(app()).post(`${BASE}/api%3Anope/archive`).send({});
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'sourcing_source_not_found' });
  });

  test('demandes : PATCH et DELETE sont routés avant /:sourceRef', async () => {
    mockCalls.updateSourceRequest.mockResolvedValue({ request_ref: 'r1', requested_label: 'BigBuy EU' });
    mockCalls.deleteSourceRequest.mockResolvedValue({ request_ref: 'r1', deleted: true });
    const patch = await request(app()).patch(`${BASE}/requests/r1`).send({ requested_label: 'BigBuy EU' });
    expect(patch.body).toMatchObject({ action: 'update_source_request' });
    const del = await request(app()).delete(`${BASE}/requests/r1`);
    expect(del.body).toMatchObject({ action: 'delete_source_request', result: { deleted: true } });
    expect(mockCalls.updateSource).not.toHaveBeenCalled();
    expect(mockCalls.archiveSource).not.toHaveBeenCalled();
  });
});

