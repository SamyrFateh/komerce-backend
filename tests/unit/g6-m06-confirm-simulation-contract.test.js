/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const code=file=>fs.readFileSync(path.join(root,file),'utf8');
describe('M06 G6 supplier-simulation declaration (PO source of truth)',()=>{
 test('only a server-derived G6 buyer scope can authorize simulation in the browser',()=>{
  const grouped=code('services/purchasing-grouped-service.js');
  const ui=code('public/dashboards/canonical/js/purchasing-workspace.js');
  expect(grouped).toContain("NULLIF(to_jsonb(o)->>'simulation_scope','') AS simulation_scope");
  expect(grouped).toContain('simulation_scope: row.simulation_scope || null');
  expect(ui).toContain("activeScopes.size === 1 && activeScopes.has('G6-BUYER')");
  expect(ui).toContain('...(isG6Simulation ? { simulated: true } : {})');
  expect(ui).not.toContain('simulated: true, // unconditional');
 });
 test('the server still refuses G6 without declaration and commercial orders with it',()=>{
  const service=code('services/purchasing-engagement-service.js');
  expect(service).toContain('Boolean(body.simulated) !== isG6');
  expect(service).toContain('G6_SUPPLIER_SIMULATION_DECLARATION_REQUIRED');
  expect(service).toContain("process.env.KOMERCE_ENV !== 'staging'");
  expect(service).toContain("po.trigger_mode === 'auto'");
 });
 test('real M06 Chromium expects simulated=true and preserves origin verification',()=>{
  const chrom=code('scripts/recette/g6-m06-manual-purchase-chromium.js');
  expect(chrom).toContain('body.simulated===true');
  expect(chrom).toContain('G6_M06_MANUAL_PURCHASE_REQUEST_SCOPE_INVALID');
  expect(chrom).toContain('G6_M06_MANUAL_PURCHASE_POSTGRES_READBACK_INVALID');
 });
});
