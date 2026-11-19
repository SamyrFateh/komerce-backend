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
// La preuve Hub Director a son propre schéma et ne représente pas un graphe
// de navigation. Ne pas l'interpréter comme un profil Chromium ordinaire.
const files=fs.existsSync(dir)?fs.readdirSync(dir)
  .filter(x=>x.endsWith('.json')&&x!=='hub-director-readonly.json'&&x!=='g8-refunds-readonly.json'&&x!=='market-visibility.json'):[];
const runs=files.map(f=>{
  const evidence=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
  if(!evidence.role || !Array.isArray(evidence.findings) ||
      !Array.isArray(evidence.routes) || !Array.isArray(evidence.edges) ||
      !Array.isArray(evidence.marketViews)) {
    throw new Error('NAVIGATION_EVIDENCE_SCHEMA_INVALID: '+f);
  }
  return evidence;
});
const preflightFile=path.join(root,'credentials-preflight.json');
const credentialPreflight=fs.existsSync(preflightFile)?JSON.parse(fs.readFileSync(preflightFile,'utf8')):null;
const deploymentPreflightFile=path.join(root,'deployment-preflight.json');
const deploymentPreflight=fs.existsSync(deploymentPreflightFile)?JSON.parse(fs.readFileSync(deploymentPreflightFile,'utf8')):null;
// A filtered Hub Director run emits a different, strictly redacted evidence
// format: booleans, HTTP codes and a SHA. It is not a navigation graph.
// A dedicated G8 audit is a strict, redacted safety/OFF proof, not a
// navigation graph and NEVER a proof of external cash or Mobile Money payout.
if (process.env.E2E_CHROMIUM_SPEC_FILTER === 'g8-refunds-readonly') {
  const file = path.join(dir, 'g8-refunds-readonly.json');
  if (!fs.existsSync(file)) throw new Error('G8_READONLY_PROOF_MISSING');
  const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
  const expectedSha = String(process.env.E2E_EXPECTED_DEPLOY_SHA || '');
  const shaMatches = /^[a-f0-9]{40}$/i.test(expectedSha) &&
    proof.initialSha === expectedSha && proof.finalSha === expectedSha;
  const valid = proof.verdict === 'G8_STAGING_DISABLED_UI_PASS' && shaMatches &&
    proof.admin === true && proof.relay === true && proof.disabled === true &&
    proof.blockedWrites === 0 && proof.jsErrors === 0 && proof.realPayouts === 0;
  const report = [
    '# Komerce — G8 F1/F2 Chromium staging (lecture seule)',
    '',
    'Verdict securite des operations desactivees : ' + (valid ? 'PASS' : 'FAIL'),
    'SHA exact debut et fin : ' + (shaMatches ? expectedSha : 'NON PROUVE'),
    'Admin et relais, vraies connexions et parcours navigateur : ' + (valid ? 'PASS' : 'NON PROUVE'),
    'Routes de remboursement OFF (GET HTTP 409), formulaires absents : ' + (valid ? 'PASS' : 'NON PROUVE'),
    'Zero ecriture financiere, zero erreur JavaScript : ' + (valid ? 'PASS' : 'NON PROUVE'),
    '',
    'La recette OFF ne prouve PAS le remboursement reel F1 ni le transfert Mobile Money manuel F2.',
    'Preuves positives de decaissement physique et de rapprochement operateur : NOT_PROVEN.',
    'Aucun numero de compte, identite, cookie, preuve privee, image ou trace archive.'
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(root, 'rapport.md'), report);
  console.log('[G8-readonly-summary] ' + JSON.stringify({ status: valid ? 'PASS' : 'FAIL', sha_match: shaMatches }));
  if (!valid) process.exitCode = 2;
} else if (process.env.E2E_CHROMIUM_SPEC_FILTER === 'market-visibility') {
  // Strict standalone certification: this proof is NOT a generic navigation graph.
  // Never accept missing evidence, partial menus, missing positive business views,
  // a session loss, a third-party market leak, or an unverified staging SHA.
  const proofFile=path.join(dir,'market-visibility.json');
  if(!fs.existsSync(proofFile)) throw new Error('MARKET_VISIBILITY_PROOF_MISSING');
  const proof=JSON.parse(fs.readFileSync(proofFile,'utf8'));
  const expectedSha=String(process.env.E2E_EXPECTED_DEPLOY_SHA||'');
  const expectedMenu=[
    'control-tower','action-center','flow-commerce','flow-orders','entity-clients',
    'workspace-pricing','workspace-catalog','flow-operations','workspace-shipping',
    'workspace-purchasing','flow-finance','workspace-accounting',
    'live-import-runtime','live-hub','live-relais','markets-home',
    'market-autonomy','market-catalog','unsold','admin-users',
    'admin-providers','settings','help-docs'
  ];
  const codes=Array.isArray(proof.allowedMarkets)?proof.allowedMarkets:[];
  const menu=Array.isArray(proof.navigation?.items)?proof.navigation.items:[];
  const visited=Array.isArray(proof.navigation?.visited)?proof.navigation.visited:[];
  const reads=Array.isArray(proof.checkedReads)?proof.checkedReads:[];
  const denied=Array.isArray(proof.unauthorized)?proof.unauthorized:[];
  const actualMarkets=Array.isArray(proof.boardMarkets)?proof.boardMarkets:[];
  const shaOk=/^[0-9a-f]{40}$/.test(expectedSha)
    && proof.version===expectedSha && proof.finalVersion===expectedSha;
  const menuOk=JSON.stringify(menu)===JSON.stringify(expectedMenu)
    && visited.length>=12
    && visited.every(row=>row && row.http===200 && row.path!=='/login.html');
  const scopeOk=codes.length>0 && codes.every(code=>/^[A-Z]{2}$/.test(code))
    && actualMarkets.every(code=>codes.includes(code))
    && Number(proof.boardOrderCount)>0
    && reads.length>0 && reads.every(row=>row && row.http===200 && codes.includes(row.market))
    && denied.length>0 && denied.every(row=>row && !codes.includes(row.market) && row.status>=400 && row.status<500);
  const po=proof.order360||{};
  const poOk=po.status===200 && po.readOnly===true && Number.isInteger(po.poCount) && po.poCount>=0;
  const zeroErrors=Array.isArray(proof.jsErrors)&&proof.jsErrors.length===0
    && Array.isArray(proof.blockedWrites)&&proof.blockedWrites.length===0;
  const checks={sha:shaOk,login:proof.loginStatus===200,role:proof.role==='market_operator',
    menu:menuOk,market_scope:scopeOk,order360:poOk,zero_errors:zeroErrors};
  const valid=proof.result==='PASS'&&Object.values(checks).every(Boolean);
  const summary={status:valid?'PASS':'FAIL',checks,menu_items:menu.length,
    dashboard_destinations:visited.length,authorized_market_codes:codes,
    foreign_market_refusals:denied.length,read_views_checked:reads.length,
    board_order_count:proof.boardOrderCount,sha_match:shaOk};
  fs.writeFileSync(path.join(root,'market-visibility-summary.json'),JSON.stringify(summary,null,2)+'\n');
  fs.writeFileSync(path.join(root,'rapport.md'),[
    '# Komerce — Responsable Marché, Chromium staging réel', '',
    'Verdict: '+summary.status,
    'Version deployee stable: '+(shaOk?expectedSha:'NON PROUVE'),
    'Connexion reelle market_operator: '+(checks.login?'PASS':'FAIL'),
    'Menu metier complet 23 rubriques et destinations HTTP 200: '+(checks.menu?'PASS':'FAIL'),
    'Marchés autorises: '+codes.join(', '),
    'Isolation Hub, consultations métier et refus inter-marchés: '+(checks.market_scope?'PASS':'FAIL'),
    'Order 360 et achats fournisseurs en lecture seule: '+(checks.order360?'PASS':'FAIL'),
    'Aucune ecriture ni erreur JavaScript: '+(checks.zero_errors?'PASS':'FAIL'),
    '',
    'Aucun cookie, jeton, identite ni information sensible ne figure dans ce rapport.',
    'Ce controle de lecture seule ne prouve pas les transitions transactionnelles.',
  ].join('\n')+'\n');
  console.log('[market-visibility-summary] '+JSON.stringify(summary));
  if(!valid)process.exitCode=2;
} else if (process.env.E2E_CHROMIUM_SPEC_FILTER === 'hub-director-readonly') {
  const file = path.join(dir,'hub-director-readonly.json');
  if (!fs.existsSync(file)) throw new Error('HUB_DIRECTOR_PROOF_MISSING');
  const proof=JSON.parse(fs.readFileSync(file,'utf8'));
  const director=proof.director || {};
  const agent=proof.ordinary_agent || {};
  const actualSha=String(proof.sha || '');
  const expectedSha=String(process.env.E2E_EXPECTED_DEPLOY_SHA || '');
  const ok=proof.status==='PASS' &&
    /^[0-9a-f]{40}$/i.test(expectedSha) && actualSha===expectedSha &&
    proof.stable_sha===true && proof.changed===false &&
    proof.total_blocked_writes===0 && proof.total_browser_errors===0 &&
    director.login===true && director.role_agent_hub===true &&
    director.administration_http===200 && director.board_http===200 &&
    director.central_admin_denied===true && director.browser_navigation===true &&
    director.purchase_commitment===true && director.supplier_payment===true &&
    agent.login===true && agent.role_agent_hub===true &&
    agent.administration_http===200 && agent.board_http===200 &&
    agent.central_admin_denied===true && agent.browser_navigation===true &&
    agent.purchase_commitment===false && agent.supplier_payment===false;
  const report=[
    '# Komerce — Hub Director staging READ ONLY','',
    'Verdict Hub Director: '+(ok?'PASS':'FAIL'),
    'Version deployee: '+(actualSha===expectedSha?expectedSha:'SHA_MISMATCH'),
    'Directrice: deux grants distincts confirmes: '+(ok?'oui':'NON PROUVE'),
    'Agent Hub ordinaire: aucun des deux grants: '+(ok?'oui':'NON PROUVE'),
    'Hub Administration et Board: '+(ok?'HTTP 200 pour les deux profils':'NON PROUVE'),
    'Administration centrale: '+(ok?'HTTP 403 pour les deux profils':'NON PROUVE'),
    'Sessions Chromium distinctes, aucun writer metier: '+(ok?'PASS':'NON PROUVE'),
    'Ce controle ne prouve pas les workflows transactionnels ni les cas limites.',
    'E2E metier complet: NOT_PROVEN.',
    'Aucun secret, cookie, donnees de PO ou capture dans ce rapport.'
  ].join('\n')+'\n';
  fs.writeFileSync(path.join(root,'rapport.md'),report);
  console.log('[hub-director-summary] '+JSON.stringify({status:ok?'PASS':'FAIL',sha_match:actualSha===expectedSha}));
  if(!ok) process.exitCode=2;
} else {
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
const expectedDenied=runs.reduce((sum,r)=>sum+(r.expectedDenials||[]).length,0);
const versions=runs.map(r=>'- '+r.role+'/'+r.viewport+': '+(r.version||'SHA NON PROUVE')).join('\n');
const report=[
 '# Komerce — Chromium staging reel', '',
 'Profils executes: '+runs.length,
 'Type d audit: '+(runs.some(r=>r.mode==='QUICK_READONLY')?'QUICK_READONLY_LIMITED':'EXHAUSTIVE_READONLY'),
 'Profils configures dans le run: '+(credentialPreflight?credentialPreflight.selected_roles.join(', '):'non determines'),
 'Audit des identifiants: '+(credentialPreflight?credentialPreflight.status:'PRECHECK_NOT_RECORDED'),
 'Alignement code deploye: '+(deploymentPreflight?deploymentPreflight.status:'DEPLOY_PREFLIGHT_NOT_RECORDED'),
 'Refus attendus observes (hors findings): '+expectedDenied,
 'Noms des secrets manquants (valeurs jamais journalisees): '+(credentialPreflight?credentialPreflight.missing_secret_names.join(', ')||'aucun detecte':'inconnu'),
 'Routes observees: '+routeCount,
 'Transitions reellement cliquees: '+clicked,
 'Redirections canoniques observees (nominal prouve): '+nominalRedirects,
 'Anomalies: '+allFindings.length,
 'Cellules de matrice marches/processus: '+(matrix.length-1), '',
 '## Version reellement observee',versions,'',
 '## Verdict distinct', '',
 'NAVIGATION: '+(runs.length&&allFindings.length===0?'aucun ecart sur les chemins parcourus':'NO GO ou couverture bloquee')+'.',
 'Le mode rapide ne teste que 3 routes et 5 clics maximum par role : aucune exhaustivite revendiquee.',
 'Parcours non executes ou roles absents : NOT_PROVEN (jamais PASS).', '',
 'E2E metier integral: NOT_PROVEN. Une lecture Chromium ne prouve pas les transitions transactionnelles P1-P7.',
 'Les cellules metier restent NOT_PROVEN jusqu a un scenario staging isole avec objets et preuves effectives.','',
 '## Anomalies', '',
 ...allFindings.map(f=>'- ['+f.severity+'] '+f.role+'/'+f.viewport+' '+f.code+' : '+f.detail), '',
 '## Artefacts et confidentialite', '',
 '- Archive publique : uniquement ce rapport Markdown, sans cookie, identifiant, capture ou trace.',
 '- Donnees de navigation locales au job : non publiees et supprimees apres execution.',
 '- Les cellules metier non executees sont NOT_PROVEN.', '',
 'GO global = roles et marches couverts + zero P0/P1/P2 non acceptes + verite API/SQL/UI',
 '+ vrais parcours positifs et negatifs + nettoyage selectif + validation humaine.'
];
fs.writeFileSync(path.join(root,'rapport.md'),report.join('\n')+'\n');
console.log(JSON.stringify({runs:runs.length,routeCount,clicked,nominalRedirects,expectedDenied,findings:allFindings.length,matrixRows:matrix.length-1}));

}
