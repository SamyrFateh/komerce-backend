'use strict';
const fs=require('fs'),path=require('path');
const dir=path.resolve(process.argv[2]||'test-results/real-dashboard-journeys');
fs.mkdirSync(dir,{recursive:true});
const files=fs.readdirSync(dir).filter(f=>/^(admin|market_operator|finance|sourcing|agent_hub|agent_relais|agent_transitaire)-(desktop|mobile)\.json$/.test(f));
const all=files.map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')));
const findings=all.flatMap(x=>(x.findings||[]).map(f=>({...f,role:x.role,viewport:x.viewport})));
const status={};
for(const x of all)for(const r of x.routes||[])status[r.kind]=(status[r.kind]||0)+1;
const routes=all.reduce((n,x)=>n+x.routes.length,0);
const edges=all.reduce((n,x)=>n+x.edges.length,0);
const ctx=all.reduce((n,x)=>n+x.contextJourneys.length,0);
const missing=['admin','market_operator','finance','sourcing','agent_hub','agent_relais','agent_transitaire']
 .flatMap(role=>['desktop','mobile'].filter(v=>!files.includes(role+'-'+v+'.json')).map(v=>role+'-'+v));
const grades=['P0','P1','P2','BLOCKED'];
const q=s=>'"'+String(s??'').replace(/"/g,'""').replace(/[\r\n]+/g,' ')+'"';
const csv=[['grade','role','viewport','code','route','detail'],...findings.map(f=>[f.grade,f.role,f.viewport,f.code,f.route,f.detail])].map(row=>row.map(q).join(',')).join('\n')+'\n';
fs.writeFileSync(path.join(dir,'findings-compiled.csv'),csv);
const md=['# Komerce — audit Playwright réel des parcours dashboards','',
 'Exécution : GitHub Actions + navigateur Chromium, staging distant réel. **Aucune écriture métier.**','',
 '- Profils/écrans exécutés : '+all.length+'/14',
 '- Parcours de pages observés : '+routes,
 '- Transitions effectivement cliquées : '+edges,
 '- Traversées métier contextualisées : '+ctx,
 '- États des pages : '+JSON.stringify(status),
 '- Anomalies : '+JSON.stringify(Object.fromEntries(grades.map(k=>[k,findings.filter(f=>f.grade===k).length]))),
 '- Profils manquants : '+(missing.join(', ')||'aucun'), '',
 '## Détail des identités et de la couverture','',
 '| Profil | Vue | Connexion | Routes | Clics | Contexte | SHA |',
 '|---|---|---|---:|---:|---:|---|',
 ...all.map(x=>'|'+[x.role,x.viewport,x.identity,x.routes.length,x.edges.length,x.contextJourneys.length,(x.observedSha||'NON PROUVÉ').slice(0,12)].join('|')+'|'),
 '', '## Anomalies, blocages et écarts','',
 ...findings.map(f=>'- **['+f.grade+']** '+f.role+'/'+f.viewport+' '+f.code+' — '+(f.route||'')+' : '+f.detail),
 '', '## Limitations',
 '- Un test de lien cliqué prouve la navigation, pas une écriture commerciale.',
 '- Aucun paiement, validation éditoriale, commande, publication ou attribution de droits n’a été exécuté.',
 '- Les profils sans identifiants disponibles sont BLOCKED ; les parcours absents NOT_PROVEN.',
 '- Une page 200 ne certifie pas la correction métier ou la persistance en base.',
 '- Le verdict global reste NO GO / NOT PROVEN jusqu’aux parcours positifs et négatifs transactionnels en base isolée.',
 ''];
fs.writeFileSync(path.join(dir,'rapport.md'),md.join('\n'));
console.log(JSON.stringify({profiles:all.length,routes,edges,context:ctx,status,grades:Object.fromEntries(grades.map(k=>[k,findings.filter(f=>f.grade===k).length])),missing}));
