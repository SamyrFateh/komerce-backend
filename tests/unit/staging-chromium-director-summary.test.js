'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');

const SCRIPT=path.resolve(__dirname,'../../scripts/recette/summarize-staging-chromium.js');
const SHA='a'.repeat(40);
const identity=(purchase_commitment,supplier_payment)=>({
  login:true,role_agent_hub:true,administration_http:200,board_http:200,
  central_admin_denied:true,browser_navigation:true,
  purchase_commitment,supplier_payment
});
const proof=()=>({
  status:'PASS',changed:false,sha:SHA,stable_sha:true,
  director:identity(true,true),ordinary_agent:identity(false,false),
  total_blocked_writes:0,total_browser_errors:0
});
function summarize(data) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'chromium-director-'));
  try {
    const evidence=path.join(tmp,'test-results/staging-chromium/evidence');
    fs.mkdirSync(evidence,{recursive:true});
    fs.writeFileSync(path.join(evidence,'hub-director-readonly.json'),
      JSON.stringify(data));
    const run=spawnSync(process.execPath,[SCRIPT],{
      cwd:tmp,
      encoding:'utf8',
      env:{...process.env,E2E_CHROMIUM_SPEC_FILTER:'hub-director-readonly',
        E2E_EXPECTED_DEPLOY_SHA:SHA}
    });
    const report=fs.readFileSync(path.join(tmp,'test-results/staging-chromium/rapport.md'),'utf8');
    return {exit:run.status,stdout:run.stdout,report};
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
describe('Hub Director safe Chromium summarizer',()=>{
  test('PASS is reported without requiring navigation edges or findings',()=>{
    const out=summarize(proof());
    expect(out.exit).toBe(0);
    expect(out.report).toContain('Verdict Hub Director: PASS');
    expect(out.report).toContain('E2E metier complet: NOT_PROVEN');
    expect(out.report).not.toContain('password');
  });
  test('a missing director grant fails closed',()=>{
    const p=proof();
    p.director.supplier_payment=false;
    const out=summarize(p);
    expect(out.exit).toBe(2);
    expect(out.report).toContain('Verdict Hub Director: FAIL');
  });
  test('a changed SHA fails closed',()=>{
    const p=proof();
    p.sha='b'.repeat(40);
    const out=summarize(p);
    expect(out.exit).toBe(2);
    expect(out.report).toContain('SHA_MISMATCH');
  });
});
