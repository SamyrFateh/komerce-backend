'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inspect,RULES,markdown}=require('./business-logic-audit');
test('No ungrounded findings when source absent',()=>{
 const r=inspect({get:()=>'',tracked:[],sha:'fixture'});
 assert.equal(r.issues.length,0);
 assert.equal(r.missing.length,RULES.length);
});
test('Provenance SQL defect only reported when exact source evidence exists',()=>{
 const target=RULES.find(x=>x[0]==='BIZ-001');
 const fake={ [target[4]]:'UPDATE SET data_sources = sourcing_candidates.data_sources || EXCLUDED.data_sources'};
 const r=inspect({get:f=>fake[f]||'',tracked:[target[4]],sha:'fixture'});
 assert.equal(r.issues.length,1);
 assert.equal(r.issues[0].id,'BIZ-001');
 assert.equal(r.issues[0].status,'CODE_CONTRADICTION');
 assert.ok(markdown(r).includes('BIZ-001'));
});
test('All findings carry a traceable source and are never certified as production bugs',()=>{
 const corpus={};
 for (const r of RULES) corpus[r[4]]=(corpus[r[4]]||'')+'\n'+r[5];
 const r=inspect({get:f=>corpus[f]||'',tracked:Object.keys(corpus),sha:'fixture'});
 assert.equal(r.verdict,'NOT_CERTIFICATION');
 assert.equal(r.dataStatus,'NOT_RUN');
 assert.ok(r.issues.length>=7);
 for(const x of r.issues){assert.ok(x.line>=1);assert.ok(x.evidence.includes(RULES.find(r=>r[0]===x.id)[5]));}
});
