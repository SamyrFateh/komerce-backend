/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const scripts=[
 'g6-hub-shipment-chromium.js',
 'g6-canonical-forwarder-chromium.js',
 'g6-canonical-customs-chromium.js',
 'g6-canonical-relay-receipt-chromium.js',
 'g6-canonical-client-pickup-chromium.js'
];
describe('G6 five final stage adapters remain staging-only and parse',()=>{
 test.each(scripts)('%s has valid JS and independent fresh-order selector',name=>{
  const src=fs.readFileSync(path.join(root,'scripts/recette',name),'utf8');
  expect(()=>new vm.Script(src,{filename:name})).not.toThrow();
  expect(src).toContain("G6_DYNAMIC_FRESH_ORDER");
  expect(src).toContain('G6_CANONICAL_DB_FINGERPRINT');
  expect(src).toContain('GITHUB_REPOSITORY_OWNER');
  expect(src).toContain("KOMERCE_ENV==='staging'");
 });
 test('shipment blocks historical partial replay in fresh mode',()=>{
  const src=fs.readFileSync(path.join(root,'scripts/recette/g6-hub-shipment-chromium.js'),'utf8');
  expect(src).toContain('G6_DYNAMIC_PARTIAL_SHIPMENT_NEEDS_INDEPENDENT_RECONCILIATION');
 });
 test('workflow allows only an exact owner-selected fresh M01 full trigger',()=>{
  const yaml=fs.readFileSync(path.join(root,'.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml'),'utf8');
  expect(yaml).toContain("[staging-op] g6-dynamic-fresh-full-M01-KM");
  expect(yaml).toContain("github.actor == github.repository_owner");
  expect(yaml).toContain('G6_DYNAMIC_TO_STAGE');
 });
});
