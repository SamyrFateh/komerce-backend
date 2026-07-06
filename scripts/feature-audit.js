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

// ── Route registry (docs/_generated/route-registry.json) ───────────────────
// Généré par scripts/gen-route-registry.js à partir de server.js et
// bootstrap/api-routes.js (traversée récursive des app.use / router.use).
// C'est la table de vérité que le checker `interface` consulte : plus de
// recherche de sous-chaîne locale à un fichier routes/.
let __registryCache;
function loadRouteRegistry() {
  if (__registryCache !== undefined) return __registryCache;
  const p = path.join(ROOT, 'docs/_generated/route-registry.json');
  if (!fs.existsSync(p)) { __registryCache = null; return null; }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    __registryCache = data.routes || [];
  } catch (e) { __registryCache = null; }
  return __registryCache;
}

function splitPath(p) { return p.split('/').filter(Boolean); }

// Une entrée `contract.exposes` s'écrit "GET /api/orders" ou, pour plusieurs
// verbes sur le même chemin, "GET/POST /api/orders".
function parseExposeEntry(raw) {
  const s = raw.trim().replace(/\s+/g, ' ');
  const m = /^([A-Z]+(?:\/[A-Z]+)*)\s+(\/\S*)$/.exec(s);
  if (!m) return null;
  const methods = m[1].split('/');
  const rawPath = m[2].replace(/\/\*$/, '');
  return { raw, methods, path: rawPath, segments: splitPath(rawPath) };
}

function isParamSeg(seg) { return seg.startsWith(':'); }

// Deux chemins ont la « même structure » si, segment par segment, chaque
// paramètre est en face d'un paramètre (peu importe son nom) et chaque
// segment statique est identique.
function sameStructure(aSegs, bSegs) {
  if (aSegs.length !== bSegs.length) return false;
  return aSegs.every((seg, i) => (isParamSeg(seg) && isParamSeg(bSegs[i])) || seg === bSegs[i]);
}

function samePrefix(aSegs, bSegs) {
  const n = Math.min(aSegs.length, bSegs.length);
  for (let i = 0; i < n; i++) {
    const a = aSegs[i], b = bSegs[i];
    if (isParamSeg(a) && isParamSeg(b)) continue;
    if (a !== b) return i; // longueur du préfixe statique commun
  }
  return n;
}

