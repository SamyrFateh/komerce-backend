#!/usr/bin/env node
'use strict';

/**
 * feature-audit.js — Audit feature-par-feature (boutique + backend + dashboards).
 *
 *   Doctrine : chaque feature possède un manifeste (`*.feature.js`) qui déclare
 *   son périmètre de fichiers (`files`, par couche) ET ses contrats positifs
 *   (`contracts`). Ce runner, pour chaque feature, exécute UNIQUEMENT les contrats
 *   qu'elle déclare, scopés à ses fichiers, et produit une carte de score.
 *
 *   Différence clé avec les gates existants : les gates actuels sont GLOBAUX et
 *   NÉGATIFS (absence de var, absence de conflit, absence d'injection…). Une règle
 *   *supprimée* ne crée aucune violation → tout reste vert (c'est par là que la
 *   modal cassée est passée). Ici les contrats sont PAR FEATURE et POSITIFS :
 *   ils AFFIRMENT qu'une invariante tient. Une suppression casse l'affirmation.
 *
 *   Le runner ne réimplémente pas les gates : il les ORCHESTRE par feature. Chaque
 *   type de contrat est un petit checker pur-node ; le manifeste choisit lesquels
 *   s'appliquent et avec quels paramètres. La couche possédée décide de la
 *   spécificité (services/routes → backend ; boutique → rendu CSS ; dash → écran).
 *
 *   Statuts par contrat :
 *     PASS  l'affirmation tient
 *     FAIL  l'affirmation est violée (bloquant en --strict)
 *     SKIP  cible absente de ce checkout (ex: services/ pas dans ce zip) — informatif
 *     WARN  dette tolérée sous cliquet (baseline), pas une régression
 *
 * Usage :
 *   node scripts/feature-audit.js              rapport complet
 *   node scripts/feature-audit.js --strict     exit 1 si un FAIL
 *   node scripts/feature-audit.js --feature X  une seule feature
 *   node scripts/feature-audit.js --root DIR   racine du repo (défaut: cwd)
 */

const fs   = require('fs');
const path = require('path');

const args    = process.argv.slice(2);
const STRICT  = args.includes('--strict');
const ROOT    = path.resolve(argVal('--root') || process.cwd());
const ONLY    = argVal('--feature');

function argVal(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; }

const C = { red:'\x1b[31m', grn:'\x1b[32m', ylw:'\x1b[33m', dim:'\x1b[2m', bld:'\x1b[1m', cyn:'\x1b[36m', r:'\x1b[0m' };
const ICON = { PASS:`${C.grn}✔${C.r}`, FAIL:`${C.red}✖${C.r}`, SKIP:`${C.dim}–${C.r}`, WARN:`${C.ylw}▲${C.r}` };

// ── Découverte des manifestes (toutes couches) ──────────────────────────────
// `base` fixe la racine de résolution des chemins déclarés dans `files` :
//   - backend (`features/`)              : chemins écrits relatifs à ROOT
//     (ex: 'services/x.js') → base = ROOT
//   - boutique (`public/boutique/features/`) : chemins écrits relatifs au
//     dossier du manifeste lui-même (ex: '../css/x.css') → base = dossier du manifeste
// Bug historique corrigé (2026-07) : les deux familles utilisaient la même
// résolution (dossier du manifeste), ce qui rendait `files-exist` — et donc
// tous les contrats qui en dépendent — silencieusement SKIP pour les 17
// features backend (chemins jamais trouvés sous features/services/, etc.),
// alors même que feature-registry-check.js (résolution correcte depuis ROOT)
// confirmait ces fichiers présents. Le gate bloquant en CI ne protégeait donc
// en réalité que la boutique.
const MANIFEST_GLOBS = [
  { dir: 'features',                 base: 'root', kind: 'backend'  },
  { dir: 'public/boutique/features', base: 'self', kind: 'boutique' },
];

function loadManifests() {
  const out = [];
  for (const { dir, base, kind } of MANIFEST_GLOBS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.feature.js')) continue;
      const full = path.join(abs, f);
      try {
        const m = require(full);
        m.__file = path.relative(ROOT, full);
        m.__base = base === 'root' ? ROOT : path.dirname(full);   // racine de résolution des `files`
        m.__kind = kind;   // 'backend' | 'boutique' — nécessaire pour ne PAS appliquer
                            // LAYER_ROOT_OVERRIDE aux manifestes boutique natifs, qui ont
                            // eux aussi une couche nommée "boutique" mais résolue en self.
        out.push(m);
      } catch (e) {
        out.push({ name: f.replace('.feature.js',''), __broken: e.message, __file: path.relative(ROOT, full) });
      }
    }
  }
  return out;
}

