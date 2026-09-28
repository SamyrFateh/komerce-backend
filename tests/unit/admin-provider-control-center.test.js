'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs=require('fs');const path=require('path');
const view=fs.readFileSync(path.join(__dirname,'../../public/dashboards/admin/js/views/ProvidersView.js'),'utf8');
const api=fs.readFileSync(path.join(__dirname,'../../public/dashboards/admin/js/api-client.js'),'utf8');

describe('Provider Control Center operational truth',()=>{
 test('renders backend connector readiness, runtime, capture health and persisted provider capabilities',()=>{
  expect(view).toContain('source.connector_ready');
  expect(view).toContain('source.runtime_enabled');
  expect(view).toContain('source.last_capture_status');
  expect(view).toContain('source.last_capture_at');
  expect(view).toContain('discovery_enabled');
  expect(view).toContain('sync_enabled');
  expect(view).toContain('import_enabled');
  expect(view).toContain('production_enabled');
  expect(view).toContain('source.production_runtime_certified');
  expect(view).toContain('setSourcingSourceCapability');
  expect(view).toContain('setSourcingSourceAutopilot');
 });
 test('capability switches call the canonical persisted authority with an operator reason',()=>{
  expect(api).toContain('function setSourcingSourceCapability');
  expect(api).toContain('/capabilities/');
  expect(api).toContain('{ enabled: Boolean(enabled), reason }');
  expect(view).toContain("data-capability");
  expect(view).toContain("Motif opérateur");
 });
 test('production exposes backend runtime certification truth and remains unavailable before certification',()=>{
  expect(view).toContain("RUNTIME CERTIFIÉ");
  expect(view).toContain("À CERTIFIER");
  expect(view).toContain("lockProduction");
  expect(view).toContain("Import API CANONICAL_RESOLVED requis avant activation Production");
 });
 test('does not present the static scenario manifest as provider runtime certification',()=>{
  expect(view).not.toContain('Contrat pipeline 46 scénarios');
  expect(view).toContain('Production reste refusée tant qu’aucune preuve runtime fournisseur durable n’est disponible');
 });
});
