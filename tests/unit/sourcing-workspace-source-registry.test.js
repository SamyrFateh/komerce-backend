'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockListSources = jest.fn();
const mockRequireSource = jest.fn();
const mockRunSourceImportNow = jest.fn();
const mockSetSourceActive = jest.fn();
const mockSetCapability = jest.fn();
const mockHasRuntimeCertification = jest.fn();
const mockRegistryCreate = jest.fn();
const mockRegistryTest = jest.fn();
const mockRegistryRequest = jest.fn();
const mockRegistryList = jest.fn();
const mockRegistryCatalog = jest.fn();
const mockRegistryArchive = jest.fn();
const mockRegistryRestore = jest.fn();
const mockRegistryUpdate = jest.fn();
const mockRegistryUpdateRequest = jest.fn();
const mockRegistryDeleteRequest = jest.fn();

class MockRegistryError extends Error {
  constructor(status, message, code, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/sourcing-analysis', () => ({}));
jest.mock('../../services/sourcing-mutations', () => ({}));
jest.mock('../../services/sourcing-candidate-actions', () => ({}));
jest.mock('../../services/sourcing-import-dispatch', () => ({}));
jest.mock('../../services/sourcing-source-autopilot', () => ({
  listSources: (...args) => mockListSources(...args),
  requireSource: (...args) => mockRequireSource(...args),
  runSourceImportNow: (...args) => mockRunSourceImportNow(...args),
  setSourceActive: (...args) => mockSetSourceActive(...args),
}));
jest.mock('../../services/sourcing-provider-control-policy', () => ({
  setCapability: (...args) => mockSetCapability(...args),
  hasRuntimeCertification: (...args) => mockHasRuntimeCertification(...args),
}));
jest.mock('../../services/sourcing-source-registry', () => ({
  SourceRegistryError: MockRegistryError,
  getCatalog: (...args) => mockRegistryCatalog(...args),
  createSource: (...args) => mockRegistryCreate(...args),
  createConnectorRequest: (...args) => mockRegistryRequest(...args),
  listConnectorRequests: (...args) => mockRegistryList(...args),
  testSourceConnection: (...args) => mockRegistryTest(...args),
  archiveSource: (...args) => mockRegistryArchive(...args),
  restoreSource: (...args) => mockRegistryRestore(...args),
  updateSource: (...args) => mockRegistryUpdate(...args),
  updateConnectorRequest: (...args) => mockRegistryUpdateRequest(...args),
  deleteConnectorRequest: (...args) => mockRegistryDeleteRequest(...args),
}));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({}));
jest.mock('../../services/partner-admin-service', () => ({}));

const workspace = require('../../services/sourcing-workspace');

const READY_SOURCE = Object.freeze({
  source_ref: 'api:cj',
  label: 'CJdropshipping API',
  status: 'active',
  autopilot_enabled: false,
  runtime_enabled: true,
  connector_ready: true,
  discovery_ready: true,
  discovery_enabled: true,
  sync_enabled: true,
  import_enabled: true,
  production_enabled: true,
  production_runtime_certified: true,
  credential_status: 'valid',
});

const project = (overrides) => workspace.projectSourceControl({ ...READY_SOURCE, ...overrides });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('état canonique projeté par le backend', () => {
  test('PRÊTE : certifiée, capacités ON, autopilot OFF', () => {
    expect(project({})).toMatchObject({ state: 'ready', autopilot_ready: true, connection: { verified: true } });
  });

  test('la projection cockpit conserve le contrat d onboarding provider sans secret', () => {
    const onboarding = {
      status: 'defined',
      authority: 'provider_documentation',
      evidence_url: 'https://developers.cjdropshipping.com/en/summary/course.html',
      prerequisites: ['Compte CJ avec accès API'],
      setup_steps: ['Créer ou récupérer la clé API'],
      operator_must_obtain: [{ key: 'api_key', label: 'Clé API CJdropshipping' }],
      operator_must_not_request: ['Mot de passe CJ'],
      completion: 'Renseigner la clé puis tester',
    };
    expect(project({ onboarding_ready: true, onboarding })).toMatchObject({
      onboarding_ready: true,
      onboarding: {
        status: 'defined',
        operator_must_obtain: [{ key: 'api_key', label: 'Clé API CJdropshipping' }],
      },
    });
  });

  test('ACTIVE : autopilot ON et source réellement prête', () => {
    expect(project({ autopilot_enabled: true })).toMatchObject({ state: 'active', autopilot_ready: true });
  });

  test('ON en base mais capacité retirée : BLOQUÉE, jamais ACTIVE', () => {
    expect(project({ autopilot_enabled: true, import_enabled: false })).toMatchObject({ state: 'blocked', autopilot_ready: false });
  });

  test('À CONFIGURER : connecteur non prêt', () => {
    expect(project({ connector_ready: false, connector_reason: 'Connecteur non configuré sur ce serveur', production_runtime_certified: false }))
      .toMatchObject({ state: 'to_configure', autopilot_ready: false, activation_ready: false });
  });

  test('BLOQUÉE : runtime autopilot désactivé ou découverte non prête', () => {
    expect(project({ runtime_enabled: false })).toMatchObject({ state: 'blocked' });
    expect(project({ discovery_ready: false })).toMatchObject({ state: 'blocked' });
  });

  test('ARCHIVÉE : lifecycle inactif, jamais ACTIVE ni activable, même si l’autopilot était ON en base', () => {
    expect(project({ status: 'disabled' })).toMatchObject({ state: 'archived', archived: true, activation_ready: false });
    expect(project({ status: 'disabled', autopilot_enabled: true })).toMatchObject({ state: 'archived', autopilot_ready: false });
    expect(project({ status: 'disabled' }).hard_blockers).toContain('Source inactive');
  });

  test('CONNEXION À TESTER : connecteur prêt, jamais testé, jamais certifié', () => {
    expect(project({ production_runtime_certified: false, discovery_enabled: false, sync_enabled: false, import_enabled: false, production_enabled: false }))
      .toMatchObject({ state: 'connection_to_test', connection: { verified: false, test_status: null } });
  });

  test('un échec de test ne vaut pas connexion vérifiée', () => {
    expect(project({ production_runtime_certified: false, connection_test_status: 'failed', connection_test_code: 'credentials_rejected' }))
      .toMatchObject({ state: 'connection_to_test', connection: { verified: false, test_status: 'failed', test_code: 'credentials_rejected' } });
  });

  test('À CERTIFIER : connexion testée OK mais pas encore certifiée', () => {
    expect(project({ production_runtime_certified: false, connection_test_status: 'ok', discovery_enabled: false }))
      .toMatchObject({ state: 'to_certify', autopilot_ready: false, activation_ready: true });
  });

  test('un test de connexion OK ne remplace jamais la certification : la source n’est pas prête', () => {
    const projected = project({ production_runtime_certified: false, connection_test_status: 'ok' });
    expect(projected.autopilot_ready).toBe(false);
    expect(projected.preparation_required).toContain('Certification runtime');
  });

  test('ERREUR : dernière capture en échec sur une source arrêtée', () => {
    expect(project({ last_capture_status: 'failed', production_runtime_certified: false, connection_test_status: 'ok' }))
      .toMatchObject({ state: 'error' });
  });

  test('une source certifiée est considérée connectée sans test explicite', () => {
    expect(project({ connection_test_status: null }).connection.verified).toBe(true);
  });
});

describe('autorité crédentielle dans la projection (fail-closed)', () => {
  test('sans identifiants : À CONFIGURER, jamais prête ni activable', () => {
    const view = project({ credential_status: 'missing', production_runtime_certified: false, connection_test_status: null });
    expect(view.state).toBe('to_configure');
    expect(view.autopilot_ready).toBe(false);
    expect(view.activation_ready).toBe(false);
    expect(view.hard_blockers).toContain('Identifiants à configurer');
  });

  test('identifiants refusés : BLOQUÉE même si la source était certifiée et active', () => {
    const view = project({ credential_status: 'invalid', autopilot_enabled: true });
    expect(view.state).toBe('blocked');
    expect(view.autopilot_ready).toBe(false);
    expect(view.credential_status).toBe('invalid');
  });

  test('identifiants enregistrés mais non testés : À TESTER, pas prête', () => {
    const view = project({ credential_status: 'untested', production_runtime_certified: false, connection_test_status: null });
    expect(view.state).toBe('connection_to_test');
    expect(view.autopilot_ready).toBe(false);
  });

  test('credential_status absent : traité comme manquant (échec fermé)', () => {
    const { credential_status: _omit, ...legacy } = READY_SOURCE;
    expect(workspace.projectSourceControl(legacy).autopilot_ready).toBe(false);
  });
});

describe('création depuis l’interface', () => {
  test('listSourceControls reflète immédiatement la création, autopilot OFF et à tester', async () => {
    mockRegistryCreate.mockResolvedValue({ source_ref: 'api:cj', created: true });
    const created = {
      source_ref: 'api:cj', label: 'CJdropshipping API', status: 'active', autopilot_enabled: false,
      runtime_enabled: true, connector_ready: true, discovery_ready: true,
      discovery_enabled: false, sync_enabled: false, import_enabled: false, production_enabled: false,
      production_runtime_certified: false, credential_status: 'untested',
    };
    mockListSources.mockResolvedValue([created]);

    const result = await workspace.createSource({ adapter: 'cj' }, { id: 'admin-1', role: 'admin' });

    expect(mockRegistryCreate).toHaveBeenCalledWith({ adapter: 'cj' });
    expect(result.source).toMatchObject({
      source_ref: 'api:cj', state: 'connection_to_test', autopilot_enabled: false,
      capabilities: { discovery: false, sync: false, import: false, production: false },
    });
    expect(result.source.autopilot_ready).toBe(false);
    expect(mockSetCapability).not.toHaveBeenCalled();
    expect(mockRunSourceImportNow).not.toHaveBeenCalled();
    expect(mockSetSourceActive).not.toHaveBeenCalled();

    const controls = await workspace.listSourceControls();
    expect(controls.map((row) => row.source_ref)).toEqual(['api:cj']);
  });

  test('une erreur du registre garde son statut HTTP et son code métier', async () => {
    mockRegistryCreate.mockRejectedValue(new MockRegistryError(409, 'Cette source existe déjà', 'sourcing_source_already_exists', { existing_source_ref: 'api:cj' }));
    await expect(workspace.createSource({ adapter: 'cj' }, {})).rejects.toMatchObject({
      status: 409, code: 'sourcing_source_already_exists', details: { existing_source_ref: 'api:cj' },
    });
  });

  test('autre fournisseur : demande enregistrée, aucune source, aucun autopilot', async () => {
    mockRegistryRequest.mockResolvedValue({ request_ref: 'req-1', status: 'connector_required' });
    const result = await workspace.createSourceRequest({ provider_name: 'BigBuy' }, { id: 'admin-1' });
    expect(result).toMatchObject({ status: 'connector_required' });
    expect(mockListSources).not.toHaveBeenCalled();
    expect(mockSetSourceActive).not.toHaveBeenCalled();
  });

  test('test de connexion : résultat du registre + carte source relue, sans préparation ni activation', async () => {
    mockRegistryTest.mockResolvedValue({ source_ref: 'api:cj', ok: true, code: 'connection_ok', message: 'Connexion valide' });
    mockListSources.mockResolvedValue([{ ...READY_SOURCE, production_runtime_certified: false, connection_test_status: 'ok' }]);

    const result = await workspace.testSourceConnection('api:cj');

    expect(result).toMatchObject({ ok: true, source: { state: 'to_certify', connection: { verified: true } } });
    expect(mockSetCapability).not.toHaveBeenCalled();
    expect(mockRunSourceImportNow).not.toHaveBeenCalled();
    expect(mockSetSourceActive).not.toHaveBeenCalled();
  });
});

describe('préparer et certifier', () => {
  const uncertified = (overrides = {}) => ({
    ...READY_SOURCE,
    discovery_enabled: false, sync_enabled: false, import_enabled: false, production_enabled: false,
    production_runtime_certified: false,
    ...overrides,
  });

  test('refusée tant que la connexion n’a pas été testée', async () => {
    mockListSources.mockResolvedValue([uncertified()]);

    await expect(workspace.prepareSourceForCertification('api:cj', { id: 'admin-1' })).rejects.toMatchObject({
      status: 409, code: 'sourcing_source_connection_untested',
    });
    expect(mockSetCapability).not.toHaveBeenCalled();
    expect(mockRunSourceImportNow).not.toHaveBeenCalled();
  });

  test('connexion OK : autorise Discovery/Sync/Import, certifie via un vrai import, active Production, jamais l’autopilot', async () => {
    mockListSources.mockResolvedValue([uncertified({ connection_test_status: 'ok' })]);
    mockRequireSource.mockResolvedValue({ source_ref: 'api:cj', production_enabled: false, production_certified_capture_id: 'cap-1', production_certified_at: '2026-10-01T00:00:00Z' });
    mockHasRuntimeCertification.mockReturnValueOnce(false);
    mockRunSourceImportNow.mockResolvedValue({ status: 'certified', run_ref: 'KIR-000001', pipeline_status: 'CANONICAL_RESOLVED' });

    const actor = { id: 'admin-1', role: 'admin' };
    const result = await workspace.prepareSourceForCertification('api:cj', actor);

    expect(mockSetCapability.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['api:cj', 'discovery', true], ['api:cj', 'sync', true], ['api:cj', 'import', true], ['api:cj', 'production', true],
    ]);
    expect(mockRunSourceImportNow).toHaveBeenCalledWith('api:cj', { actorId: 'admin-1', reason: 'autopilot_activation_certification' });
    expect(mockSetSourceActive).not.toHaveBeenCalled();
    expect(result).toMatchObject({ source_ref: 'api:cj', prepared: true, autopilot_enabled: false, certification_run: { run_ref: 'KIR-000001' } });
  });

  test('certification incomplète : 409, Production reste OFF, autopilot jamais activé', async () => {
    mockListSources.mockResolvedValue([uncertified({ connection_test_status: 'ok' })]);
    mockRequireSource.mockResolvedValue({ source_ref: 'api:cj', production_enabled: false });
    mockHasRuntimeCertification.mockReturnValue(false);
    mockRunSourceImportNow.mockResolvedValue({ status: 'completed', run_ref: 'KIR-000002', pipeline_status: 'PARTIAL_BLOCKED' });

    await expect(workspace.prepareSourceForCertification('api:cj', { id: 'admin-1' })).rejects.toMatchObject({
      status: 409, code: 'sourcing_source_certification_incomplete',
    });
    expect(mockSetCapability.mock.calls.some((call) => call[1] === 'production')).toBe(false);
    expect(mockSetSourceActive).not.toHaveBeenCalled();
  });

  test('connecteur non prêt : refusée avant toute écriture', async () => {
    mockListSources.mockResolvedValue([uncertified({ connector_ready: false, connector_reason: 'Connecteur non configuré sur ce serveur', connection_test_status: 'ok' })]);

    await expect(workspace.prepareSourceForCertification('api:cj', { id: 'admin-1' })).rejects.toMatchObject({
      status: 409, code: 'sourcing_source_activation_blocked',
    });
    expect(mockSetCapability).not.toHaveBeenCalled();
    expect(mockRunSourceImportNow).not.toHaveBeenCalled();
  });

  test('source inconnue : 404', async () => {
    mockListSources.mockResolvedValue([]);
    await expect(workspace.prepareSourceForCertification('api:ghost', {})).rejects.toMatchObject({ status: 404, code: 'sourcing_source_not_found' });
  });
});

