/**
 * @komerce-arch-lite
 * @role summarize-real-staging-chromium
 * @domain dashboard
 * @layer script
 * @owner backend-core
 * @purpose Graphe de navigation, backlog et matrice des preuves sans faux PASS.
 * @impact-areas dashboard, market, staging-only
 */
'use strict';
const fs=require('fs'),path=require('path');
const {markets,dimensions,processes}=require('../../tests/staging-canonical/matrix');
const root=path.resolve('test-results/staging-chromium'),dir=path.join(root,'evidence');
fs.mkdirSync(root,{recursive:true});
const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>x.endsWith('.json')):[];
const runs=files.map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
const preflightFile=path.join(root,'credentials-preflight.json');
const credentialPreflight=fs.existsSync(preflightFile)?JSON.parse(fs.readFileSync(preflightFile,'utf8')):null;
const q=x=>'"'+String(x??'').replace(/"/g,'""').replace(/[\r\n]/g,' ')+'"';
const csv=rows=>rows.map(row=>row.map(q).join(',')).join('\n')+'\n';
const allFindings=runs.flatMap(r=>r.findings.map(f=>({...f,role:r.role,viewport:r.viewport})));
const edges=runs.flatMap(r=>r.edges.map(e=>({...e,role:r.role,viewport:r.viewport})));
fs.writeFileSync(path.join(root,'navigation-graph.json'),JSON.stringify({edges},null,2));
fs.writeFileSync(path.join(root,'findings.csv'),csv([
 ['role','viewport','severity','code','detail'],
 ...allFindings.map(f=>[f.role,f.viewport,f.severity,f.code,f.detail])
]));
const matrix=[['market','role','viewport','dimension','requirement','navigation_proof','business_E2E_proof']];
for(const r of runs)for(const m of markets){
 const observed=r.marketViews.some(v=>v.market===m&&v.status===200&&v.readable);
 for(const [dimension,requirements] of [['market',dimensions],['process',processes]]){
  for(const req of requirements)matrix.push([m,r.role,r.viewport,dimension,req,
   observed?'OBSERVED_ONLY':'NOT_PROVEN','NOT_PROVEN']);
 }
}
fs.writeFileSync(path.join(root,'markets-processes-matrix.csv'),csv(matrix));
const routeCount=runs.reduce((n,r)=>n+r.routes.length,0);
const clicked=edges.filter(e=>e.kind==='clicked').length;
const nominalRedirects=runs.reduce((sum,r)=>sum+(r.canonicalRedirects||[]).length,0);
const versions=runs.map(r=>'- '+r.role+'/'+r.viewport+': '+(r.version||'SHA NON PROUVE')).join('\n');
const report=[
 '# Komerce — Chromium staging reel', '',
 'Profils executes: '+runs.length,
 'Profils configures dans le run: '+(credentialPreflight?credentialPreflight.selected_roles.join(', '):'non determines'),
 'Audit des identifiants: '+(credentialPreflight?credentialPreflight.status:'PRECHECK_NOT_RECORDED'),
 'Noms des secrets manquants (valeurs jamais journalisees): '+(credentialPreflight?credentialPreflight.missing_secret_names.join(', ')||'aucun detecte':'inconnu'),
 'Routes observees: '+routeCount,
 'Transitions reellement cliquees: '+clicked,
 'Redirections canoniques observees (nominal prouve): '+nominalRedirects,
 'Anomalies: '+allFindings.length,
 'Cellules de matrice marches/processus: '+(matrix.length-1), '',
 '## Version reellement observee',versions,'',
 '## Verdict distinct', '',
 'NAVIGATION: '+(runs.length&&allFindings.length===0?'aucun ecart sur les chemins parcourus':'NO GO ou couverture bloquee')+'.',
 'Parcours non executes ou roles absents : NOT_PROVEN (jamais PASS).', '',
 'E2E metier integral: NOT_PROVEN. Une lecture Chromium ne prouve pas les transitions transactionnelles P1-P7.',
 'Les cellules metier restent NOT_PROVEN jusqu a un scenario staging isole avec objets et preuves effectives.','',
 '## Anomalies', '',
 ...allFindings.map(f=>'- ['+f.severity+'] '+f.role+'/'+f.viewport+' '+f.code+' : '+f.detail), '',
 '## Preuves archivees', '',
 '- evidence/*.json et evidence/*.jpg: pages, contexte, codes HTTP et captures',
 '- navigation-graph.json: liens decouverts et effectivement cliques',
 '- findings.csv: backlog triable',
 '- markets-processes-matrix.csv: matrice non prouvee != PASS',
 '- html et raw: rapport Playwright, traces Chromium', '',
 'GO global = roles et marches couverts + zero P0/P1/P2 non acceptes + verite API/SQL/UI',
 '+ vrais parcours positifs et negatifs + nettoyage selectif + validation humaine.'
];
fs.writeFileSync(path.join(root,'rapport.md'),report.join('\n')+'\n');
console.log(JSON.stringify({runs:runs.length,routeCount,clicked,nominalRedirects,findings:allFindings.length,matrixRows:matrix.length-1}));