// Compare une entrée `exposes` déclarée à la table réelle et rend un
// diagnostic typé : OK | MOUNT_NOT_FOUND | MISSING_ROUTE | METHOD_MISMATCH |
// PARAM_NAME_MISMATCH.
function matchAgainstRegistry(declared, registry) {
  const structural = registry.filter(r => sameStructure(declared.segments, splitPath(r.fullPath)));

  if (structural.length) {
    const methodHit = structural.find(r => declared.methods.includes(r.method));
    if (methodHit) {
      const realSegs = splitPath(methodHit.fullPath);
      const paramMismatch = declared.segments.some((seg, i) => isParamSeg(seg) && isParamSeg(realSegs[i]) && seg !== realSegs[i]);
      if (paramMismatch) {
        return { code:'PARAM_NAME_MISMATCH', detail:`déclaré ${declared.path} vs réel ${methodHit.fullPath}` };
      }
      return { code:'OK' };
    }
    const realMethods = [...new Set(structural.map(r => r.method))].join(',');
    return { code:'METHOD_MISMATCH', detail:`${declared.methods.join('/')} déclaré, réel: ${realMethods} sur ${structural[0].fullPath}` };
  }

  // Aucune route de même structure : mesurer le plus long préfixe statique
  // commun avec N'IMPORTE QUELLE route du registre pour distinguer un
  // mauvais préfixe de montage d'une route simplement jamais livrée.
  let bestPrefix = 0;
  for (const r of registry) {
    const p = samePrefix(declared.segments, splitPath(r.fullPath));
    if (p > bestPrefix) bestPrefix = p;
  }
  if (bestPrefix < Math.min(2, declared.segments.length)) {
    return { code:'MOUNT_NOT_FOUND', detail:`aucune route du registre ne partage le préfixe ${declared.segments.slice(0,2).join('/')}` };
  }
  return { code:'MISSING_ROUTE', detail:'aucune route montée à ce chemin' };
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

  // interface : les endpoints déclarés `contract.exposes` correspondent-ils à
  // une route RÉELLEMENT MONTÉE (docs/_generated/route-registry.json), plutôt
  // qu'à une sous-chaîne trouvée par grep local au fichier ?
  //
  // Historique (AUDIT_FEATURE_FIRST_2026-07-06.md §1.2, §2c) : l'ancienne
  // version faisait une recherche de sous-chaîne dans les fichiers routes/
  // possédés. Deux angles morts en résultaient : (1) aucune route composée à
  // travers bootstrap/api-routes.js + un fichier routes/ n'était validable ;
  // (2) une sous-chaîne peut « trouver » un texte qui n'est pas une route
  // (faux positif) tout en ratant une vraie route au préfixe de montage
  // différent (faux négatif). Le registre remplace le grep par une
  // comparaison structurelle méthode+chemin sur la table de montage réelle.
  //
  // Erreurs typées (voir errorCode dans le detail) :
  //   MOUNT_NOT_FOUND     — aucune route du registre ne partage même le
  //                         préfixe statique du chemin déclaré (mauvais
  //                         préfixe de montage, feature probablement montée
  //                         ailleurs que ce que le manifeste croit).
  //   MISSING_ROUTE       — préfixe correct, mais ce chemin précis n'existe
  //                         nulle part dans le registre (jamais implémenté,
  //                         ou implémenté puis retiré).
  //   METHOD_MISMATCH     — même chemin (structure), mais aucune route du
  //                         registre à ce chemin ne répond au verbe déclaré.
  //   PARAM_NAME_MISMATCH — même chemin, même verbe, mais le nom du paramètre
  //                         diffère (ex: déclaré ':code', réel ':token') —
  //                         inoffensif à l'exécution (Express ne voit que la
  //                         position), mais un contrat qui ment sur le nom
  //                         du paramètre peut induire un consommateur externe
  //                         en erreur (doc, client généré, etc.) : à corriger.
  'interface'(m) {
    const exposes = (m.contract && m.contract.exposes) || [];
    if (!exposes.length) return { status:'SKIP', detail:'aucun endpoint exposé déclaré' };
    const registry = loadRouteRegistry();
    if (!registry) return { status:'SKIP', detail:'route-registry.json absent — lancer scripts/gen-route-registry.js' };

    const fails = [], warns = [];
    for (const raw of exposes) {
      const declared = parseExposeEntry(raw);
      if (!declared) {
        // UNPARSEABLE : l'entrée ne ressemble même pas à "VERBE(S) /chemin"
        // (annotation collée, référence de fonction interne, chemin partiel).
        // C'est une dette de FORMAT du manifeste — réelle, mais distincte
        // d'une contradiction PROUVÉE entre contrat et code. On la reporte
        // en WARN plutôt que FAIL : la corriger pour toutes les features où
        // elle traîne est un chantier de nettoyage séparé (cf. contract.internalApi),
        // pas une conséquence automatique du durcissement du checker `interface`.
        warns.push({ code:'UNPARSEABLE', ep: raw });
        continue;
      }
      const match = matchAgainstRegistry(declared, registry);
      if (match.code !== 'OK') fails.push({ code: match.code, ep: raw, detail: match.detail });
    }

    if (!fails.length && !warns.length) return { status:'PASS', detail:`${exposes.length} endpoint(s) confirmé(s) dans le registre` };
    const fmt = r => `[${r.code}] ${r.ep}${r.detail ? ' — ' + r.detail : ''}`;
    if (fails.length) return { status:'FAIL', detail: fails.map(fmt).join(' | ') + (warns.length ? ` ‖ (+${warns.length} format à nettoyer, cf. internalApi)` : '') };
    return { status:'WARN', detail: `${warns.length} entrée(s) exposes non-HTTP à migrer vers contract.internalApi: ${warns.map(fmt).join(' | ')}` };
  },

  // interface-inverse : les routes réellement montées et rattachées aux
  // fichiers possédés par la feature (via routeFile du registre) sont-elles
  // toutes déclarées dans contract.exposes ? Complément direct du checker
  // `interface` (déclaré→réel) : ici c'est réel→déclaré, sur la même table
  // de vérité. WARN par défaut (dette existante tolérée), pas FAIL.
  'interface-inverse'(m) {
    const exposes = (m.contract && m.contract.exposes) || [];
    const registry = loadRouteRegistry();
    if (!registry) return { status:'SKIP', detail:'route-registry.json absent' };

    const ownedRouteFiles = new Set(ownedFiles(m).filter(f => f.layer === 'routes').map(f => f.rel));
    if (!ownedRouteFiles.size) return { status:'SKIP', detail:'aucune route possédée' };

    const declared = exposes.map(parseExposeEntry).filter(Boolean);
    const mine = registry.filter(r => ownedRouteFiles.has(r.routeFile));

    const undeclared = mine.filter(r => {
      return !declared.some(d => d.methods.includes(r.method) && sameStructure(d.segments, splitPath(r.fullPath)));
    });

    if (!undeclared.length) return { status:'PASS', detail:`${mine.length} route(s) réelle(s) toutes déclarées` };
    const preview = undeclared.slice(0,3).map(r => `${r.method} ${r.fullPath}`).join(' | ');
    return { status:'WARN', detail:`${undeclared.length} route(s) câblée(s) non déclarée(s): ${preview}${undeclared.length>3?` (+${undeclared.length-3})`:''}` };
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

// ── Contrat transverse : un même endpoint RÉEL n'est déclaré `exposes` que
//    par UNE seule feature. Deux manifestes qui revendiquent le même
//    couple (méthode, chemin réel du registre) signalent soit un doublon de
//    déclaration après scission de feature (cf. §1.3 de l'audit du 2026-07-06 :
//    95 fichiers en multipropriété avant correctif), soit deux endpoints
//    distincts qui répondent au même chemin (config de montage à corriger).
function duplicateRouteOwners(manifests) {
  const registry = loadRouteRegistry();
  if (!registry) return [];
  const claims = {}; // "METHOD path" -> [featureName]
  for (const m of manifests) {
    const exposes = (m.contract && m.contract.exposes) || [];
    for (const raw of exposes) {
      const declared = parseExposeEntry(raw);
      if (!declared) continue;
      for (const method of declared.methods) {
        const hit = registry.find(r => r.method === method && sameStructure(declared.segments, splitPath(r.fullPath)));
        if (!hit) continue; // déjà signalé par 'interface' (MISSING_ROUTE etc.)
        const key = `${hit.method} ${hit.fullPath}`;
        (claims[key] = claims[key] || new Set()).add(m.name);
      }
    }
  }
  const dups = [];
  for (const [key, owners] of Object.entries(claims)) {
    if (owners.size > 1) dups.push(`${key} : ${[...owners].join(' ⇆ ')}`);
  }
  return dups;
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

// Multipropriété transverse (fichiers)
const clashes = crossOwnership(manifests);
console.log(`${C.bld}Transverse — multipropriété de fichiers${C.r}`);
if (clashes.length) { fails += clashes.length; clashes.forEach(c => console.log(`    ${ICON.FAIL} ${c}`)); }
else console.log(`    ${ICON.PASS} aucun fichier possédé par 2 features`);

// Multipropriété transverse (endpoints réels — DUPLICATE_ROUTE_OWNER)
const routeDups = duplicateRouteOwners(manifests);
console.log(`${C.bld}Transverse — endpoints réels revendiqués par 2 features (DUPLICATE_ROUTE_OWNER)${C.r}`);
if (routeDups.length) { fails += routeDups.length; routeDups.forEach(c => console.log(`    ${ICON.FAIL} ${c}`)); }
else console.log(`    ${ICON.PASS} aucun endpoint réel revendiqué par 2 features`);

console.log(`\n${C.bld}Résultat : ${fails?C.red:C.grn}${fails} FAIL${C.r}${C.bld}, ${warns} WARN${C.r}`);
if (fails && STRICT) process.exit(1);
process.exit(0);
