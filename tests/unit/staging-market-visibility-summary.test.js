'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @purpose Fail-closed summary gate for real market-operator staging Chromium.
 */
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');

const script=path.resolve(__dirname,'../../scripts/recette/summarize-staging-chromium.js');
const SHA='a'.repeat(40);
const menu=[
  'control-tower','action-center','flow-commerce','flow-orders','entity-clients',
  'workspace-pricing','workspace-catalog','flow-operations','workspace-shipping',
  'flow-finance','workspace-accounting','live-hub','markets-home',
  'market-autonomy','market-catalog','unsold','admin-users',
  'admin-providers','settings','help-docs'
];
const validProof=()=>({
  result:'PASS',role:'market_operator',version:SHA,finalVersion:SHA,
  loginStatus:200,allowedMarkets:['KM','CM'],
  boardMarkets:['KM'],boardOrderCount:1,
  order360:{status:200,readOnly:true,poCount:1},
  navigation:{
    items:menu,
    visited:Array.from({length:14},(_,i)=>({href:'/admin/example-'+i,http:200,path:'/admin/example-'+i}))
  },
  checkedReads:[{market:'KM',http:200,capability:'operations.read'}],
  unauthorized:[{market:'DJ',status:403}],
  blockedWrites:[],jsErrors:[]
});

function run(proof) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kmrc-market-proof-'));
  try{
    const target=path.join(dir,'test-results/staging-chromium/evidence');
    fs.mkdirSync(target,{recursive:true});
    if(proof)fs.writeFileSync(path.join(target,'market-visibility.json'),JSON.stringify(proof));
    const result=spawnSync(process.execPath,[script],{
      cwd:dir,env:{...process.env,E2E_CHROMIUM_SPEC_FILTER:'market-visibility',
        E2E_EXPECTED_DEPLOY_SHA:SHA},
      encoding:'utf8',timeout:6000
    });
    const reportFile=path.join(dir,'test-results/staging-chromium/rapport.md');
    const summaryFile=path.join(dir,'test-results/staging-chromium/market-visibility-summary.json');
    return {
      exit:result.status,stderr:result.stderr,
      report:fs.existsSync(reportFile)?fs.readFileSync(reportFile,'utf8'):'',
      summary:fs.existsSync(summaryFile)?JSON.parse(fs.readFileSync(summaryFile,'utf8')):null
    };
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('PASS uniquement pour une preuve complète, stable, scoped et sans écriture',()=>{
  const result=run(validProof());
  expect(result.exit).toBe(0);
  expect(result.summary).toMatchObject({status:'PASS',menu_items:20,
    checks:{sha:true,login:true,role:true,menu:true,market_scope:true,order360:true,zero_errors:true}});
  expect(result.report).toContain('Verdict: PASS');
});

test.each([
  ['un menu incomplet',proof=>proof.navigation.items.pop()],
  ['une destination non ouverte',proof=>proof.navigation.visited[0].http=403],
  ['une fuite inter-marchés',proof=>proof.boardMarkets.push('DJ')],
  ['un achat modifiable',proof=>proof.order360.readOnly=false],
  ['une session perdue',proof=>proof.navigation.visited[0].path='/login.html'],
  ['un SHA dérivant',proof=>proof.finalVersion='b'.repeat(40)],
  ['un refus de marché absent',proof=>proof.unauthorized=[]],
  ['une ecriture détectée',proof=>proof.blockedWrites.push('POST /api/hub/something')],
])('%s : doit rester FAIL',(name,breakProof)=>{
  const proof=validProof();
  breakProof(proof);
  const result=run(proof);
  expect(result.exit).not.toBe(0);
  expect(result.summary.status).toBe('FAIL');
  expect(result.report).toContain('Verdict: FAIL');
});

test('aucun cookie, jeton ni message d’erreur brut dans le rapport',()=>{
  const proof=validProof();
  proof.result='FAIL';
  proof.error='__Host-kmrc_jwt=private-token-in-ci-log';
  const result=run(proof);
  expect(result.exit).not.toBe(0);
  expect(result.report).not.toContain('private-token-in-ci-log');
  expect(JSON.stringify(result.summary)).not.toContain('private-token-in-ci-log');
});

test('une preuve manquante ne vaut jamais PASS',()=>{
  const result=run(null);
  expect(result.exit).not.toBe(0);
  expect(result.stderr).toContain('MARKET_VISIBILITY_PROOF_MISSING');
});
