/**
 * @komerce-arch
 * @role          feature-first-fact-extractor
 * @domain        infrastructure
 * @layer         test-lib
 * @criticality   critical
 * @inputs        features/*.feature.js, capabilities/*.capability.js, arbre source backend
 * @outputs       graphe de faits Feature First (ownership, arêtes, contrats, données)
 * @depends       governance/composition-root-files.json
 * @db-write      none
 * @db-read       none
 * @used-by       scripts/feature-first-conformance.js
 * @doctrine      feature_first, niveau_0
 * @version       2026-07
 *
 * @brief  Noyau de la suite de conformité Feature First.
 *
 * Ce module ne juge rien. Il ne fait qu'UNE chose : lire le disque et produire
 * un graphe de faits. Tout le jugement est dans les specs (`*.test.js`) et dans
 * `baseline.json`. Cette séparation est volontaire : on peut regarder les faits
 * (`node scripts/feature-first-conformance.js --facts`) sans exécuter un seul verdict.
 *
 * Zéro dépendance externe — tourne avec un node nu, sans `npm ci`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// ── Périmètre ──────────────────────────────────────────────────────────────
// Volontairement PLUS LARGE que SOURCE_DIRS de feature-registry-check.js :
// cette suite est le contrôle indépendant, elle ne doit pas hériter des angles
// morts du gate qu'elle vérifie. `config`, `schemas`, `data` et la racine sont
// inclus ici alors qu'ils sont absents du gate de Niveau 0.
const OWNED_DIRS = [
  'services', 'routes', 'middleware', 'utils', 'validators',
  'core', 'bootstrap', 'db', 'config', 'schemas', 'data',
];

// Groupes de `files:` d'un manifest qui désignent du code backend vérifiable ici.
// Les groupes cross-dépôt (`boutique`, `dash`, `js`, `css`) sont gouvernés par
// l'outillage de leur propre dépôt — décision actée dans la certification du
// 2026-06-26, §"Décision à acter (Réserve 2)".
const BACKEND_GROUPS = new Set([
  'services', 'routes', 'middleware', 'utils', 'validators',
  'core', 'bootstrap', 'db', 'config', 'schemas', 'data',
  'migrations', 'tests', 'scripts', 'ci',
]);

// Sous-ensemble des groupes qui participent au graphe de dépendances runtime.
// `tests` et `scripts` sont possédés mais ne sont pas du runtime : une arête
// depuis un test ne dit rien de la frontière de production.
const RUNTIME_GROUPS = new Set([
  'services', 'routes', 'middleware', 'utils', 'validators',
  'core', 'bootstrap', 'db', 'config',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'public', 'docs', '.agent', 'coverage',
  'playwright-report', 'test-results', 'dist', '.github',
]);

const CODE_EXT = /\.(js|mjs|cjs)$/;

// Dossiers dont les artefacts .json ne sont PAS de la configuration d'outillage
// mais des contrats de données (schémas JSON, profils d'import, jeux de
// référence). Ils portent du sens métier : ils doivent appartenir à une feature
// au même titre qu'un service. C'est le point où cette suite est plus stricte
// que `feature-registry-check.js`, qui ne regarde que le `.js`.
const DATA_CONTRACT_DIRS = ['schemas', 'config', 'data'];
const DATA_EXT = /\.(json|sql)$/;

// ── Chargement des manifests ───────────────────────────────────────────────

function loadManifestDir(dir, suffix) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs)
    .filter(f => f.endsWith(suffix) && !f.startsWith('_'))
    .map(f => {
      const full = path.join(abs, f);
      try {
        // `require` volontaire : un manifest est du code, pas du JSON. S'il ne
        // charge pas, c'est un fait à remonter, pas une exception à avaler.
        const m = { ...require(full) };
        m._file = `${dir}/${f}`;
        return m;
      } catch (e) {
        return { _file: `${dir}/${f}`, _loadError: e.message };
      }
    });
}

// ── Parcours disque ────────────────────────────────────────────────────────

function walk(rel) {
  const out = [];
  const abs = path.join(ROOT, rel || '.');
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const r = rel ? `${rel}/${entry}` : entry;
    let st;
    try { st = fs.statSync(path.join(ROOT, r)); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(r));
    else out.push(r);
  }
  return out;
}

// ── Résolution des require() relatifs ──────────────────────────────────────

function resolveRelative(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  for (const cand of [base, `${base}.js`, path.join(base, 'index.js')]) {
    try {
      if (fs.statSync(cand).isFile()) {
        return path.relative(ROOT, cand).split(path.sep).join('/');
      }
    } catch { /* pas ce candidat */ }
  }
  return null;
}

