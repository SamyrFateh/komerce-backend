'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const manifest=require('../../config/pipeline-certification-manifest.json');
const A=require('../../services/sourcing-certification-gate-a');
const B=require('../../services/catalog-certification-gate-b');
const C=require('../../services/pipeline-certification-gate-c');

describe('pipeline certification machine manifest',()=>{
 test('freezes code versions and the 18+16+12=46 contract',()=>{
  expect(manifest.total_scenarios).toBe(46);
  expect(manifest.gates.A.version).toBe(A.GATE_A_VERSION);
  expect(manifest.gates.B.version).toBe(B.GATE_B_VERSION);
  expect(manifest.gates.C.version).toBe(C.GATE_C_VERSION);
  expect(manifest.gates.A.required).toBe(A.REQUIRED_SCENARIOS.length);
  expect(manifest.gates.B.required).toBe(B.REQUIRED_SCENARIOS.length);
  expect(manifest.gates.C.required).toBe(C.REQUIRED_SCENARIOS.length);
  expect(A.REQUIRED_SCENARIOS.length+B.REQUIRED_SCENARIOS.length+C.REQUIRED_SCENARIOS.length).toBe(46);
 });
 test('does not silently erase the current-provider cursor applicability exception',()=>{
  expect(A.REQUIRED_SCENARIOS).toContain('repeated_cursor');
  expect(manifest.gates.A.applicability.repeated_cursor.current_providers).toBe('not_applicable');
 });
 test('freezes the Gate C provider set',()=>{
  expect(manifest.gates.C.providers).toEqual(C.PROVIDERS);
 });
});