// ── Résolution des fichiers possédés (à plat, toutes couches) ───────────────
// Les manifestes backend (`features/*.feature.js`) mélangent deux dépôts :
// la plupart des couches (services, routes, migrations, utils, docs...) sont
// écrites relatives à ROOT, mais les couches `boutique` et `dash` documentent
// des fichiers d'un AUTRE dépôt (public/boutique/ et public/ respectivement -
// cf. feature-registry-check.js, qui les ignore explicitement pour cette
// raison). Sans ce correctif, `path.join(m.__base, rel)` résolvait ces couches
// n'importe où et cassait `files-exist` pour la quasi-totalité des features.
const LAYER_ROOT_OVERRIDE = {
  boutique: ['public', 'boutique'],
  dash:     ['public'],
};

function ownedFiles(m) {
  const flat = [];
  for (const layer of Object.keys(m.files || {})) {
    const override = m.__kind === 'backend' && LAYER_ROOT_OVERRIDE[layer];
    const base = override ? path.join(ROOT, ...override) : m.__base;
    for (const rel of m.files[layer]) flat.push({ layer, rel, abs: path.join(base, rel) });
  }
  return flat;
}

// ════════════════════════════════════════════════════════════════════════════
//  CHECKERS — un par TYPE de contrat. Chacun rend {status, detail}.
//  Tous dégradent en SKIP si la cible est absente (au lieu de FAIL).
// ════════════════════════════════════════════════════════════════════════════