function requiresOf(file) {
  const abs = path.join(ROOT, file);
  let src;
  try { src = fs.readFileSync(abs, 'utf8'); } catch { return []; }
  const out = [];
  const rx = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = rx.exec(src)) !== null) {
    const target = resolveRelative(file, m[1]);
    if (target) out.push(target);
  }
  return out;
}

// ── Normalisation des noms de features ─────────────────────────────────────
// Les `contract.consumes` sont de la prose ("wallet (application credit)") et
// utilisent parfois le singulier historique. On normalise pour comparer, jamais
// pour réécrire : la prose reste la prose, c'est elle que lit un humain.
const CONSUMES_ALIAS = {
  payment: 'payments',
  notification: 'notifications',
  order: 'orders',
  refund: 'refunds',
  document: 'documents',
};

function normFeature(n) {
  const k = String(n || '').trim().toLowerCase();
  return CONSUMES_ALIAS[k] || k;
}

function parseConsumes(raw) {
  // "loyalty (remise palier au checkout + ...)" → "loyalty"
  return normFeature(String(raw).trim().split(/[\s(,/]/)[0]);
}

// ── Construction du graphe ─────────────────────────────────────────────────

function buildGraph() {
  const features = loadManifestDir('features', '.feature.js');
  const capabilities = loadManifestDir('capabilities', '.capability.js');
  const manifests = [...features, ...capabilities];
  const valid = manifests.filter(m => !m._loadError);

  const compositionRoots = new Set(
    readJson('governance/composition-root-files.json', { wiringFiles: [] }).wiringFiles
  );

  // Exceptions nominatives FF-C2 (arbitrage 2026-07-29) — arêtes précises
  // (from/to/file/target) exemptées avec justification écrite, jamais une
  // feature entière. Voir governance/ff-c2-support-exceptions.json.
  const supportExceptions = new Set(
    readJson('governance/ff-c2-support-exceptions.json', { exceptions: [] }).exceptions
      .map(x => `${x.from}|${x.to}|${x.file}|${x.target}`)
  );

  // ownership : fichier → { feature, group }
  const ownership = new Map();
  const multiOwned = [];
  for (const m of valid) {
    const name = m.name || m._file;
    for (const [group, files] of Object.entries(m.files || {})) {
      if (!BACKEND_GROUPS.has(group) || !Array.isArray(files)) continue;
      for (const raw of files) {
        if (!raw || String(raw).endsWith('/')) continue;
        const f = String(raw).split(path.sep).join('/');
        if (ownership.has(f) && ownership.get(f).feature !== name) {
          multiOwned.push({ file: f, features: [ownership.get(f).feature, name] });
        } else {
          ownership.set(f, { feature: name, group });
        }
      }
    }
  }

  // fichiers réellement présents
  const onDisk = walk('');
  const codeOnDisk = onDisk.filter(f => CODE_EXT.test(f) && !f.includes('package-lock'));

  const inOwnedZone = f => {
    const top = f.includes('/') ? f.split('/')[0] : null;
    if (top === null) return CODE_EXT.test(f); // fichiers de racine (server.js, db.js…)
    if (DATA_CONTRACT_DIRS.includes(top)) return CODE_EXT.test(f) || DATA_EXT.test(f);
    return OWNED_DIRS.includes(top) && CODE_EXT.test(f);
  };

  const auditableOnDisk = onDisk.filter(f => !f.includes('package-lock') && inOwnedZone(f));
  const orphans = auditableOnDisk.filter(f => !ownership.has(f));
  const declaredMissing = [...ownership.keys()]
    .filter(f => BACKEND_ZONE(f))
    .filter(f => !fs.existsSync(path.join(ROOT, f)));

  // arêtes runtime inter-features
  const edges = [];
  const externalTargets = new Map();
  for (const [file, { feature, group }] of ownership) {
    if (!RUNTIME_GROUPS.has(group)) continue;
    if (!fs.existsSync(path.join(ROOT, file))) continue;
    for (const target of requiresOf(file)) {
      const owner = ownership.get(target);
      if (!owner) {
        externalTargets.set(target, (externalTargets.get(target) || 0) + 1);
        continue;
      }
      if (owner.feature === feature) continue;
      edges.push({ from: feature, to: owner.feature, file, target });
    }
  }

  // classification des arêtes
  const consumesOf = new Map();
  for (const m of valid) {
    consumesOf.set(
      m.name || m._file,
      new Set((((m.contract || {}).consumes) || []).map(parseConsumes))
    );
  }

  const classified = { declared: [], wiring: [], ambient: [], undeclared: [] };
  for (const e of edges) {
    const declared = consumesOf.get(e.from) || new Set();
    if ([...declared].some(d => normFeature(d) === normFeature(e.to))) classified.declared.push(e);
    else if (compositionRoots.has(e.file)) classified.wiring.push(e);
    else if (e.to === 'infrastructure') classified.ambient.push(e);
    else classified.undeclared.push(e);
  }

  // tables et écrivains
  const writers = new Map();
  const readers = new Map();
  for (const m of valid) {
    for (const raw of ((m.db || {}).tables) || []) {
      const [table, mode = ''] = String(raw).split(':').map(s => s.trim());
      const bag = /W/.test(mode) ? writers : readers;
      if (!bag.has(table)) bag.set(table, []);
      bag.get(table).push(m.name || m._file);
    }
  }
  const multiWriterTables = [...writers.entries()]
    .filter(([, fl]) => new Set(fl).size > 1)
    .map(([table, fl]) => ({ table, features: [...new Set(fl)].sort() }))
    .sort((a, b) => b.features.length - a.features.length || a.table.localeCompare(b.table));

  // routes montées par le composition root
  const mounted = parseMountedRoutes();

  return {
    ROOT,
    manifests, features, capabilities, valid,
    compositionRoots,
    supportExceptions,
    ownership, multiOwned,
    onDisk, codeOnDisk, auditableOnDisk, orphans, declaredMissing,
    edges, classified, externalTargets,
    consumesOf,
    writers, readers, multiWriterTables,
    mounted,
    pairsOf,
  };
}

// Un chemin déclaré appartient-il au périmètre que ce dépôt peut vérifier ?
// (exclut les chemins cross-dépôt du type `js/b-modal.js` ou `dash/...`)
function BACKEND_ZONE(f) {
  const top = f.includes('/') ? f.split('/')[0] : '(root)';
  return top === '(root)'
    || OWNED_DIRS.includes(top)
    || ['migrations', 'tests', 'scripts', 'features', 'capabilities', 'governance'].includes(top);
}

function pairsOf(edgeList) {
  const map = new Map();
  for (const e of edgeList) {
    const k = `${e.from} -> ${e.to}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(`${e.file} -> ${e.target}`);
  }
  return map;
}

function parseMountedRoutes() {
  const file = 'bootstrap/api-routes.js';
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) return [];
  const src = fs.readFileSync(abs, 'utf8');
  const consts = new Map(); // varName → routes/xxx.js
  const rxConst = /(?:const|let)\s+(\w+)\s*=\s*require\(\s*['"](\.\.\/routes\/[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = rxConst.exec(src)) !== null) {
    const resolved = resolveRelative(file, m[2]);
    if (resolved) consts.set(m[1], resolved);
  }
  const out = [];
  const rxUse = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)/g;
  while ((m = rxUse.exec(src)) !== null) {
    out.push({ mountPath: m[1], varName: m[2], file: consts.get(m[2]) || null });
  }
  return out;
}

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { return fallback; }
}

// ── Baseline (cliquet) ─────────────────────────────────────────────────────
// Doctrine de cliquet, identique à css-guard / check-important : on fige l'état
// réel, une HAUSSE bloque, une BAISSE est acceptée et doit être re-figée. On ne
// bloque jamais sur la dette existante ; on interdit qu'elle grossisse.

const BASELINE_PATH = path.join(__dirname, '..', 'ratchets.json');

function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); }
  catch { return null; }
}

function saveBaseline(obj) {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

module.exports = {
  ROOT,
  OWNED_DIRS,
  BACKEND_GROUPS,
  RUNTIME_GROUPS,
  buildGraph,
  normFeature,
  parseConsumes,
  pairsOf,
  readJson,
  loadBaseline,
  saveBaseline,
  BASELINE_PATH,
};
