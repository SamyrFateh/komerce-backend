'use strict';
const fs=require('fs');
const path=require('path');
const {GATE_A_VERSION,REQUIRED_SCENARIOS:A}=require('../services/sourcing-certification-gate-a');
const {GATE_B_VERSION,REQUIRED_SCENARIOS:B}=require('../services/catalog-certification-gate-b');
const {GATE_C_VERSION,REQUIRED_SCENARIOS:C,PROVIDERS}=require('../services/pipeline-certification-gate-c');

function fail(message){ console.error('PIPELINE_CERTIFICATION_INVALID: '+message); process.exitCode=1; }
function matrixRealCount(file){
 const text=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 return (text.match(/\|\s*REAL\s*\|/g)||[]).length;
}
const file=path.join(__dirname,'..','config','pipeline-certification-manifest.json');
const m=JSON.parse(fs.readFileSync(file,'utf8'));
const checks=[
 ['A',GATE_A_VERSION,A],['B',GATE_B_VERSION,B],['C',GATE_C_VERSION,C]
];
let total=0;
for(const [key,version,required] of checks){
 const gate=m.gates[key];
 if(!gate){fail('missing gate '+key);continue;}
 if(gate.version!==version) fail(key+' version drift: manifest='+gate.version+' code='+version);
 if(gate.required!==required.length) fail(key+' scenario count drift: manifest='+gate.required+' code='+required.length);
 const real=matrixRealCount(gate.proof_matrix);
 const na=key==='A' ? Object.keys(gate.applicability||{}).filter(id=>gate.applicability[id].current_providers==='not_applicable').length : 0;
 if(real+na!==required.length) fail(key+' proof matrix incomplete: REAL='+real+' N/A='+na+' required='+required.length);
 total+=required.length;
}
if(JSON.stringify(m.gates.C.providers)!==JSON.stringify(PROVIDERS)) fail('Gate C provider set drift');
if(total!==m.total_scenarios) fail('total scenario drift: manifest='+m.total_scenarios+' code='+total);
if(!process.exitCode) console.log(JSON.stringify({contract:m.contract,pass:true,total_scenarios:total,gates:{A:'SOURCING_CERTIFIED',B:'CATALOG_CERTIFIED',C:'E2E_CERTIFIED'}},null,2));