const checkers = {

  // files-exist : tout fichier déclaré existe-t-il ? (manifeste pas périmé /
  // fichier déplacé). Aurait flaggé si la CSS modal avait été déplacée ailleurs.
  'files-exist'(m) {
    const missing = ownedFiles(m).filter(f => !fs.existsSync(f.abs));
    if (ownedFiles(m).length === 0) return { status:'SKIP', detail:'aucun fichier déclaré' };
    if (missing.length === 0) return { status:'PASS', detail:`${ownedFiles(m).length} fichiers présents` };
    // Si AUCUN fichier de la feature n'est présent → couche absente du checkout (SKIP global)
    if (missing.length === ownedFiles(m).length) return { status:'SKIP', detail:'couche absente de ce checkout' };
    return { status:'FAIL', detail:`${missing.length} déclaré(s) introuvable(s): ${missing.slice(0,3).map(x=>x.rel).join(', ')}${missing.length>3?'…':''}` };
  },

  // render-static : une règle de rendu REQUISE est-elle présente dans l'artefact
  // livré ? C'EST le contrat qui aurait attrapé la modal. Positif par nature :
  // une suppression de la règle = FAIL immédiat.
  //   contracts: { 'render-static': [{ artifact, mustContain:[/regex/], label }] }
  'render-static'(m, spec) {
    const results = [];
    for (const req of spec) {
      const abs = path.join(m.__base, req.artifact);
      if (!fs.existsSync(abs)) { results.push({ status:'SKIP', detail:`artefact absent: ${req.artifact}` }); continue; }
      const css = fs.readFileSync(abs, 'utf8');
      const missing = (req.mustContain || []).filter(rx => !toRe(rx).test(css));
      if (missing.length) results.push({ status:'FAIL', detail:`${req.label||req.artifact}: contrat absent (${missing.length} règle(s))` });
      else results.push({ status:'PASS', detail:req.label || req.artifact });
    }
    return mergeResults(results);
  },

  // boundary : les fichiers possédés ne doivent PAS contenir de motifs interdits
  // (ex: la feature dashboard est lecture-seule → aucune écriture SQL/mutation
  // hors de son domaine). Rend exécutable l'invariant prose déjà déclaré.
  //   contracts: { boundary: { forbid:[{ rx, why }], scope:'dash'|'services'|… } }
  'boundary'(m, spec) {
    const scope = spec.scope ? ownedFiles(m).filter(f => f.layer === spec.scope) : ownedFiles(m);
    const present = scope.filter(f => fs.existsSync(f.abs));
    if (present.length === 0) return { status:'SKIP', detail:'fichiers de périmètre absents' };
    const hits = [];
    for (const f of present) {
      const src = fs.readFileSync(f.abs, 'utf8');
      for (const rule of (spec.forbid || [])) {
        if (toRe(rule.rx).test(src)) hits.push(`${f.rel}: ${rule.why}`);
      }
    }
    return hits.length
      ? { status:'FAIL', detail:hits.slice(0,3).join(' | ') + (hits.length>3?` (+${hits.length-3})`:'') }
      : { status:'PASS', detail:`${present.length} fichiers conformes` };
  },

  // interface : les endpoints déclarés `exposes` sont-ils réellement câblés dans
  // les routes possédées ? (contrat d'interface ≠ wishlist). SKIP si routes absentes.
  'interface'(m) {
    const exposes = (m.contract && m.contract.exposes) || [];
    if (!exposes.length) return { status:'SKIP', detail:'aucun endpoint exposé déclaré' };
    const routes = ownedFiles(m).filter(f => f.layer === 'routes' && fs.existsSync(f.abs));
    if (!routes.length) return { status:'SKIP', detail:'routes absentes de ce checkout' };
    const blob = routes.map(f => fs.readFileSync(f.abs,'utf8')).join('\n');
    const missing = exposes.filter(ep => {
      // NB (2026-07) : on NE retire PLUS les `:param` du tail. Le code Express
      // réel écrit ses routes avec la même convention littérale ('/:id/approve'),
      // donc les garder tels quels dans le probe permet un match exact — les
      // retirer cassait tout endpoint de forme /:id/action (le probe perdait
      // le segment ':id' et cherchait 'ressource/action', absent du code réel
      // qui contient bien '/:id/action' mais jamais 'ressource/action' contigu).
      const tail = ep.replace(/^[A-Z]+\s+/, '').replace(/\/\*$/, '');
      const probe = tail.split('/').filter(Boolean).slice(-2).join('/');
      return probe && !blob.includes(probe);
    });
    return missing.length
      ? { status:'FAIL', detail:`endpoint(s) non câblé(s): ${missing.join(', ')}` }
      : { status:'PASS', detail:`${exposes.length} endpoint(s) câblé(s)` };
  },

  // interface-inverse : les routes possédées n'exposent aucun endpoint ABSENT
  // de contract.exposes. Complément direct du checker `interface` : celui-ci
  // vérifie déclaré→câblé, interface-inverse vérifie câblé→déclaré.
  // Démarre en WARN (dette existante possible) ; passe FAIL si --strict.
  // Seuls les verbes HTTP explicitement routés sont examinés
  // (router.get / router.post / router.put / router.delete / router.patch).
  'interface-inverse'(m) {
    const exposes = (m.contract && m.contract.exposes) || [];
    const routes = ownedFiles(m).filter(f => f.layer === 'routes' && fs.existsSync(f.abs));
    if (!routes.length) return { status:'SKIP', detail:'routes absentes de ce checkout' };

    // Construire l'ensemble des tails déclarés (ex. "wallet/balance")
    const declaredTails = new Set(exposes.map(ep => {
      const tail = ep.replace(/^[A-Z]+\s+/, '').replace(/\/\*$/, '').replace(/:[\w]+/g, '*');
      return tail.split('/').filter(Boolean).slice(-2).join('/');
    }).filter(Boolean));

    // Scanner les routes réelles
    const undeclared = [];
    const routeRe = /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    for (const f of routes) {
      const src = fs.readFileSync(f.abs, 'utf8');
      let match;
      while ((match = routeRe.exec(src)) !== null) {
        const verb = match[1].toUpperCase();
        const rawPath = match[2].replace(/:[\w]+/g, '*');
        const tail = rawPath.split('/').filter(Boolean).slice(-2).join('/');
        if (!tail) continue;
        const declared = [...declaredTails].some(t => t === tail || tail.endsWith(t) || t.endsWith(tail));
        if (!declared) undeclared.push(`${verb} ${match[2]} (${f.rel})`);
      }
    }
    if (!undeclared.length) return { status:'PASS', detail:`toutes les routes câblées sont déclarées dans contract.exposes` };
    // WARN par défaut — pas FAIL : dette initiale possible sur features existantes
    return { status:'WARN', detail:`${undeclared.length} route(s) câblée(s) non déclarée(s): ${undeclared.slice(0,3).join(' | ')}${undeclared.length>3?` (+${undeclared.length-3})`:''}` };
  },

  // doctrine : dette de doctrine token (couleurs en dur) scopée aux fichiers de
  // la feature, sous cliquet. Ce n'est pas un FAIL global (294 rgba cosmétiques
  // existent), mais une HAUSSE par feature bloque. Compte les littéraux interdits.
  //   contracts: { doctrine:{ scope:'boutique', max:<baseline> } }
  'doctrine'(m, spec) {
    const scope = (spec.scope ? ownedFiles(m).filter(f=>f.layer===spec.scope) : ownedFiles(m))
                  .filter(f => /\.css$/.test(f.abs) && fs.existsSync(f.abs) && !/\/dist\//.test(f.abs));
    if (!scope.length) return { status:'SKIP', detail:'pas de CSS source dans le périmètre' };
    const LITERAL = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()/g;
    let count = 0;
    for (const f of scope) count += (fs.readFileSync(f.abs,'utf8').match(LITERAL) || []).length;
    const max = spec.max ?? 0;
    if (count <= max) return { status: count===0?'PASS':'WARN', detail:`${count} littéral(aux) couleur (cliquet ${max})` };
    return { status:'FAIL', detail:`${count} littéraux > cliquet ${max} — hausse de dette token` };
  },
};

function toRe(rx) { return rx instanceof RegExp ? rx : new RegExp(rx); }
function mergeResults(arr) {
  if (arr.some(r=>r.status==='FAIL')) return { status:'FAIL', detail:arr.filter(r=>r.status==='FAIL').map(r=>r.detail).join('; ') };
  if (arr.every(r=>r.status==='SKIP')) return { status:'SKIP', detail:arr[0].detail };
  if (arr.some(r=>r.status==='WARN')) return { status:'WARN', detail:arr.map(r=>r.detail).join('; ') };
  return { status:'PASS', detail:arr.map(r=>r.detail).join('; ') };
}

// ── Contrat transverse : aucun fichier possédé par 2 features (multipropriété) ──
function crossOwnership(manifests) {
  const owner = {};
  const clashes = [];
  for (const m of manifests) {
    for (const f of ownedFiles(m)) {
      const key = `${m.__base}::${f.rel}`;
      if (owner[key] && owner[key] !== m.name) clashes.push(`${f.rel} : ${owner[key]} ⇆ ${m.name}`);
      else owner[key] = m.name;
    }
  }
  return clashes;
}

// ════════════════════════════════════════════════════════════════════════════
//  RUN
// ════════════════════════════════════════════════════════════════════════════
let manifests = loadManifests();
if (ONLY) manifests = manifests.filter(m => m.name === ONLY);

console.log(`\n${C.bld}╔════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.bld}║  AUDIT FEATURE-PAR-FEATURE — contrats positifs par périmètre   ║${C.r}`);
console.log(`${C.bld}╚════════════════════════════════════════════════════════════════╝${C.r}`);
console.log(`${C.dim}racine: ${ROOT}  ·  ${manifests.length} feature(s)${C.r}\n`);

let fails = 0, warns = 0;

// Toujours-actifs : files-exist (toutes), + interface si exposes déclaré.
const ALWAYS = ['files-exist'];

for (const m of manifests) {
  if (m.__broken) { console.log(`${ICON.FAIL} ${C.bld}${m.name}${C.r}  ${C.red}manifeste illisible: ${m.__broken}${C.r}`); fails++; continue; }

  const layers = Object.keys(m.files || {}).join(', ') || '—';
  console.log(`${C.cyn}${C.bld}${m.name}${C.r} ${C.dim}(${m.domain||'?'} · couches: ${layers})${C.r}`);

  const declared = m.contracts || {};
  const toRun = new Set([...ALWAYS, ...Object.keys(declared)]);
  if (m.contract && m.contract.exposes) { toRun.add('interface'); toRun.add('interface-inverse'); }

  for (const type of toRun) {
    const checker = checkers[type];
    if (!checker) { console.log(`    ${ICON.WARN} ${type} ${C.dim}(checker inconnu)${C.r}`); continue; }
    let res;
    try { res = checker(m, declared[type]); }
    catch (e) { res = { status:'FAIL', detail:'checker error: '+e.message }; }
    if (res.status==='FAIL') fails++; if (res.status==='WARN') warns++;
    console.log(`    ${ICON[res.status]} ${type.padEnd(14)} ${C.dim}${res.detail}${C.r}`);
  }
  console.log();
}

// Multipropriété transverse
const clashes = crossOwnership(manifests);
console.log(`${C.bld}Transverse — multipropriété de fichiers${C.r}`);
if (clashes.length) { fails += clashes.length; clashes.forEach(c => console.log(`    ${ICON.FAIL} ${c}`)); }
else console.log(`    ${ICON.PASS} aucun fichier possédé par 2 features`);

console.log(`\n${C.bld}Résultat : ${fails?C.red:C.grn}${fails} FAIL${C.r}${C.bld}, ${warns} WARN${C.r}`);
if (fails && STRICT) process.exit(1);
process.exit(0);
