'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {REQUIRED_SCENARIOS,certifyGateB}=require('../../services/catalog-certification-gate-b');
const pass=id=>({id,expected_outcome:'SAFE_DRAFT',actual_outcome:'SAFE_DRAFT',provenance_preserved:true,network_used:false,paid_ai_used:false,state_corrupted:false,duplicate_identity:false,silent_loss:false});
describe('Gate B — CATALOG_CERTIFIED',()=>{
 test('requires the complete refinery torture inventory',()=>{const o=certifyGateB(REQUIRED_SCENARIOS.map(pass));expect(o).toMatchObject({gate:'CATALOG_CERTIFIED',pass:true,required:16,missing:[],failed:[]});});
 test('fails closed on a missing scenario',()=>{const o=certifyGateB(REQUIRED_SCENARIOS.slice(1).map(pass));expect(o.pass).toBe(false);expect(o.missing).toContain('missing_or_invalid_price');});
 test('fails closed on accidental publication/state corruption',()=>{const rows=REQUIRED_SCENARIOS.map(pass);rows[0].state_corrupted=true;expect(certifyGateB(rows).pass).toBe(false);});
});
