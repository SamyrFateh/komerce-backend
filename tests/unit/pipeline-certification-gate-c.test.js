'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {REQUIRED_SCENARIOS,PROVIDERS,MODES,certifyGateC}=require('../../services/pipeline-certification-gate-c');
const pass=id=>({id,expected_outcome:'SAFE_DRAFT',actual_outcome:'SAFE_DRAFT',provenance_preserved:true,network_used:false,paid_ai_used:false,state_corrupted:false,duplicate_identity:false,silent_loss:false});
describe('Gate C — E2E_CERTIFIED',()=>{
 test('requires CJ and AliExpress across all six replay/update/resume modes',()=>{expect(PROVIDERS).toEqual(['CJ','AliExpress']);expect(MODES).toHaveLength(6);const o=certifyGateC(REQUIRED_SCENARIOS.map(pass));expect(o).toMatchObject({gate:'E2E_CERTIFIED',pass:true,required:12,missing:[],failed:[]});});
 test('cannot certify with only one provider',()=>{const o=certifyGateC(REQUIRED_SCENARIOS.filter(x=>x.startsWith('cj__')).map(pass));expect(o.pass).toBe(false);expect(o.missing).toHaveLength(6);});
 test('fails on duplicate identity or provenance loss',()=>{const rows=REQUIRED_SCENARIOS.map(pass);rows[0].duplicate_identity=true;rows[1].provenance_preserved=false;const o=certifyGateC(rows);expect(o.pass).toBe(false);expect(o.failed).toHaveLength(2);});
});
