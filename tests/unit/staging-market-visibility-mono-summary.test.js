'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');

const script=path.resolve(__dirname,'../../scripts/recette/summarize-staging-chromium.js');
const SHA='b'.repeat(40);
const MARKETS=['KM','CM','CG'];
const MENU=[
 'control-tower','action-center','flow-commerce','flow-orders','entity-clients',
 'workspace-pricing','workspace-catalog','flow-operations','workspace-shipping',
 'workspace-purchasing','flow-finance','workspace-accounting','live-import-runtime',
 'live-hub','live-relais','markets-home','market-autonomy','market-catalog','unsold',
 'admin-users','admin-providers','settings','help-docs'
];
function proof(market){return {
 market,result:'PASS',role:'market_operator',version:SHA,finalVersion:SHA,loginStatus:200,
 allowedMarkets:[market],hubMarkets:[market],hubOrderCount:1,
 oracle:{markets:MARKETS,hub:{count:1,market_codes:[market],active_match:true,active_refs:['ORDER-1'],board_refs:['ORDER-1']}},
 navigation:{items:MENU,visited:Array.from({length:18},(_,i)=>({href:`/admin/example-${i}`,http:200,path:`/admin/example-${i}`}))},
 consultations:[{capability:'catalog.read',path:'/local-offer/services',http:200,market,collection:true}],
 order360:[{market,status:200,readOnly:true,poCount:1}],
 foreign_order_denials:[{status:403},{status:404}],foreign_po_denials:[{status:403}],
 foreign_client_denials:[{status:404},{status:404}],visible_mutation_controls:[],foreignDataLeaks:[],foreignMarketLeaks:[],blockedWrites:[],jsErrors:[],readOnlyOracle:true
};}
function run(overrides={}){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'kmrc-market-mono-'));
 try{
   const dir=path.join(cwd,'test-results/staging-chromium/evidence');fs.mkdirSync(dir,{recursive:true});
   for(const market of MARKETS)fs.writeFileSync(path.join(dir,`market-visibility-${market}.json`),JSON.stringify(overrides[market]||proof(market)));
   const result=spawnSync(process.execPath,[script],{cwd,env:{...process.env,E2E_CHROMIUM_SPEC_FILTER:'market-visibility-mono',
     E2E_EXPECTED_DEPLOY_SHA:SHA,GITHUB_RUN_ID:'123456'},encoding:'utf8',timeout:6000});
   const root=path.join(cwd,'test-results/staging-chromium');
   return {exit:result.status,stderr:result.stderr,
     summary:JSON.parse(fs.readFileSync(path.join(root,'market-visibility-mono-summary.json'),'utf8')),
     report:fs.readFileSync(path.join(root,'rapport.md'),'utf8'),
     markets:Object.fromEntries(MARKETS.map(m=>[m,fs.readFileSync(path.join(root,`market-visibility-${m}.md`),'utf8')]))};
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
}

test('PASS global seulement si les trois rapports mono-marché sont complets',()=>{
 const result=run();
 expect(result.exit).toBe(0);
 expect(result.summary.status).toBe('PASS');
 expect(result.summary.markets.map(x=>[x.market,x.status])).toEqual([['KM','PASS'],['CM','PASS'],['CG','PASS']]);
 expect(result.markets.KM).toContain('Verdict : **PASS**');
 expect(result.report).toContain('Lecture seule uniquement');
});

test.each([
 ['scope CM supplémentaire',p=>p.allowedMarkets.push('CM')],
 ['destination manquante',p=>p.navigation.visited[0].http=403],
 ['rubrique manquante',p=>p.navigation.items.pop()],
 ['18e destination absente',p=>p.navigation.visited.pop()],
 ['client étranger exposé',p=>p.foreign_client_denials[0].status=200],
 ['bouton de mutation',p=>p.visible_mutation_controls.push({label:'Confirmer'})],
 ['fuite de données d’un autre marché',p=>p.foreignDataLeaks.push({path:'/api/admin/entities/orders',kind:'order'})],
 ['écriture réseau',p=>p.blockedWrites.push('POST /api/orders')],
 ['erreur JavaScript',p=>p.jsErrors.push('ReferenceError')],
 ['oracle PG absent',p=>p.readOnlyOracle=false],
 ['Hub actif différent du PG',p=>p.oracle.hub.active_refs.push('ORDER-UNLISTED')],
])('%s : statut global FAIL',(name,corrupt)=>{
 const cm=proof('CM');corrupt(cm);
 const result=run({CM:cm});
 expect(result.exit).not.toBe(0);
 expect(result.summary.status).toBe('FAIL');
 expect(result.summary.markets.find(x=>x.market==='CM').status).toBe('FAIL');
});


test('Un marché sans commande Hub active reste certifiable si oracle PG et tableau sont tous deux vides',()=>{
 const cm=proof('CM');
 cm.hubOrderCount=0;
 cm.oracle.hub={count:0,market_codes:['CM'],active_match:true,active_refs:[],board_refs:[]};
 const result=run({CM:cm});
 expect(result.exit).toBe(0);
 expect(result.summary.markets.find(x=>x.market==='CM').checks.oracle).toBe(true);
});
