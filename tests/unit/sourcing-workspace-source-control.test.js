'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockListSources = jest.fn();

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/sourcing-analysis', () => ({}));
jest.mock('../../services/sourcing-mutations', () => ({}));
jest.mock('../../services/sourcing-candidate-actions', () => ({}));
jest.mock('../../services/sourcing-import-dispatch', () => ({}));
jest.mock('../../services/sourcing-source-autopilot', () => ({
  listSources: (...args) => mockListSources(...args),
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

test('switch reste fail-closed quand une preuve production manque', () => {
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
  expect(projected.blocker).toBe('Certification runtime manquante');
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
