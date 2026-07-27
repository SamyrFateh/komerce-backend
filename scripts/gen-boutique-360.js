#!/usr/bin/env node
'use strict';

/**
 * gen-boutique-360.js — Carte 360 de la boutique (pendant front du graphe backend).
 *
 *   Frère de generate-komerce-arch-graph.js et gen-dashboards-360.js : même colonne
 *   vertébrale (@komerce-arch), même cliquet (--save/--check), sorties co-localisées
 *   dans docs/, pour que le méta-graphe puisse coudre les trois.
 *
 *   La boutique se couple par un BUS D'ÉVÉNEMENTS (b-bus), pas par imports ni chaîne SPA.
 *   La carte fusionne :
 *     • la topologie du bus (qui émet / qui écoute) — système nerveux ;
 *     • les modules JS (header @komerce-arch) ;
 *     • la couture API → backend : chaque endpoint appelé, résolu au contrat OpenAPI
 *       (NOT_FOUND si absent du contrat = même classe de bug que .orders côté dashboards) ;
 *     • les bundles CSS et la machine à états des classes <body>.
 *
 *   Sorties : docs/BOUTIQUE_360.json + docs/BOUTIQUE_360.md
 *
 * Modes :
 *   node scripts/gen-boutique-360.js          → (re)génère
 *   node scripts/gen-boutique-360.js --check  → cliquet, exit 1 si régression
 *   node scripts/gen-boutique-360.js --save   → fige la baseline
 *
 * Invariants (cliquet sur .boutique-360-baseline.json) :
 *   • émission orpheline / écouteur orphelin / événement non déclaré (bus) ;
 *   • endpoint NOT_FOUND : appelé par la boutique, absent du contrat OpenAPI.
 *   Pré-existants gelés ; seules les NOUVELLES occurrences bloquent. UNKNOWN = informatif.
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '..');
const BTQ         = path.join(ROOT, 'public', 'boutique');
const JS_DIR      = path.join(BTQ, 'js');
const BUS_FILE    = path.join(JS_DIR, 'b-bus.js');
const CSS_BUNDLES = path.join(BTQ, 'scripts', 'css-bundles.js');
const INDEX       = path.join(BTQ, 'index.html');
const OPENAPI     = path.join(ROOT, 'docs', 'contract', 'openapi.json');
const DOCS        = path.join(ROOT, 'docs');
const OUT_JSON    = path.join(DOCS, 'BOUTIQUE_360.json');
const OUT_MD      = path.join(DOCS, 'BOUTIQUE_360.md');
const BASELINE    = path.join(__dirname, '.boutique-360-baseline.json');

const args = process.argv.slice(2);
const CHECK = args.includes('--check'), SAVE = args.includes('--save');
const RED='\x1b[31m',GRN='\x1b[32m',YLW='\x1b[33m',CYN='\x1b[36m',BLD='\x1b[1m',DIM='\x1b[2m',R='\x1b[0m';

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const normPath = p => p.replace(/[?#].*$/, '').replace(/\$\{[^}]+\}/g, '{id}').replace(/\{[^}]+\}/g, '{id}').replace(/\/+$/,'') || '/';

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'dist') walk(full, acc); }
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) acc.push(full);
  }
  return acc;
}

function headerField(h, f) {
  const m = h.match(new RegExp('@' + f + '\\s+([^\\n]+)'));
  if (!m) return null; const v = m[1].trim(); return v === '@unknown' ? null : v;
}
function headerList(h, f) { const v = headerField(h, f); return v ? v.split(',').map(s => s.trim()).filter(Boolean) : []; }

function parseContract() {
  const byKey = {}, pathSet = new Set(), provenPaths = new Set();
  try {
    const doc = JSON.parse(fs.readFileSync(OPENAPI, 'utf8'));
    for (const [route, methods] of Object.entries(doc.paths || {})) {
      const np = normPath(route); pathSet.add(np);
      for (const [method, def] of Object.entries(methods || {})) {
        const st = (def && def['x-contract-status']) || 'UNKNOWN';
        byKey[`${method.toUpperCase()} ${np}`] = st;
        if (st === 'PROVEN') provenPaths.add(np);
      }
    }
  } catch { /* contrat absent : tout sera UNKNOWN/NOT_FOUND */ }
  return { byKey, pathSet, provenPaths };
}

