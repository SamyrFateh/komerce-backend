'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockListSources = jest.fn();
const mockRequireSource = jest.fn();
const mockRunSourceImportNow = jest.fn();
const mockSetSourceActive = jest.fn();
const mockSetCapability = jest.fn();
const mockHasRuntimeCertification = jest.fn();

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
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({}));
jest.mock('../../services/partner-admin-service', () => ({}));

const workspace = require('../../services/sourcing-workspace');

test('source prête = switch autopilot réellement activable', () => {
  const projected = workspace.projectSourceControl({
    source_ref:'api:aliexpress',
    label:'AliExpress',
    status:'active',
    autopilot_enabled:false,
    runtime_enabled:true,
    connector_ready:true,
    discovery_ready:true,
    discovery_enabled:true,
    sync_enabled:true,
    import_enabled:true,
    production_enabled:true,
    production_runtime_certified:true,
    last_capture_at:'2026-09-29T07:00:00Z',
  });
  expect(projected).toMatchObject({
    source_ref:'api:aliexpress',
    autopilot_enabled:false,
    autopilot_ready:true,
    blocker:null,
    capabilities:{ discovery:true, sync:true, import:true, production:true },
  });
});

test('source sans preuve production reste prépar-able au clic mais pas encore autopilot-ready', () => {
  const projected = workspace.projectSourceControl({
    source_ref:'api:cj',
    label:'CJ',
    status:'active',
    autopilot_enabled:false,
    runtime_enabled:true,
    connector_ready:true,
    discovery_ready:true,
    discovery_enabled:true,
    sync_enabled:true,
    import_enabled:true,
    production_enabled:true,
    production_runtime_certified:false,
  });
  expect(projected.autopilot_ready).toBe(false);
  expect(projected.activation_ready).toBe(true);
  expect(projected.blocker).toBe('Préparation automatique requise');
  expect(projected.preparation_required).toContain('Certification runtime');
});

test('projection cockpit lit seulement les contrôles source nécessaires', async () => {
  mockListSources.mockResolvedValue([{
    source_ref:'api:aliexpress',
    label:'AliExpress',
    status:'active',
    autopilot_enabled:true,
    runtime_enabled:true,
    connector_ready:true,
    discovery_ready:true,
    discovery_enabled:true,
    sync_enabled:true,
    import_enabled:true,
    production_enabled:true,
    production_runtime_certified:true,
  }]);
  const rows = await workspace.listSourceControls();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ label:'AliExpress', autopilot_enabled:true, autopilot_ready:true });
});


test('OFF → ON prépare les capacités, certifie un vrai import puis active Production et autopilot', async () => {
  mockListSources.mockResolvedValue([{
    source_ref:'api:aliexpress',
    label:'AliExpress',
    status:'active',
    autopilot_enabled:false,
    runtime_enabled:true,
    connector_ready:true,
    discovery_ready:true,
    discovery_enabled:false,
    sync_enabled:false,
    import_enabled:false,
    production_enabled:false,
    production_runtime_certified:false,
  }]);
  mockRequireSource.mockResolvedValue({
    source_ref:'api:aliexpress',
    status:'active',
    discovery_enabled:true,
    sync_enabled:true,
    import_enabled:true,
    production_enabled:false,
    production_certified_capture_id:'capture-1',
    production_certified_at:'2026-09-29T09:00:00Z',
  });
  mockHasRuntimeCertification.mockReturnValue(false);
  mockRunSourceImportNow.mockResolvedValue({
    status:'certified',
    source_ref:'api:aliexpress',
    run_ref:'KIR-000005',
    pipeline_status:'CANONICAL_RESOLVED',
  });
  mockSetSourceActive.mockResolvedValue({
    source_ref:'api:aliexpress',
    autopilot_enabled:true,
  });

  const actor = { id:'admin-1', role:'admin' };
  const result = await workspace.activateSourceAutopilot('api:aliexpress', actor);

  expect(mockSetCapability.mock.calls.slice(0,3).map(call => call.slice(0,3))).toEqual([
    ['api:aliexpress','discovery',true],
    ['api:aliexpress','sync',true],
    ['api:aliexpress','import',true],
  ]);
  expect(mockRunSourceImportNow).toHaveBeenCalledWith('api:aliexpress', {
    actorId:'admin-1',
    reason:'autopilot_activation_certification',
  });
  expect(mockSetCapability).toHaveBeenCalledWith(
    'api:aliexpress','production',true,actor,'cockpit_autopilot_activation'
  );
  expect(mockSetSourceActive).toHaveBeenCalledWith('api:aliexpress', true, { runNow:false });
  expect(result).toMatchObject({
    autopilot_enabled:true,
    prepared:true,
    certification_run:{ run_ref:'KIR-000005', status:'certified' },
  });
});

test('un vrai blocker runtime/connecteur garde le switch fail-closed', async () => {
  mockListSources.mockResolvedValue([{
    source_ref:'api:aliexpress',
    label:'AliExpress',
    status:'active',
    autopilot_enabled:false,
    runtime_enabled:true,
    connector_ready:false,
    connector_reason:'Credentials fournisseur absents',
    discovery_ready:true,
  }]);

  await expect(workspace.activateSourceAutopilot('api:aliexpress', { id:'admin-1' }))
    .rejects.toMatchObject({
      status:409,
      code:'sourcing_source_activation_blocked',
      message:'Credentials fournisseur absents',
    });
  expect(mockSetCapability).not.toHaveBeenCalled();
  expect(mockRunSourceImportNow).not.toHaveBeenCalled();
});