describe('archiver / restaurer / renommer depuis l’interface', () => {
  const ARCHIVED = { ...READY_SOURCE, status: 'disabled' };

  test('archiver : résultat du registre + carte relue en état archivé', async () => {
    mockRegistryArchive.mockResolvedValue({ source_ref: 'api:cj', archived: true, changed: true });
    mockListSources.mockResolvedValue([ARCHIVED]);
    const result = await workspace.archiveSource('api:cj', { id: 3 });
    expect(mockRegistryArchive).toHaveBeenCalledWith('api:cj', { id: 3 });
    expect(result).toMatchObject({ archived: true, source: { source_ref: 'api:cj', state: 'archived' } });
    expect(mockRunSourceImportNow).not.toHaveBeenCalled();
    expect(mockSetSourceActive).not.toHaveBeenCalled();
  });

  test('restaurer : la source revient visible mais jamais active', async () => {
    mockRegistryRestore.mockResolvedValue({ source_ref: 'api:cj', archived: false, changed: true });
    mockListSources.mockResolvedValue([{ ...READY_SOURCE }]);
    const result = await workspace.restoreSource('api:cj', { id: 3 });
    expect(result.source).toMatchObject({ state: 'ready', autopilot_enabled: false });
    expect(mockSetSourceActive).not.toHaveBeenCalled();
  });

  test('renommer : le libellé est relu depuis la source', async () => {
    mockRegistryUpdate.mockResolvedValue({ source_ref: 'api:cj', label: 'CJ principal' });
    mockListSources.mockResolvedValue([{ ...READY_SOURCE, label: 'CJ principal' }]);
    const result = await workspace.updateSource('api:cj', { label: 'CJ principal' });
    expect(result.source.label).toBe('CJ principal');
  });

  test('les erreurs du registre gardent statut HTTP et code', async () => {
    mockRegistryArchive.mockRejectedValue(new MockRegistryError(404, 'Source sourcing introuvable', 'sourcing_source_not_found'));
    await expect(workspace.archiveSource('api:nope')).rejects.toMatchObject({ status: 404, code: 'sourcing_source_not_found' });
    mockRegistryUpdate.mockRejectedValue(new MockRegistryError(400, 'invalide', 'sourcing_source_label_invalid'));
    await expect(workspace.updateSource('api:cj', { label: 'x' })).rejects.toMatchObject({ status: 400 });
  });

  test('demandes : modifier et retirer passent par le registre', async () => {
    mockRegistryUpdateRequest.mockResolvedValue({ request_ref: 'r1', requested_label: 'BigBuy EU' });
    mockRegistryDeleteRequest.mockResolvedValue({ request_ref: 'r1', deleted: true });
    await expect(workspace.updateSourceRequest('r1', { requested_label: 'BigBuy EU' })).resolves.toMatchObject({ requested_label: 'BigBuy EU' });
    await expect(workspace.deleteSourceRequest('r1')).resolves.toEqual({ request_ref: 'r1', deleted: true });
  });
});