function collectModules(contract) {
  const modules = [], callEdges = [];
  for (const f of walk(JS_DIR, [])) {
    const rel  = path.relative(JS_DIR, f).replace(/\\/g, '/');
    const id   = path.basename(rel).replace(/\.js$/, '');
    const raw  = fs.readFileSync(f, 'utf8');
    const code = strip(raw);
    const hm   = raw.match(/@komerce-arch[\s\S]*?\*\//);
    const header = hm ? hm[0] : '';

    const emitCalls = [...code.matchAll(/bus\.emit\(\s*['"]([^'"]+)['"]\s*(,)?/g)].map(m => ({ name: m[1], hasArg: !!m[2] }));
    const emits   = [...new Set(emitCalls.map(m => m.name))];
    const listens = [...new Set([...code.matchAll(/bus\.on\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]))];
    const imports = [...new Set([...code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map(m => path.basename(m[1]).replace(/\.js$/,'')))];
    const bodyClasses = [...new Set([...code.matchAll(/body\.classList\.(?:add|remove|toggle)\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]))];

    // Couture API : capture des chemins complets (template/concaténation → DYNAMIC)
    for (const m of code.matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)) {
      const rawRoute = m[1];
      const dynamic  = rawRoute.includes('${') || /\/$/.test(rawRoute);
      const np       = normPath(rawRoute);
      let status;
      if (dynamic) status = 'DYNAMIC';
      else if (contract.provenPaths.has(np)) status = 'PROVEN';
      else if (contract.pathSet.has(np))     status = 'UNKNOWN';
      else status = 'NOT_FOUND';
      callEdges.push({ module: id, route: np, raw: rawRoute, dynamic, contractStatus: status });
    }

    modules.push({
      file: 'public/boutique/js/' + rel, id,
      hasHeader: !!header,
      role: headerField(header,'role'), domain: headerField(header,'domain'),
      layer: headerField(header,'layer'), criticality: headerField(header,'criticality'),
      doctrine: headerList(header,'doctrine'),
      depends: headerList(header,'depends'), usedBy: headerList(header,'used-by'),
      emits, listens, imports, bodyClasses, emitCalls,
    });
  }
  return { modules: modules.sort((a,b)=>a.file.localeCompare(b.file)), callEdges };
}

function parseBusRegistry() {
  const raw = fs.readFileSync(BUS_FILE, 'utf8'), lines = raw.split('\n');
  let section = null; const active = [], dead = [];
  const owned = {}, consumers = {};
  const stripJs = s => s.replace(/\.js$/, '').trim();
  for (const line of lines) {
    if (/Propriété des contrats/.test(line))  { section='owned';     continue; }
    if (/Consommateurs déclarés/.test(line))  { section='consumers'; continue; }
    if (/Événements standard/.test(line))     { section='active';    continue; }
    if (/Événements retirés/.test(line))      { section='dead';      continue; }
    if (!section) continue;
    if (/\*\//.test(line)) { section=null; continue; }
    if (section==='active') {
      const m=line.match(/^\s*\*\s{2,}([a-z][\w-]*(?::[\w-]+)?)\b/); if(m) active.push(m[1]);
    } else if (section==='dead') {
      line.replace(/^\s*\*\s*/,'').split(',').forEach(t=>{ const tk=t.trim().match(/^[a-z][\w-]*(?::[\w-]+)?/); if(tk) dead.push(tk[0]); });
    } else if (section==='owned') {
      const m = line.match(/^\s*\*\s{2,}([a-z][\w-]*(?::[\w-]+)?)\b(.*)$/);
      if (m) {
        const rest = m[2];
        const ownerM = rest.match(/\bowner=(\S+)/), producerM = rest.match(/\bproducer=(\S+)/), payloadM = rest.match(/\bpayload=(\S+)/);
        owned[m[1]] = {
          owner: ownerM ? ownerM[1] : null,
          producer: producerM ? stripJs(producerM[1]) : null,
          payload: payloadM ? payloadM[1] : null,
        };
      }
    } else if (section==='consumers') {
      const m = line.match(/^\s*\*\s{2,}([a-z][\w-]*(?::[\w-]+)?)\s*:\s*(.+)$/);
      if (m) consumers[m[1]] = m[2].split(',').map(s=>stripJs(s.trim())).filter(Boolean);
    }
  }
  // Tout événement déclaré owned/consumers doit aussi être un événement actif
  // (source unique : ne pas dupliquer la liste, juste s'assurer qu'il n'est
  // pas classé "non déclaré" faute d'avoir été recopié dans les deux blocs).
  for (const n of Object.keys(owned)) active.push(n);
  return { active:[...new Set(active)], dead:[...new Set(dead.filter(Boolean))], owned, consumers };
}

function parseBundles() {
  try {
    delete require.cache[require.resolve(CSS_BUNDLES)];
    const { BUNDLES } = require(CSS_BUNDLES);
    return (BUNDLES || []).map(bundle => ({
      out: bundle.out,
      files: Array.isArray(bundle.files) ? bundle.files.slice() : [],
    }));
  } catch (e) {
    console.warn(`${YLW}⚠ Impossible de lire css-bundles.js: ${e.message}${R}`);
    return [];
  }
}

function build() {
  const contract = parseContract();
  const { modules, callEdges } = collectModules(contract);
  const registry = parseBusRegistry();
  const bundles  = parseBundles();
  let staticBody = [];
  try { const im = fs.readFileSync(INDEX,'utf8').match(/<body[^>]*\bclass=['"]([^'"]+)['"]/i); staticBody = im?im[1].split(/\s+/).filter(Boolean):[]; } catch {}

  const events = {};
  const ev = n => (events[n] = events[n] || { emitters:[], listeners:[] });
  modules.forEach(m => { m.emits.forEach(e=>ev(e).emitters.push(m.id)); m.listens.forEach(e=>ev(e).listeners.push(m.id)); });
  Object.values(events).forEach(e=>{ e.emitters=[...new Set(e.emitters)].sort(); e.listeners=[...new Set(e.listeners)].sort(); });

  const declActive = new Set(registry.active), declDead = new Set(registry.dead);
  const orphanEmit=[], orphanListen=[], undeclared=[];
  for (const [n,e] of Object.entries(events)) {
    if (e.emitters.length && !e.listeners.length) orphanEmit.push(n);
    if (e.listeners.length && !e.emitters.length) orphanListen.push(n);
    if (!declActive.has(n) && !declDead.has(n)) undeclared.push(n);
  }
  const declaredUnused = [...declActive].filter(n=>!events[n]);

  // Propriété des contrats (P3b) — uniquement pour les événements déclarés dans
  // le bloc 'Propriété des contrats' de b-bus.js. Les événements hors de cette
  // liste ne sont PAS soumis à cette validation (pas de régression sur le reste
  // du bus, cf. instruction : plusieurs consommateurs n'est pas une anomalie).
  const emitCallsByEvent = {};
  modules.forEach(m => (m.emitCalls||[]).forEach(c => (emitCallsByEvent[c.name]=emitCallsByEvent[c.name]||[]).push({ module:m.id, hasArg:c.hasArg })));

  const ownership = {};
  for (const [name, decl] of Object.entries(registry.owned)) {
    const e = events[name] || { emitters:[], listeners:[] };
    const declaredConsumersSet = new Set(registry.consumers[name] || []);
    const wantsArg = decl.payload === 'value';
    ownership[name] = {
      owner: decl.owner,
      declaredProducer: decl.producer,
      actualEmitters: e.emitters,
      producerMissing: !decl.producer || e.emitters.length === 0,
      producerUnauthorized: decl.producer ? e.emitters.filter(x => x !== decl.producer) : [],
      declaredConsumers: [...declaredConsumersSet],
      actualConsumers: e.listeners,
      consumerUndeclared: e.listeners.filter(x => !declaredConsumersSet.has(x)),
      payload: decl.payload,
      payloadMismatches: decl.payload ? (emitCallsByEvent[name]||[]).filter(c => c.hasArg !== wantsArg).map(c=>c.module) : [],
    };
  }
  const ownershipStatus = {};
  for (const [name, o] of Object.entries(ownership)) {
    if (!o.owner)                            ownershipStatus[name] = { level:'red',    msg:'propriétaire canonique absent' };
    else if (o.producerMissing)              ownershipStatus[name] = { level:'red',    msg:`producteur déclaré (${o.declaredProducer||'—'}) n'émet jamais` };
    else if (o.producerUnauthorized.length)  ownershipStatus[name] = { level:'red',    msg:`producteur non autorisé : ${o.producerUnauthorized.join(', ')}` };
    else if (o.payloadMismatches.length)     ownershipStatus[name] = { level:'red',    msg:`payload divergent (arité attendue: ${o.payload}) chez ${o.payloadMismatches.join(', ')}` };
    else if (o.consumerUndeclared.length)    ownershipStatus[name] = { level:'orange', msg:`consommateur non déclaré : ${o.consumerUndeclared.join(', ')}` };
    else                                      ownershipStatus[name] = { level:'green', msg:'propriété saine' };
  }

  const notFound = [...new Set(callEdges.filter(e=>e.contractStatus==='NOT_FOUND').map(e=>e.route))].sort();
  const unproven = [...new Set(callEdges.filter(e=>e.contractStatus==='UNKNOWN').map(e=>e.route))].sort();
  const dynamic  = [...new Set(callEdges.filter(e=>e.contractStatus==='DYNAMIC').map(e=>e.route))].sort();
  const endpoints = [...new Set(callEdges.map(e=>e.route))].sort();

  const bodyClassOwners = {};
  modules.forEach(m=>m.bodyClasses.forEach(c=>(bodyClassOwners[c]=bodyClassOwners[c]||[]).push(m.id)));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      modules: modules.length, withHeader: modules.filter(m=>m.hasHeader).length,
      events: Object.keys(events).length, declaredActive: registry.active.length, declaredDead: registry.dead.length,
      cssBundles: bundles.length, endpoints: endpoints.length,
      orphanEmit: orphanEmit.length, orphanListen: orphanListen.length, undeclared: undeclared.length,
      notFoundEndpoints: notFound.length, unprovenEndpoints: unproven.length, dynamicEndpoints: dynamic.length,
      ownedEvents: Object.keys(ownership).length,
      ownershipRed: Object.values(ownershipStatus).filter(s=>s.level==='red').length,
      ownershipOrange: Object.values(ownershipStatus).filter(s=>s.level==='orange').length,
    },
    modules, events, bundles, callEdges, registry,
    diagnostics: {
      orphanEmit: orphanEmit.sort(), orphanListen: orphanListen.sort(), undeclared: undeclared.sort(),
      declaredUnused: declaredUnused.sort(), notFoundEndpoints: notFound, unprovenEndpoints: unproven, dynamicEndpoints: dynamic,
      ownershipRed: Object.entries(ownershipStatus).filter(([,s])=>s.level==='red').map(([n])=>n).sort(),
      ownershipOrange: Object.entries(ownershipStatus).filter(([,s])=>s.level==='orange').map(([n])=>n).sort(),
    },
    ownership, ownershipStatus,
    bodyClasses: { static: staticBody, dynamic: bodyClassOwners },
    endpoints,
  };
}

function busStatus(name, m) {
  const os = m.ownershipStatus && m.ownershipStatus[name];
  if (os) {
    if (os.level==='red')    return `🔴 ${os.msg}`;
    if (os.level==='orange') return `🟠 ${os.msg}`;
  }
  const d=m.diagnostics;
  if (d.orphanEmit.includes(name)) return '🔴 émission orpheline';
  if (d.orphanListen.includes(name)) return '🟠 écouteur orphelin';
  if (d.undeclared.includes(name)) return '🟡 non déclaré';
  if (os && os.level==='green') {
    const owner = (m.ownership && m.ownership[name] && m.ownership[name].owner) || '—';
    return `🟢 sain (propriétaire: ${owner})`;
  }
  return '🟢 sain';
}
function epStatus(s){ return {PROVEN:'🟢 prouvé',UNKNOWN:'⚪ non prouvé',NOT_FOUND:'🔴 hors contrat',DYNAMIC:'🔵 dynamique'}[s]||s; }

function renderMermaid(m) {
  const lines=['```mermaid','graph LR'], seen=new Set(), safe=s=>s.replace(/[^\w]/g,'_');
  for (const [name,e] of Object.entries(m.events)) for (const f of e.emitters) for (const t of e.listeners) {
    if (f===t) continue; const k=`${f}|${name}|${t}`; if(seen.has(k))continue; seen.add(k);
    lines.push(`  ${safe(f)}["${f}"] -->|${name}| ${safe(t)}["${t}"]`);
  }
  lines.push('```'); return lines.join('\n');
}

function renderMd(m){
  const s=m.summary, L=[];
  L.push('# Boutique 360 — carte d\'architecture front (générée)');
  L.push('');
  L.push('> ⚠️ Généré par `scripts/gen-boutique-360.js`. Ne pas éditer à la main.');
  L.push(`> Régénéré le ${m.generatedAt}.`);
  L.push('> Couplage par **bus d\'événements**. Couture backend par **endpoints → contrat OpenAPI**.');
  L.push('');
  L.push('## Synthèse');
  L.push('');
  L.push(`- Modules JS : **${s.modules}** (${s.withHeader} headés) · Événements bus : **${s.events}** · Bundles CSS : **${s.cssBundles}**`);
  L.push(`- Endpoints appelés : **${s.endpoints}** — 🔴 ${s.notFoundEndpoints} hors contrat · ⚪ ${s.unprovenEndpoints} non prouvés · 🔵 ${s.dynamicEndpoints} dynamiques`);
  L.push(`- Santé bus : ${s.orphanEmit} émission(s) orpheline(s), ${s.orphanListen} écouteur(s) orphelin(s), ${s.undeclared} non déclaré(s)`);
  L.push('');
  L.push('## 1. Couture API → backend (résolue au contrat OpenAPI)');
  L.push('');
  L.push('| Endpoint | Appelé par | Statut contrat |');
  L.push('|---|---|---|');
  const byRoute={}; m.callEdges.forEach(e=>{ (byRoute[e.route]=byRoute[e.route]||{mods:new Set(),st:e.contractStatus}); byRoute[e.route].mods.add(e.module); });
  for (const route of Object.keys(byRoute).sort()) {
    const r=byRoute[route]; L.push(`| \`${route}\` | ${[...r.mods].join(', ')} | ${epStatus(r.st)} |`);
  }
  L.push('');
  if (m.diagnostics.notFoundEndpoints.length) {
    L.push('> 🔴 **Hors contrat** (même classe que `.orders`/`getCosting`) : ' + m.diagnostics.notFoundEndpoints.map(e=>'`'+e+'`').join(', '));
    L.push('');
  }
  L.push('## 2. Topologie du bus');
  L.push('');
  L.push('| Événement | Émetteurs | Écouteurs | Statut |');
  L.push('|---|---|---|---|');
  for (const n of Object.keys(m.events).sort()) { const e=m.events[n]; L.push(`| \`${n}\` | ${e.emitters.join(', ')||'—'} | ${e.listeners.join(', ')||'—'} | ${busStatus(n,m)} |`); }
  L.push('');
  L.push('### Diagramme');
  L.push('');
  L.push(renderMermaid(m));
  L.push('');
  L.push('## 2b. Propriété des contrats bus (P3b)');
  L.push('');
  L.push('> Uniquement les événements déclarés dans le bloc `Propriété des contrats` de');
  L.push('> `b-bus.js`. Plusieurs consommateurs déclarés ne sont **pas** une anomalie —');
  L.push('> seuls le sont : propriétaire absent, producteur non autorisé/absent, payload');
  L.push('> divergent, ou consommateur observé hors de la liste déclarée.');
  L.push('');
  L.push('| Événement | Propriétaire | Producteur(s) | Consommateurs | Payload | Verdict |');
  L.push('|---|---|---|---|---|---|');
  for (const [name,o] of Object.entries(m.ownership||{})) {
    const st = m.ownershipStatus[name];
    const icon = st.level==='red'?'🔴':st.level==='orange'?'🟠':'🟢';
    L.push(`| \`${name}\` | ${o.owner} | ${o.actualEmitters.join(', ')||'—'} | ${o.actualConsumers.join(', ')||'—'} | ${o.payload} | ${icon} ${st.msg} |`);
  }
  L.push('');
  L.push('## 3. Bundles CSS');
  L.push('');
  L.push('| Bundle | Sources |');
  L.push('|---|---|');
  for (const b of m.bundles) L.push(`| \`css/dist/${b.out}\` | ${b.files.map(f=>'`'+f+'`').join(', ')} |`);
  L.push('');
  L.push('---');
  L.push('*Carte vérifiée en pre-commit par `boutique:360:check` (cliquet bus + endpoints hors contrat).*');
  return L.join('\n')+'\n';
}

function loadBaseline(){ try { return JSON.parse(fs.readFileSync(BASELINE,'utf8')); } catch { return null; } }

function runCheck(m){
  const base=loadBaseline();
  if(!base){ console.error(`${RED}${BLD}✖ Aucune baseline boutique-360.${R} Lance : node scripts/gen-boutique-360.js --save`); return 1; }
  const d=m.diagnostics, news=[];
  const diff=(k,label)=>{ const set=new Set(base[k]||[]); for(const x of d[k]) if(!set.has(x)) news.push(`${label} : ${x}`); };
  diff('orphanEmit','🔴 nouvelle émission orpheline');
  diff('orphanListen','🟠 nouvel écouteur orphelin');
  diff('undeclared','🟡 nouvel événement non déclaré');
  diff('notFoundEndpoints','🔴 nouvel endpoint hors contrat');
  diff('ownershipRed','🔴 nouvelle violation de propriété bus (producteur/payload)');
  diff('ownershipOrange','🟠 nouveau consommateur non déclaré');
  console.log(`${BLD}Boutique 360 — ${m.summary.modules} modules, ${m.summary.events} événements, ${m.summary.endpoints} endpoints${R}`);
  if(news.length===0){ console.log(`${GRN}${BLD}✔ Aucune nouvelle anomalie hors baseline.${R}`); return 0; }
  console.log(`${RED}${BLD}✖ ${news.length} nouvelle(s) anomalie(s) :${R}`);
  news.forEach(x=>console.log(`${RED}   ↑ ${x}${R}`));
  console.log(`${DIM}  Corrige, ou fige si légitime : npm run boutique:360:save${R}`);
  return 1;
}

// Exports pour tests unitaires (P3b, réconciliation 2026-07-27 §4.3) — n'affecte
// pas l'exécution CLI ci-dessous, gardée derrière require.main===module.
module.exports = { build, busStatus, renderMd };

if (require.main === module) {
  const model = build();
  if (SAVE) {
    const d=model.diagnostics;
    fs.writeFileSync(BASELINE, JSON.stringify({ orphanEmit:d.orphanEmit, orphanListen:d.orphanListen, undeclared:d.undeclared, notFoundEndpoints:d.notFoundEndpoints, ownershipRed:d.ownershipRed, ownershipOrange:d.ownershipOrange, savedAt:new Date().toISOString() }, null, 2));
    if(!fs.existsSync(DOCS)) fs.mkdirSync(DOCS,{recursive:true});
    fs.writeFileSync(OUT_JSON, JSON.stringify(model,null,2)); fs.writeFileSync(OUT_MD, renderMd(model));
    console.log(`${GRN}${BLD}✔ Baseline boutique-360 figée${R} (${d.orphanEmit.length} ém. orph., ${d.orphanListen.length} éc. orph., ${d.notFoundEndpoints.length} hors contrat).`);
    process.exit(0);
  }
  if (CHECK) process.exit(runCheck(model));
  if(!fs.existsSync(DOCS)) fs.mkdirSync(DOCS,{recursive:true});
  fs.writeFileSync(OUT_JSON, JSON.stringify(model,null,2)); fs.writeFileSync(OUT_MD, renderMd(model));
  console.log(`${GRN}${BLD}✔ BOUTIQUE_360 généré${R} ${DIM}(${model.summary.modules} modules, ${model.summary.events} événements, ${model.summary.endpoints} endpoints)${R}`);
  console.log(`${CYN}  docs/BOUTIQUE_360.md${R} + ${CYN}docs/BOUTIQUE_360.json${R}`);
  if(model.summary.notFoundEndpoints) console.log(`${YLW}  ⚠ ${model.summary.notFoundEndpoints} endpoint(s) hors contrat — voir §1.${R}`);
}
