#!/usr/bin/env node
'use strict';

/**
 * business-graph-gen.js — Lot O3 : Business Feature Graph & Ownership Bridge.
 *
 *   Construit le pont entre la vérité métier déclarée (features/*.feature.js,
 *   docs/doctrine/APP_FEATURE_REGISTRY.md) et la vérité structurelle observée
 *   (docs/komerce-arch-header-graph.json, docs/contract/openapi.json).
 *
 *   Ne recopie PAS le Technical Architecture Graph : résout les références des
 *   cartes vers les nœuds déjà reconstruits par generate-komerce-arch-graph.js.
 *
 *   Source d'autorité métier (ordre décroissant) :
 *     FEATURE_DOCTRINE > APP_FEATURE_REGISTRY > features/*.feature.js > ce graphe généré
 *
 *   Sorties : docs/BUSINESS_FEATURE_GRAPH.json + docs/BUSINESS_FEATURE_GRAPH.md
 *
 * Usage :
 *   node scripts/business-graph-gen.js              (re)génère
 *   node scripts/business-graph-gen.js --check      cliquet — stale ou référence invalide -> exit 1
 *   node scripts/business-graph-gen.js --boutique-root DIR   racine du SCOPE boutique (répertoire ; défaut ../boutique — voir model.scopeTopology pour la relation de chemin réelle, souvent une sous-arborescence du même dépôt, pas un arbre séparé)
 *   node scripts/business-graph-gen.js --root DIR
 */

const fs = require('fs');
const path = require('path');
// Lot O6 — couche de disposition (qualification/décision) au-dessus des paires O5.
const featureDependencyDisposition = require('./lib/feature-dependency-disposition');
const warningSemantics = require('../governance/business-graph-warning-semantics.js');

// Lot O5-closure (régression O4.1.1) : toute valeur de chemin sérialisée dans
// le JSON/Markdown généré doit utiliser `/`, indépendamment de l'OS qui a
// lancé le générateur. path.relative()/path.join() rendent `\` sous Windows —
// jamais utilisé tel quel dans une sortie sérialisée.
function toPosixPath(value) {
  return String(value).replace(/\\/g, '/');
}

// Lot déterminisme (2026-08) : fs.readdirSync() n'a pas d'ordre portable
// garanti entre filesystems/OS (ext4, APFS, NTFS peuvent renvoyer les
// entrées d'un même répertoire dans des ordres différents). Toute lecture
// de répertoire dont la sortie influence un artefact sérialisé DOIT passer
// par cette primitive plutôt que par fs.readdirSync() directement — voir
// tests/unit/business-graph-determinism.test.js.
// slice() avant sort() : ne mute jamais le tableau renvoyé par fs.readdirSync.
function stableReadDir(dir) {
  return fs.readdirSync(dir).slice().sort();
}

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
function argVal(f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; }

const ROOT = path.resolve(argVal('--root') || path.join(__dirname, '..'));
const BOUTIQUE_ROOT = path.resolve(ROOT, argVal('--boutique-root') || process.env.KOMERCE_BOUTIQUE_ROOT || '../boutique');
// Dépôt `dash` (dashboards admin, hub, relais) — cf. APP_FEATURE_REGISTRY.md
// « Les trois dépôts et leur gouvernance propre ». Absent lors du premier
// passage O1.5/O3, désormais montable comme boutique (sibling dir, override
// possible). Contient DEUX localisations de manifests pour admin-dashboard et
// legacy-control-tower (`dashboards/features/` = canonique, `features/` =
// copie octet-pour-octet documentée — voir registry lignes #19/#22, #20/#23),
// et un manifest `platform` uniquement dans `features/` (pas de copie).
const DASH_ROOT = path.resolve(ROOT, argVal('--dash-root') || process.env.KOMERCE_DASH_ROOT || '../dash');
const DASH_ROOT_MOUNTED = fs.existsSync(DASH_ROOT);
// Lot O4 (cross-repo feature coverage) : le dépôt boutique possède ses PROPRES
// manifests features/*.feature.js (10 à ce jour), jusqu'ici jamais chargés par
// ce générateur — BOUTIQUE_ROOT ne servait qu'à vérifier l'EXISTENCE des
// fichiers déclarés côté backend (files.boutique), pas à lire la déclaration
// boutique elle-même. C'est la cause directe des 10 manifests "hors graphe" et
// d'une partie des 20 orphelins techniques révélés par O3.
const BOUTIQUE_FEATURES_DIR = path.join(BOUTIQUE_ROOT, 'features');
const BOUTIQUE_ROOT_MOUNTED = fs.existsSync(BOUTIQUE_ROOT);
const DASH_CANONICAL_FEATURES_DIR = path.join(DASH_ROOT, 'dashboards', 'features');
const DASH_COPY_FEATURES_DIR = path.join(DASH_ROOT, 'features');
// Divergence déjà documentée (APP_FEATURE_REGISTRY.md ligne #22) entre la copie
// et le canonique pour admin-dashboard : une ligne ClientsView.js en plus dans
// la copie `features/`, non liée à ce lot — tolérée telle quelle, pas une erreur.
const DASH_KNOWN_COPY_DIVERGENCES = {
  'admin-dashboard': [
    "    '../admin/js/ClientsView.js',",
  ],
};
// ─────────────────────────────────────────────────────────────────────────
// Lot O4-2 (point 9) : "cross-repo" dans les livrables O4 précédents
// désignait en réalité un franchissement de SCOPE (frontière de gouvernance
// déclarée : manifests/registre/autorité propres à backend, dash, boutique),
// pas nécessairement un franchissement de dépôt Git séparé. Boutique et dash
// sont des SOUS-RÉPERTOIRES du même arbre que le backend dans la topologie
// courante, pas des checkouts Git distincts. Les flags --dash-root/
// --boutique-root et les variables KOMERCE_DASH_ROOT/KOMERCE_BOUTIQUE_ROOT
// existent pour permettre à ce générateur de fonctionner AUSSI si un jour ces
// scopes vivent ailleurs.
//
// Lot O5-closure (régression O4.1.1) : detectScopeRelation() constate, ne
// suppose jamais — et la présence de `.git` n'est PAS un fait déterministe :
// un clone Git, un ZIP livré sans `.git`, ou un export CI n'ont pas la même
// présence de `.git` pour un même code source. La classification sérialisée
// ne doit donc dériver QUE des chemins configurés (ROOT, DASH_ROOT,
// BOUTIQUE_ROOT) et de leur relation de chemin — jamais de `fs.existsSync`
// sur `.git`. La présence de `.git` peut rester une info de diagnostic
// runtime (non sérialisée dans le modèle) si un jour utile, mais ne doit plus
// influencer `relation`.
function detectScopeRelation(mountPath) {
  if (!fs.existsSync(mountPath)) return { mounted: false, relation: 'not-mounted' };
  const rel = path.relative(ROOT, mountPath);
  const isNestedUnderRoot = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  const relation = isNestedUnderRoot ? 'same-tree-scope' : 'external-path-scope';
  return { mounted: true, relation, isNestedUnderRoot };
}

const DOCS = path.join(ROOT, 'docs');
const FEATURES_DIR = path.join(ROOT, 'features');
const ARCH_GRAPH_FILE = path.join(DOCS, 'komerce-arch-header-graph.json');
const OPENAPI_FILE = path.join(DOCS, 'contract', 'openapi.json');
const OUT_JSON = path.join(DOCS, 'BUSINESS_FEATURE_GRAPH.json');
const OUT_MD = path.join(DOCS, 'BUSINESS_FEATURE_GRAPH.md');
const META_GRAPH_FILE = path.join(DOCS, 'META_GRAPH.json');
// Lot O6 — config, ledger d'exceptions, registre ontologique, inventaire.
const COMPOSITION_ROOT_FILES = path.join(ROOT, 'governance', 'composition-root-files.json');
const EXCEPTIONS_LEDGER_FILE = path.join(ROOT, 'governance', 'feature-dependency-exceptions.json');
const ONTOLOGY_GAPS_FILE = path.join(ROOT, 'governance', 'business-graph-ontology-gaps.json');
const OUT_O6_INVENTORY = path.join(DOCS, 'O6_INVENTORY.md');
const featureDependencyConformance = require('./lib/feature-dependency-conformance.js');

const C = {
  red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m',
  cyn: '\x1b[36m', dim: '\x1b[2m', bld: '\x1b[1m', r: '\x1b[0m',
};

// ─────────────────────────────────────────────────────────────────────────
// 0. Baseline métier O2 (section 2 de la mission O3 / APP_FEATURE_REGISTRY).
//    Utilisée UNIQUEMENT comme repli quand classification.kind est absent
//    d'un manifest (dette ratchet phase 1, cf. feature-classification-check.js).
//    Si classification.kind existe et contredit cette baseline -> DRIFT ERROR.
//    Cette liste n'est pas une nouvelle doctrine : elle reformule en JSON la
//    classification déjà arrêtée par O2 (mission O3 §2), le temps que le
//    backfill de `classification` sur les 13 cartes restantes progresse.
// ─────────────────────────────────────────────────────────────────────────
const O2_BASELINE = {
  'business-feature': [
    'shared-cart', 'orders', 'purchasing', 'payments', 'wallet', 'loyalty',
    'logistics', 'economic-engine', 'catalog', 'sourcing', 'customs',
    'inventory', 'unsold-resolution', 'recommendations', 'auth-identity',
  ],
  'business-transversal': [
    'notifications', 'documents', 'refunds', 'dashboard', 'incident-management',
  ],
  'technical-transversal': [
    'auth', 'platform-ops',
  ],
  'technical-foundation': [
    'infrastructure',
  ],
  'piloting-capability': ['decision-signals'],
  // Section « projection / ui-shell » de la mission — FEATURE_DOCTRINE distingue
  // en interne projection (admin-dashboard) et frontend-transversal (platform) ;
  // les deux restent affichés sous la même vue Markdown "Projections / UI Shells".
  'projection': ['admin-dashboard'],
  'frontend-transversal': ['platform'],
  'deprecated': ['wallet-loyalty', 'legacy-control-tower'],
};
const NAME_TO_BASELINE_KIND = {};
for (const [kind, names] of Object.entries(O2_BASELINE)) {
  for (const n of names) NAME_TO_BASELINE_KIND[n] = kind;
}

// Manifests attendus dans un autre dépôt (dash) non monté dans cet environnement.
const DASH_REPO_NAMES = new Set(['admin-dashboard', 'legacy-control-tower', 'platform']);

// ─────────────────────────────────────────────────────────────────────────
// 1. Chargement des sources
// ─────────────────────────────────────────────────────────────────────────
function loadJSON(f, label, errors) {
  if (!fs.existsSync(f)) {
    errors.push(`Source manquante : ${label} (${toPosixPath(path.relative(ROOT, f))}). Lance le générateur correspondant d'abord.`);
    return null;
  }
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { errors.push(`Source illisible : ${label} — ${e.message}`); return null; }
}

function loadFeatureManifests() {
  const out = [];
  if (!fs.existsSync(FEATURES_DIR)) return out;
  for (const f of stableReadDir(FEATURES_DIR)) {
    if (!f.endsWith('.feature.js') || f.startsWith('_')) continue;
    const full = path.join(FEATURES_DIR, f);
    try {
      delete require.cache[require.resolve(full)];
      const m = require(full);
      m.__file = toPosixPath(path.relative(ROOT, full));
      out.push(m);
    } catch (e) {
      out.push({ name: f.replace(/\.feature\.js$/, ''), __file: toPosixPath(path.relative(ROOT, full)), __broken: e.message });
    }
  }
  return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function loadOneManifest(full, repoRootForCache) {
  delete require.cache[require.resolve(full)];
  return require(full);
}

// Charge les manifests du dépôt `dash`, s'il est monté. Convention observée
// (APP_FEATURE_REGISTRY.md) : `dashboards/features/*.feature.js` est la copie
// canonique pour les manifests qui y vivent (admin-dashboard, legacy-control-
// tower) ; `features/*.feature.js` contient soit une copie octet-pour-octet
// de la précédente (mêmes deux noms), soit un manifest qui n'existe qu'à cet
// emplacement (platform, pas de copie dashboards/). On ne charge chaque nom
// qu'une fois (canonique en priorité), et on vérifie la copie pour divergence
// non documentée.
function loadDashFeatureManifests(warns) {
  const out = [];
  if (!DASH_ROOT_MOUNTED) return out;

  const canonicalNames = new Set();
  if (fs.existsSync(DASH_CANONICAL_FEATURES_DIR)) {
    for (const f of stableReadDir(DASH_CANONICAL_FEATURES_DIR)) {
      if (!f.endsWith('.feature.js') || f.startsWith('_')) continue;
      const full = path.join(DASH_CANONICAL_FEATURES_DIR, f);
      let m;
      try { m = loadOneManifest(full); }
      catch (e) { out.push({ name: f.replace(/\.feature\.js$/, ''), __repo: 'dash', __file: `dash:dashboards/features/${f}`, __broken: e.message }); continue; }
      m.__repo = 'dash';
      m.__file = `dash:${toPosixPath(path.relative(DASH_ROOT, full))}`;
      m.__manifestDir = path.dirname(full);
      out.push(m);
      canonicalNames.add(m.name);
    }
  }

  if (fs.existsSync(DASH_COPY_FEATURES_DIR)) {
    for (const f of stableReadDir(DASH_COPY_FEATURES_DIR)) {
      if (!f.endsWith('.feature.js') || f.startsWith('_')) continue;
      const full = path.join(DASH_COPY_FEATURES_DIR, f);
      const name = f.replace(/\.feature\.js$/, '');
      if (canonicalNames.has(name)) {
        // Copie documentée : vérifier qu'elle ne diverge pas au-delà de ce qui
        // est déjà consigné dans APP_FEATURE_REGISTRY.md pour ce nom.
        const canonicalFull = path.join(DASH_CANONICAL_FEATURES_DIR, f);
        let canonicalSrc, copySrc;
        try { canonicalSrc = fs.readFileSync(canonicalFull, 'utf8'); copySrc = fs.readFileSync(full, 'utf8'); }
        catch (e) { warns.push({ type: 'DASH-MANIFEST-COPY-UNREADABLE', ref: name, msg: e.message }); continue; }
        const canonicalLines = new Set(canonicalSrc.split('\n'));
        const copyLines = copySrc.split('\n');
        const allowed = new Set(DASH_KNOWN_COPY_DIVERGENCES[name] || []);
        const unexpectedExtra = copyLines.filter(l => !canonicalLines.has(l) && !allowed.has(l) && l.trim() !== '');
        if (unexpectedExtra.length) {
          warns.push({
            type: 'DASH-MANIFEST-COPY-DIVERGES', ref: name,
            msg: `"public/features/${f}" diverge de "public/dashboards/features/${f}" au-delà de la divergence déjà documentée (APP_FEATURE_REGISTRY.md) : ${unexpectedExtra.length} ligne(s) inattendue(s)`,
          });
        } else {
          warns.push({
            type: 'DASH-MANIFEST-DUPLICATE-COPY', ref: name,
            msg: `"public/features/${f}" est une copie déclarée de "public/dashboards/features/${f}" (APP_FEATURE_REGISTRY.md) — non chargée comme nœud séparé, résolue uniquement contre le canonique`,
          });
        }
        continue; // ne pas doubler le nœud feature avec la copie
      }
      // Pas de copie canonique pour ce nom (ex. platform) -> seule source.
      let m;
      try { m = loadOneManifest(full); }
      catch (e) { out.push({ name, __repo: 'dash', __file: `dash:features/${f}`, __broken: e.message }); continue; }
      m.__repo = 'dash';
      m.__file = `dash:${toPosixPath(path.relative(DASH_ROOT, full))}`;
      m.__manifestDir = path.dirname(full);
      out.push(m);
    }
  }
  // Lot déterminisme (2026-08) : les entrées de `out` sont déjà dans un ordre
  // déterministe (stableReadDir), mais ce n'est pas un ordre alphabétique
  // GLOBAL par nom (groupe canonique puis groupe copie, concaténés) — tri
  // final pour un artefact byte-for-byte stable, cohérent avec
  // loadFeatureManifests/loadBoutiqueFeatureManifests.
  return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// Charge les manifests du SCOPE `boutique` (Lot O4 — voir model.scopeTopology
// pour la relation de chemin réelle avec ROOT ; ce n'est pas nécessairement un
// arbre séparé). Contrairement à `dash`, pas de duplication connue
// backend-side — un seul dossier `features/`.
// Chaque manifest boutique porte (depuis O4) `canonicalFeature` (nom d'une
// feature backend/dash existante, ou null) et `sliceKind` ('frontend-slice' |
// 'frontend-transversal' | 'ui-orchestration'). Ces manifests ne deviennent
// PAS des nœuds `feature:<name>` : plusieurs noms de manifests boutique
// collisionnent avec des noms de features backend qui désignent une IDENTITÉ
// MÉTIER DIFFÉRENTE (ex. boutique:auth ≠ backend:auth — voir AUDIT_NOTE_O4).
// Namespace dédié : `boutique-manifest:<name>`.
function loadBoutiqueFeatureManifests() {
  const out = [];
  if (!BOUTIQUE_ROOT_MOUNTED || !fs.existsSync(BOUTIQUE_FEATURES_DIR)) return out;
  for (const f of stableReadDir(BOUTIQUE_FEATURES_DIR)) {
    if (!f.endsWith('.feature.js') || f.startsWith('_')) continue;
    const full = path.join(BOUTIQUE_FEATURES_DIR, f);
    const name = f.replace(/\.feature\.js$/, '');
    try {
      const m = loadOneManifest(full);
      m.__repo = 'boutique';
      m.__file = `boutique:${toPosixPath(path.relative(BOUTIQUE_ROOT, full))}`;
      m.__manifestDir = path.dirname(full);
      out.push(m);
    } catch (e) {
      out.push({ name, __repo: 'boutique', __file: `boutique:features/${f}`, __broken: e.message });
    }
  }
  return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

const CAPABILITIES_DIR = path.join(ROOT, 'capabilities');
// Piloting capabilities (docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md) vivent
// dans capabilities/<nom>.capability.js, jamais dans features/ — gouvernance
// volontairement distincte (pas de client, pas de cycle de vie métier, pas
// d'authority). Même forme files:{...}/db:{tables} qu'un manifest feature,
// donc réutilisable telle quelle par le reste du pipeline O3 ; pas de
// `contract` ni `classification.kind` — le kind vient uniquement de la
// baseline O2 (§0, 'piloting-capability').
function loadCapabilityManifests() {
  const out = [];
  if (!fs.existsSync(CAPABILITIES_DIR)) return out;
  for (const f of stableReadDir(CAPABILITIES_DIR)) {
    if (!f.endsWith('.capability.js') || f.startsWith('_')) continue;
    const full = path.join(CAPABILITIES_DIR, f);
    try {
      delete require.cache[require.resolve(full)];
      const m = require(full);
      m.__file = toPosixPath(path.relative(ROOT, full));
      m.__isCapability = true;
      out.push(m);
    } catch (e) {
      out.push({ name: f.replace(/\.capability\.js$/, ''), __file: toPosixPath(path.relative(ROOT, full)), __broken: e.message, __isCapability: true });
    }
  }
  // Lot déterminisme (2026-08) : tri final par nom, cf. loadDashFeatureManifests.
  return out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Résolution de fichiers déclarés -> chemin repo-relatif -> existence disque
//    (même logique que touched-files-feature-gate.js, pour rester une seule
//    source de résolution de chemins entre les deux gates)
// ─────────────────────────────────────────────────────────────────────────
const CATEGORY_PREFIX = { boutique: 'public/boutique', dash: 'public' };

function declaredPath(rel, category) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.endsWith('/')) return null;
  const prefix = CATEGORY_PREFIX[category];
  if (prefix) return `${prefix}/${clean}`;
  return clean;
}

// Un fichier déclaré 'public/boutique/...' vit en réalité dans le dépôt
// boutique séparé (monté ici en --boutique-root, défaut ../boutique).
// Un fichier déclaré 'public/...' (dash, hors boutique) vit dans le dépôt
// dashboards, non monté dans cet environnement -> scope non résolu, pas une
// erreur de gouvernance.
function resolveOnDisk(repoRelPath) {
  if (repoRelPath.startsWith('public/boutique/')) {
    const sub = repoRelPath.slice('public/boutique/'.length);
    const abs = path.join(BOUTIQUE_ROOT, sub);
    if (fs.existsSync(BOUTIQUE_ROOT)) {
      return { exists: fs.existsSync(abs), scope: 'boutique-repo', absPath: abs };
    }
    return { exists: null, scope: 'boutique-repo-not-mounted', absPath: abs };
  }
  if (repoRelPath.startsWith('public/')) {
    const sub = repoRelPath.slice('public/'.length);
    const abs = path.join(DASH_ROOT, sub);
    if (DASH_ROOT_MOUNTED) {
      return { exists: fs.existsSync(abs), scope: 'dash-repo', absPath: abs };
    }
    return { exists: null, scope: 'dash-repo-not-mounted', absPath: abs };
  }
  const abs = path.join(ROOT, repoRelPath);
  return { exists: fs.existsSync(abs), scope: 'backend-repo', absPath: abs };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Résolution des tables : table -> { writers, readers, lifecycleOwner }
// ─────────────────────────────────────────────────────────────────────────
// Marqueur d'ownership par table (gouvernance WRITER-NOT-OWNER, campagne
// 2026-08) : `classification.signals.ownsTables` est un booléen PAR FEATURE
// — il ne peut pas exprimer "je possède la table A mais pas la table B",
// donc dès qu'une table partagée est écrite par deux features qui possèdent
// chacune LEURS propres tables (ex. alerts écrite par notifications ET
// orders ET purchasing, tous ownsTables:true pour d'autres tables), la
// résolution reste structurellement ambiguë quel que soit le contenu réel
// du code. On introduit donc un marqueur PAR ENTRÉE db.tables, écrit à la
// main après vérification du code réel (grep INSERT/UPDATE/DELETE, cf.
// scripts/gen-data-ownership.js) :
//   'table: W!'   -> ce feature est le lifecycle owner déclaré de la table
//   'table: RW~'  -> écriture technique sans décision métier (cron de
//                    purge, simulateur de démo, migration de démarrage —
//                    aucune autorité métier), ne compte jamais comme
//                    "extra writer" concurrent d'un owner déjà résolu
// Le booléen ownsTables + l'ancienne résolution restent le fallback pour
// toute table qui n'a pas encore reçu de marqueur explicite.
//
// Lot déterminisme + gouvernance ~ (2026-08) : extrait vers
// scripts/lib/table-ownership.js pour être testable en isolation (fonction
// pure, aucun accès disque) — voir tests/unit/table-ownership.test.js.
// Ce fichier reste la seule source de la logique ; pas de duplication.
const { parseDbTables, resolveTableOwnership } = require('./lib/table-ownership');

// ─────────────────────────────────────────────────────────────────────────
// 4. Résolution contract.consumes -> nom de feature
//    Convention observée dans tous les manifests : "<feature> (texte libre)"
//    ou juste "<feature>". On prend le préfixe avant la première parenthèse.
// ─────────────────────────────────────────────────────────────────────────
// Une entrée contract.consumes peut nommer un seul nom ('auth'), un nom suivi
// d'un commentaire libre ('wallet (application credit)'), ou une liste de noms
// avant le commentaire ('orders, customs, wallet, refunds (donnees source...)').
// On isole le segment "noms" (avant la 1re parenthèse ou le 1er tiret-cadratin
// de commentaire), puis on éclate sur virgule/slash.
function extractConsumedFeatureNames(entry) {
  let namesSegment = String(entry).split('(')[0];
  namesSegment = namesSegment.split(' — ')[0].split(' - ')[0];
  return namesSegment.split(/[,/]/).map(s => s.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Résolution contract.exposes contre le contrat OpenAPI (x-route-file)
// ─────────────────────────────────────────────────────────────────────────
const normPath = p => p.replace(/[?#].*$/, '')
  .replace(/\{[^}]+\}/g, '{id}')
  .replace(/:[A-Za-z0-9_]+/g, '{id}')
  .replace(/\/+$/, '') || '/';

function buildOpenapiIndex(openapi) {
  const idx = {}; // "METHOD /path" -> routeFile
  if (!openapi || !openapi.paths) return idx;
  for (const [route, methods] of Object.entries(openapi.paths)) {
    const np = normPath(route);
    for (const [method, def] of Object.entries(methods || {})) {
      if (!def) continue;
      const key = `${method.toUpperCase()} ${np}`;
      idx[key] = def['x-route-file'] || null;
    }
  }
  return idx;
}

function parseExposeEntry(entry) {
  const m = String(entry).trim().match(/^([A-Z]+)\s+(\S+)$/);
  if (!m) return null;
  return { method: m[1], path: normPath(m[2]) };
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN BUILD
// ─────────────────────────────────────────────────────────────────────────
function build() {
  const sourceErrors = [];
  const archGraph = loadJSON(ARCH_GRAPH_FILE, 'Technical Architecture Graph', sourceErrors);
  const openapi = loadJSON(OPENAPI_FILE, 'Contrat OpenAPI', sourceErrors);
  if (!archGraph) {
    return { fatal: true, sourceErrors };
  }

  const archNodeById = new Map((archGraph.nodes || []).map(n => [n.id, n]));
  const archFileIds = new Set((archGraph.nodes || []).filter(n => n.type === 'file' || n.type === 'file-lite').map(n => n.id));
  const openapiIndex = buildOpenapiIndex(openapi);

  const errors = [];   // ERROR : bloquant en --check
  const warns = [];    // WARN : dette visible, non bloquante
  const debtO2 = [];   // dette O2 déjà documentée, reportée telle quelle (informative)

  const manifests = loadFeatureManifests();
  const dashManifests = loadDashFeatureManifests(warns);
  const capabilityManifests = loadCapabilityManifests();
  manifests.push(...dashManifests, ...capabilityManifests);
  const manifestNames = new Set(manifests.map(m => m.name).filter(Boolean));

  // Lot O4 : chargé À PART de `manifests` — plusieurs noms de manifests
  // boutique (auth, catalog, shared-cart, wallet, recommendations) collisionnent
  // avec des noms de features backend/dash qui désignent une identité métier
  // différente ou plus large. Les fusionner dans le même Map par nom serait
  // exactement l'erreur que la mission O4 interdit ("ne pas fusionner deux
  // manifests uniquement parce qu'ils portent un nom similaire").
  const boutiqueManifests = loadBoutiqueFeatureManifests();

  // ── 5.1 Nœuds "feature" (business + transversaux + déclarés-seuls) ───────
  const featureNodes = [];
  for (const m of manifests) {
    if (m.__broken) {
      errors.push({ type: 'MANIFEST-LOAD-ERROR', ref: m.__file, msg: `manifest illisible : ${m.__broken}` });
      continue;
    }
    const name = m.name;
    const declaredKind = m.classification && m.classification.kind;
    const baselineKind = NAME_TO_BASELINE_KIND[name] || null;

    let businessKind = declaredKind || baselineKind || 'unclassified';
    let kindSource = declaredKind ? 'manifest.classification.kind' : (baselineKind ? 'O2-baseline (mission O3 §2 / registry)' : 'none');

    if (declaredKind && baselineKind) {
      // aggregation-readonly / integration-adapter sont des raffinements de
      // business-transversal / business-feature dans la doctrine — pas une
      // contradiction en soi. Seule une divergence de FAMILLE est un drift.
      const familyOf = k => (k === 'aggregation-readonly' ? 'business-transversal'
        : k === 'integration-adapter' ? 'business-feature' : k);
      if (familyOf(declaredKind) !== familyOf(baselineKind)) {
        errors.push({
          type: 'CLASSIFICATION-CONTRADICTS-O2-BASELINE', ref: name,
          msg: `manifest.classification.kind="${declaredKind}" contredit la baseline O2 ("${baselineKind}")`,
        });
      }
    }

    featureNodes.push({
      id: `feature:${name}`,
      name,
      file: m.__file,
      legacyType: m.type || null,
      status: m.status || null,
      owner: m.owner || null,
      since: m.since || null,
      service: m.service || m.capability || null,
      businessKind,
      kindSource,
      governedBy: m.__isCapability ? (m.governedBy || 'docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md') : 'docs/doctrine/FEATURE_DOCTRINE.md',
      repo: m.__repo || 'backend',
      declaredOnly: false,
      resolvable: true,
    });
  }

  // Nœuds déclarés dans le registre / la baseline O2 mais sans manifest
  // résolvable dans cet environnement (dépôt dash non monté, ou référence
  // absente de tout registre — cf. decision-signals).
  const REGISTRY_KNOWN_UNRESOLVED_NAMES = new Set(['admin-dashboard', 'legacy-control-tower', 'platform']);
  for (const [name, kind] of Object.entries(NAME_TO_BASELINE_KIND)) {
    if (manifestNames.has(name)) continue;
    const isDashRepo = DASH_REPO_NAMES.has(name);
    featureNodes.push({
      id: `feature:${name}`,
      name,
      file: null,
      legacyType: null,
      status: null,
      owner: null,
      since: null,
      service: null,
      businessKind: kind,
      kindSource: 'O2-baseline (mission O3 §2)',
      declaredOnly: true,
      resolvable: false,
      unresolvedReason: isDashRepo
        ? 'manifest déclaré dans APP_FEATURE_REGISTRY.md sous le dépôt dash (public/dashboards/features ou public/features), non monté dans cet environnement — SCOPE, pas un drift'
        : 'aucun manifest, aucune ligne de registre trouvée pour ce nom dans les sources disponibles — référence de baseline O3 non résolue',
    });
    if (!isDashRepo) {
      errors.push({
        type: 'BASELINE-REFERENCE-UNRESOLVED', ref: name,
        msg: `"${name}" figure dans la baseline O2 (mission O3 §2, "${kind}") mais n'a ni manifest ni ligne dans APP_FEATURE_REGISTRY.md — incohérence O2 à signaler, pas à corriger silencieusement dans O3`,
      });
    } else {
      warns.push({
        type: 'SCOPE-UNRESOLVED-DASH-REPO', ref: name,
        msg: `"${name}" vit dans le dépôt dash (non fourni dans cet environnement) — nœud représenté déclaratif seulement, non résolu contre du code`,
      });
    }
  }

  const featureNodeByName = new Map(featureNodes.map(n => [n.name, n]));

  // ── 5.1b Nœuds "boutique-manifest" + résolution canonicalFeature (Lot O4) ─
  //   Namespace séparé de `feature:` (cf. commentaire au chargement). Un
  //   manifest boutique gouverné doit déclarer explicitement l'un des deux :
  //     - canonicalFeature: '<nom>'   -> doit résoudre contre featureNodeByName
  //     - sliceKind: 'frontend-transversal' avec canonicalFeature: null
  //   Absence des deux = manifest non gouverné (retour à l'état "hors graphe").
  const ALLOWED_SLICE_KINDS = new Set(['frontend-slice', 'frontend-transversal', 'ui-orchestration']);
  const boutiqueManifestNodes = [];
  const implementedInEdges = []; // { canonicalFeature, boutiqueManifest, sliceKind }
  for (const bm of boutiqueManifests) {
    if (bm.__broken) {
      errors.push({ type: 'MANIFEST-LOAD-ERROR', ref: bm.__file, msg: `manifest boutique illisible : ${bm.__broken}` });
      continue;
    }
    const name = bm.name;
    const hasCanonical = Object.prototype.hasOwnProperty.call(bm, 'canonicalFeature');
    const sliceKind = bm.sliceKind || null;
    let governed = false;

    // ── Gouvernance stricte (Lot O4-2 point 6) ──────────────────────────
    // Exactement DEUX formes valides, aucune autre :
    //   (a) canonicalFeature = "<nom>" (non-null), résolu contre une feature
    //       réelle du graphe, ET sliceKind renseigné (les deux ensemble)
    //   (b) canonicalFeature === null (clé présente, valeur explicite) ET
    //       sliceKind === 'frontend-transversal'
    // Toute combinaison partielle (sliceKind seul sans clé canonicalFeature,
    // canonicalFeature sans sliceKind, canonicalFeature=null avec un autre
    // sliceKind...) est une déclaration invalide -> ERROR explicite. La
    // version précédente de ce bloc laissait passer silencieusement
    // sliceKind seul (governed=true sans jamais vérifier canonicalFeature) :
    // c'était exactement le trou que ce point corrige.
    if (!hasCanonical && !sliceKind) {
      warns.push({
        type: 'BOUTIQUE-MANIFEST-UNGOVERNED', ref: name,
        msg: `boutique/features/${name}.feature.js ne déclare ni "canonicalFeature" ni "sliceKind" — manifest hors graphe de couverture cross-scope (O4)`,
      });
    } else if (sliceKind && !ALLOWED_SLICE_KINDS.has(sliceKind)) {
      errors.push({
        type: 'BOUTIQUE-SLICE-KIND-INVALID', ref: name,
        msg: `sliceKind="${sliceKind}" invalide pour boutique:${name} — valeurs autorisées : ${[...ALLOWED_SLICE_KINDS].join(' | ')}`,
      });
    } else if (hasCanonical && bm.canonicalFeature === null) {
      if (sliceKind === 'frontend-transversal') {
        governed = true; // forme (b)
      } else {
        errors.push({
          type: 'CANONICAL-FEATURE-GOVERNANCE-INVALID', ref: name,
          msg: `boutique:${name} déclare canonicalFeature=null avec sliceKind="${sliceKind || '(absent)'}" — la seule combinaison valide pour canonicalFeature=null est sliceKind="frontend-transversal"`,
        });
      }
    } else if (hasCanonical && bm.canonicalFeature) {
      if (!sliceKind) {
        errors.push({
          type: 'CANONICAL-FEATURE-GOVERNANCE-INVALID', ref: name,
          msg: `boutique:${name} déclare canonicalFeature="${bm.canonicalFeature}" sans sliceKind — les deux champs sont requis ensemble (forme (a) exacte)`,
        });
      } else if (!featureNodeByName.has(bm.canonicalFeature)) {
        errors.push({
          type: 'CANONICAL-FEATURE-UNRESOLVED', ref: name,
          msg: `boutique:${name} déclare canonicalFeature="${bm.canonicalFeature}", aucune feature backend/dash de ce nom n'existe dans le graphe`,
        });
      } else {
        implementedInEdges.push({ canonicalFeature: bm.canonicalFeature, boutiqueManifest: name, sliceKind });
        governed = true; // forme (a)
      }
    } else if (!hasCanonical && sliceKind) {
      // sliceKind déclaré seul, sans la clé canonicalFeature du tout (ni
      // valeur ni null explicite) -> ni forme (a) ni forme (b).
      errors.push({
        type: 'CANONICAL-FEATURE-GOVERNANCE-INVALID', ref: name,
        msg: `boutique:${name} déclare sliceKind="${sliceKind}" sans la clé "canonicalFeature" (ni valeur, ni null explicite) — déclaration incomplète, aucune des deux formes valides`,
      });
    }

    boutiqueManifestNodes.push({
      id: `boutique-manifest:${name}`,
      name,
      file: bm.__file,
      repo: 'boutique',
      canonicalFeature: hasCanonical ? bm.canonicalFeature : null,
      sliceKind: sliceKind || null,
      governed,
    });
  }

  // ── 5.2b Bridge BOUTIQUE-MANIFEST -> IMPLEMENTED_BY -> FILE (Lot O4-2 §3/4/5/7) ─
  //   Edge EXPLICITE et VÉRIFIÉE SUR DISQUE, distincte de feature:*->file
  //   ci-dessus (5.2/implementedByEdges) : celle-ci part d'un boutique-manifest,
  //   pas d'une feature canonique (un manifest peut être gouverné en (b) —
  //   frontend-transversal — sans jamais pointer vers une feature).
  //   Un fichier ne sort de l'orphelinat technique QUE si CETTE edge existe
  //   avec exists=true (point 4) — la version précédente ajoutait le chemin
  //   déclaré à l'ensemble "possédé" sans jamais vérifier fs.existsSync
  //   (point 7 corrige ce trou, qui aurait laissé un chemin fantôme masquer
  //   silencieusement un vrai orphelin ou une faute de frappe de chemin).
  const boutiqueImplementedByEdges = [];
  const boutiqueFileOwnerIndex = new Map(); // repoRelPath -> Set(manifestName) — détection multi-owner (point 5)
  for (const bm of boutiqueManifests) {
    if (bm.__broken) continue;
    const name = bm.name;
    for (const [category, files] of Object.entries(bm.files || {})) {
      for (const rel of (files || [])) {
        const clean = String(rel || '').replace(/\\/g, '/');
        if (!clean) continue;
        const abs = path.resolve(bm.__manifestDir, clean);
        const relToBoutiqueRoot = toPosixPath(path.relative(BOUTIQUE_ROOT, abs));
        if (relToBoutiqueRoot.startsWith('..')) continue; // hors scope boutique, ignore — pas une edge de ce namespace
        const repoRelPath = `public/boutique/${relToBoutiqueRoot}`;
        const exists = fs.existsSync(abs); // point 7 — vérification réelle sur disque, plus de confiance aveugle
        const status = exists ? 'resolved-on-disk' : 'missing-on-disk';

        boutiqueImplementedByEdges.push({ boutiqueManifest: name, category, declared: rel, resolvedPath: repoRelPath, exists, status });

        if (!exists) {
          errors.push({
            type: 'BOUTIQUE-FILE-DECLARED-INEXISTANT', ref: `${name} / ${repoRelPath}`,
            msg: `boutique:${name}.files.${category} déclare "${rel}" -> "${repoRelPath}", introuvable sur disque`,
          });
        } else {
          if (!boutiqueFileOwnerIndex.has(repoRelPath)) boutiqueFileOwnerIndex.set(repoRelPath, new Set());
          boutiqueFileOwnerIndex.get(repoRelPath).add(name);
        }
      }
    }
  }

  // 'public/boutique/...' couverts via une edge boutique-manifest->file
  // VÉRIFIÉE (exists=true) — seule source d'exclusion de l'orphelinat 5.3.
  const boutiqueOwnedRepoPaths = new Set(boutiqueFileOwnerIndex.keys());

  // ── Détection BOUTIQUE-FILE-MULTIPLE-OWNERS (point 5) ───────────────────
  for (const [repoRelPath, owners] of boutiqueFileOwnerIndex.entries()) {
    if (owners.size > 1) {
      warns.push({
        type: 'BOUTIQUE-FILE-MULTIPLE-OWNERS', ref: repoRelPath,
        msg: `"${repoRelPath}" est revendiqué par ${owners.size} manifests boutique (${[...owners].sort().join(', ')}) — ownership ambigu entre manifests boutique, à trancher explicitement`,
      });
    }
  }

  // ── 5.2 Bridge FEATURE -> FILE (IMPLEMENTED_BY) ──────────────────────────
  const implementedByEdges = [];
  const NON_TECH_CATEGORIES = new Set(['migrations', 'tests', 'dash', 'docs', 'ci', 'assets', 'config', 'db', 'scripts', 'boutique']);
  // boutique reste "hors scan technique backend" mais résolu séparément contre
  // le dépôt boutique (cf. resolveOnDisk) — donc pas "hors périmètre", juste
  // "hors scan arch:gen backend".

  for (const m of manifests) {
    if (m.__broken) continue;
    const name = m.name;

    if (m.__repo === 'dash') {
      // Manifest vivant dans le dépôt dash lui-même : les chemins déclarés
      // (ex. '../admin/js/app.js') sont relatifs au dossier du manifest dans
      // CE dépôt, pas au ROOT backend ni à un préfixe public/* — convention
      // distincte des manifests backend qui référencent dash/boutique.
      for (const [category, files] of Object.entries(m.files || {})) {
        for (const rel of (files || [])) {
          const clean = String(rel || '').replace(/\\/g, '/');
          if (!clean) continue;
          const absPath = path.resolve(m.__manifestDir, clean);
          const dashRelPath = toPosixPath(path.relative(DASH_ROOT, absPath));
          const displayPath = `dash:${dashRelPath}`;
          const exists = fs.existsSync(absPath);
          const status = exists ? 'resolved-in-dash-repo' : 'missing-on-disk';
          implementedByEdges.push({ feature: name, category, declared: rel, resolvedPath: displayPath, status });
          if (!exists) {
            errors.push({
              type: 'FILE-DECLARED-INEXISTANT', ref: `${name} / ${displayPath}`,
              msg: `${name}.files.${category} (dash) déclare "${rel}" -> "${displayPath}", introuvable sur disque`,
            });
          }
        }
      }
      continue;
    }

    for (const [category, files] of Object.entries(m.files || {})) {
      for (const rel of (files || [])) {
        const repoRelPath = declaredPath(rel, category);
        if (!repoRelPath) continue;
        const diskInfo = resolveOnDisk(repoRelPath);
        const inArchGraph = archFileIds.has(repoRelPath);
        const outOfArchScanScope = NON_TECH_CATEGORIES.has(category) && category !== 'boutique';

        let status;
        if (diskInfo.scope === 'dash-repo-not-mounted') status = 'scope-unresolved-dash-repo';
        else if (diskInfo.scope === 'boutique-repo-not-mounted') status = 'scope-unresolved-boutique-repo';
        else if (diskInfo.exists === false) status = 'missing-on-disk';
        else if (inArchGraph) status = 'resolved-in-technical-graph';
        else if (outOfArchScanScope) status = 'resolved-on-disk-out-of-arch-scan-scope';
        else if (diskInfo.exists === true) status = 'resolved-on-disk-no-header';
        else status = 'unknown';

        implementedByEdges.push({ feature: name, category, declared: rel, resolvedPath: repoRelPath, status });

        if (status === 'missing-on-disk') {
          errors.push({
            type: 'FILE-DECLARED-INEXISTANT', ref: `${name} / ${repoRelPath}`,
            msg: `${name}.files.${category} déclare "${rel}" -> "${repoRelPath}", introuvable sur disque`,
          });
        }
      }
    }
  }

  // ── 5.3 Orphelins techniques : fichier scanné par arch:gen, sans feature ─
  const filesOwnedByFeature = new Set(implementedByEdges.filter(e => e.status !== 'missing-on-disk').map(e => e.resolvedPath));
  // Lot O4 : un fichier public/boutique/... possédé par un manifest boutique
  // GOUVERNÉ (canonicalFeature résolu, ou sliceKind frontend-transversal) sort
  // de l'orphelinat technique même si le manifest backend ne le liste pas
  // (encore) dans son propre files.boutique — double source d'autorité,
  // convergente par construction (cf. commentaire 5.1b).
  for (const p of boutiqueOwnedRepoPaths) filesOwnedByFeature.add(p);
  const TRANSVERSAL_GLOB_FILE = path.join(ROOT, 'governance', 'transversal-paths.json');
  let transversalGlobs = ['core/', 'bootstrap/', 'middleware/', 'db/', 'db.js'];
  if (fs.existsSync(TRANSVERSAL_GLOB_FILE)) {
    try { transversalGlobs = JSON.parse(fs.readFileSync(TRANSVERSAL_GLOB_FILE, 'utf8')).paths || transversalGlobs; } catch { /* noop */ }
  }
  const orphanTechnicalNodes = [];
  for (const fileId of archFileIds) {
    if (filesOwnedByFeature.has(fileId)) continue;
    if (transversalGlobs.some(g => fileId.startsWith(g))) continue;
    orphanTechnicalNodes.push(fileId);
  }
  orphanTechnicalNodes.sort();
  for (const f of orphanTechnicalNodes) {
    warns.push({ type: 'TECHNICAL-NODE-WITHOUT-BUSINESS-OWNERSHIP', ref: f, msg: `nœud technique "${f}" présent dans le Technical Architecture Graph mais revendiqué par aucune carte feature ni transversal déclaré` });
  }

  // ── 5.4 Tables : writers / readers / lifecycle owner ─────────────────────
  // Logique déplacée vers scripts/lib/table-ownership.js (fonction pure,
  // testée en isolation — voir tests/unit/table-ownership.test.js pour le
  // comportement des marqueurs "!" / "~"). Aucun changement de sortie.
  const { tableOwnership, warns: tableOwnershipWarns } = resolveTableOwnership(manifests);
  for (const w of tableOwnershipWarns) warns.push(w);

  // ── 5.5 Interfaces : exposes / internalApi / consumes ────────────────────
  const exposesEdges = [];
  const internalApiEdges = [];
  const consumesEdges = [];

  for (const m of manifests) {
    if (m.__broken) continue;
    const name = m.name;

    // contract.exposes
    for (const entry of ((m.contract && m.contract.exposes) || [])) {
      const parsed = parseExposeEntry(entry);
      if (!parsed) { warns.push({ type: 'EXPOSE-ENTRY-UNPARSED', ref: `${name} / ${entry}`, msg: 'entrée contract.exposes non parseable (attendu "METHOD /path")' }); continue; }
      const key = `${parsed.method} ${parsed.path}`;
      const routeFile = Object.prototype.hasOwnProperty.call(openapiIndex, key) ? openapiIndex[key] : undefined;
      let status;
      if (routeFile === undefined) status = 'not-in-openapi-contract';
      else if (!routeFile) status = 'in-contract-no-route-file';
      else {
        const declaredRoutes = (m.files && m.files.routes) || [];
        const ownsFile = declaredRoutes.some(r => declaredPath(r, 'routes') === routeFile);
        status = ownsFile ? 'resolved-owned' : 'resolved-different-owner';
      }
      exposesEdges.push({ feature: name, entry, method: parsed.method, path: parsed.path, routeFile: routeFile || null, status });
      if (status === 'resolved-different-owner') {
        warns.push({ type: 'EXPOSED-ROUTE-OWNER-MISMATCH', ref: `${name} / ${key}`, msg: `contract.exposes déclare "${key}" mais le contrat OpenAPI le résout vers "${routeFile}", non déclaré dans ${name}.files.routes` });
      } else if (status === 'not-in-openapi-contract') {
        warns.push({ type: 'EXPOSED-ROUTE-UNRESOLVED', ref: `${name} / ${key}`, msg: `"${key}" déclaré par ${name} mais absent du contrat OpenAPI généré (docs/contract/openapi.json)` });
      }
    }

    // contract.internalApi — `file` est presque toujours un chemin unique,
    // mais quelques manifests (ex. auth) déclarent une liste "a.js, b.js, c.js"
    // dans le même champ : on résout chaque chemin individuellement.
    for (const entry of ((m.contract && m.contract.internalApi) || [])) {
      // Deux formes observées dans le repo : { fn, file } (majorité des cartes)
      // et une chaîne libre "chemin — description" (infrastructure.feature.js).
      let rawFile, fn;
      if (typeof entry === 'string') {
        rawFile = entry.split(' — ')[0].trim();
        fn = null;
      } else {
        rawFile = entry && entry.file;
        fn = entry && entry.fn;
      }
      if (!rawFile) { warns.push({ type: 'INTERNAL-API-ENTRY-MALFORMED', ref: name, msg: `entrée contract.internalApi sans champ file résoluble : ${JSON.stringify(entry)}` }); continue; }

      // Convention observée dans refunds.feature.js : une signature de fonction
      // bare ("processRefund(orderOrCartId, reason)"), sans " — " ni chemin de
      // fichier ni objet {fn,file} — documente l'API sans prétendre à un
      // fichier résolvable. Détection : pas de '/' (pas un chemin), termine
      // par une parenthèse fermante précédée d'arguments -> signature, pas un
      // chemin. On ne split PAS sur les virgules internes aux parenthèses.
      const looksLikeBareSignature = typeof entry === 'string'
        && !rawFile.includes('/')
        && /^[A-Za-z_$][\w$]*\([^()]*\)$/.test(rawFile);
      if (looksLikeBareSignature) {
        internalApiEdges.push({ feature: name, fn: rawFile, file: null, status: 'documented-signature-no-file' });
        continue;
      }

      const filesList = String(rawFile).split(',').map(s => s.trim()).filter(Boolean);
      for (const file of filesList) {
        // "bootstrap/* — ..." : référence un dossier entier, pas un fichier
        // unique — vérifier l'existence du dossier plutôt qu'un fichier exact.
        const isDirGlob = file.endsWith('/*');
        const target = isDirGlob ? file.slice(0, -2) : file;
        const diskInfo = resolveOnDisk(target);
        let exists = diskInfo.exists;
        if (isDirGlob && diskInfo.absPath) {
          try { exists = fs.statSync(diskInfo.absPath).isDirectory(); } catch { exists = false; }
        }
        const status = exists === false ? 'implementation-unresolved' : (exists === true ? 'resolved' : 'scope-unresolved');
        internalApiEdges.push({ feature: name, fn: fn || null, file, status });
        if (status === 'implementation-unresolved') {
          errors.push({ type: 'INTERNAL-API-IMPLEMENTATION-UNRESOLVED', ref: `${name} / ${file}`, msg: `contract.internalApi déclare "${fn || file}" dans "${file}", ${isDirGlob ? 'dossier' : 'fichier'} introuvable sur disque` });
        }
      }
    }

    // contract.consumes -> FEATURE CONSUMES FEATURE
    for (const entry of ((m.contract && m.contract.consumes) || [])) {
      const candidates = extractConsumedFeatureNames(entry);
      for (const consumedName of candidates) {
        const known = manifestNames.has(consumedName) || NAME_TO_BASELINE_KIND[consumedName];
        consumesEdges.push({ from: name, to: consumedName, raw: entry, resolved: !!known });
        if (!known) {
          warns.push({ type: 'CONSUMES-REFERENCE-UNRESOLVED', ref: `${name} -> "${consumedName}" (entrée: "${entry}")`, msg: `contract.consumes de ${name} référence "${consumedName}", ne correspond à aucun nom de feature connu` });
        }
      }
    }
  }

  // ── 5.6 Feature avec zéro implémentation runtime résolue ─────────────────
  for (const node of featureNodes) {
    if (node.declaredOnly) continue; // déjà couvert par BASELINE-REFERENCE-UNRESOLVED / SCOPE-UNRESOLVED-DASH-REPO
    if (node.businessKind === 'deprecated') continue; // zéro empreinte runtime = état attendu d'une dépréciation terminée, pas un gap
    const ownEdges = implementedByEdges.filter(e => e.feature === node.name);
    const anyResolvedFile = ownEdges.some(e => e.status === 'resolved-in-technical-graph' || e.status === 'resolved-on-disk-out-of-arch-scan-scope' || e.status === 'resolved-on-disk-no-header' || e.status === 'resolved-in-dash-repo');
    const ownsAnyTable = Object.values(tableOwnership).some(t => t.lifecycleOwner === node.name);
    const writesAnyTable = Object.values(tableOwnership).some(t => (t.writers || []).some(w => w.feature === node.name));
    const exposesAny = exposesEdges.some(e => e.feature === node.name);
    if (!anyResolvedFile && !ownsAnyTable && !writesAnyTable && !exposesAny) {
      errors.push({ type: 'FEATURE-ZERO-RUNTIME-IMPLEMENTATION', ref: node.name, msg: `"${node.name}" n'a aucun fichier résolu, aucune table possédée/écrite, aucune route exposée résolue — aucun chemin vers le runtime réel` });
    }
  }

  // ── 5.7 Big Map — couverture cross-repo (Lot O4 §13) ─────────────────────
  const ONTOLOGY_GAPS_FILE = path.join(ROOT, 'governance', 'business-graph-ontology-gaps.json');
  let ontologyGaps = [];
  if (fs.existsSync(ONTOLOGY_GAPS_FILE)) {
    try { ontologyGaps = JSON.parse(fs.readFileSync(ONTOLOGY_GAPS_FILE, 'utf8')).gaps || []; } catch { /* noop */ }
  }

  const backendManifestsOnly = manifests.filter(m => m.__repo !== 'dash' && !m.__isCapability);
  const isBoutiquePath = p => p.startsWith('public/boutique/');
  const boutiqueArchFileIds = [...archFileIds].filter(isBoutiquePath);
  const backendArchFileIds = [...archFileIds].filter(p => !isBoutiquePath(p));
  const boutiqueOrphans = orphanTechnicalNodes.filter(isBoutiquePath);
  const backendOrphans = orphanTechnicalNodes.filter(p => !isBoutiquePath(p));

  const boutiqueManifestsConnected = boutiqueManifestNodes.filter(n => n.governed && (n.canonicalFeature || n.sliceKind === 'frontend-transversal')).length;

  const crossRepoFeatureNames = [...new Set(implementedInEdges.map(e => e.canonicalFeature))].sort();
  const singleRepoFeatureNames = featureNodes
    .filter(n => !n.declaredOnly && !crossRepoFeatureNames.includes(n.name))
    .map(n => n.name).sort();
  const unmappedBoutiqueManifests = boutiqueManifestNodes.filter(n => !n.governed).map(n => n.name);

  const bigMap = {
    perRepo: {
      backend: {
        manifestsDiscovered: backendManifestsOnly.length,
        manifestsConnected: backendManifestsOnly.filter(m => !m.__broken).length,
        technicalNodesTotal: backendArchFileIds.length,
        technicalNodesOwned: backendArchFileIds.length - backendOrphans.length,
        technicalOrphans: backendOrphans.length,
      },
      dash: {
        manifestsDiscovered: dashManifests.length,
        manifestsConnected: dashManifests.filter(m => !m.__broken).length,
        technicalNodesTotal: null,
        technicalNodesOwned: null,
        technicalOrphans: null,
        note: 'pas de Technical Architecture Graph propre au dépôt dash dans ce pipeline — non scanné par arch:gen backend, couverture non mesurable ici (SCOPE, pas un gap)',
      },
      boutique: {
        manifestsDiscovered: boutiqueManifests.length,
        manifestsConnected: boutiqueManifestsConnected,
        technicalNodesTotal: boutiqueArchFileIds.length,
        technicalNodesOwned: boutiqueArchFileIds.length - boutiqueOrphans.length,
        technicalOrphans: boutiqueOrphans.length,
      },
    },
    canonical: {
      crossRepoFeatures: crossRepoFeatureNames,
      singleRepoFeatures: singleRepoFeatureNames,
      unmappedLocalManifests: unmappedBoutiqueManifests,
      ontologyGaps,
      technicalOrphansRemaining: orphanTechnicalNodes.length,
    },
  };

  // ── 5.8 Lot O5 ──────────────────────────────────────────────────────────
  let metaGraph = null;
  if (fs.existsSync(META_GRAPH_FILE)) {
    try { metaGraph = JSON.parse(fs.readFileSync(META_GRAPH_FILE, 'utf8')); }
    catch (e) { sourceErrors.push(`Source illisible : Meta Graph (canal interface O5) — ${e.message}`); }
  } else {
    sourceErrors.push(`Source manquante : docs/META_GRAPH.json (canal interface O5). Lance npm run meta:graph d'abord — le canal interface sera vide sans elle (pas fatal, dégradé).`);
  }

  const o5 = featureDependencyConformance.computeDependencyConformance({
    implementedByEdges, boutiqueManifestImplementedBy: boutiqueImplementedByEdges,
    boutiqueManifestNodes, consumesEdges, ontologyGaps, metaGraph,
    ROOT, DASH_ROOT, BOUTIQUE_ROOT,
  });

  for (const p of o5.pairs) {
    if (p.conformanceStatus !== 'OBSERVED_UNDECLARED') continue;
    const channelNames = p.channels.map(c => c.channel).sort().join('+');
    warns.push({
      type: 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY', ref: `${p.from} -> ${p.to}`,
      msg: `dépendance cross-feature observée (canal: ${channelNames}, ${p.channels.reduce((n, c) => n + c.evidence.length, 0)} preuve(s)) sans contract.consumes déclaré chez "${p.from}" vers "${p.to}"`,
    });
  }
  for (const r of o5.ambiguousOwnerRecords) {
    warns.push({
      type: 'AMBIGUOUS-FILE-OWNER', ref: `${r.fileId} (${r.role})`,
      msg: `"${r.fileId}" est revendiqué par ${r.candidates.length} feature(s) (${r.candidates.join(', ')}) — ownership ambigu, O5 ne collapse pas ce fichier (rôle observé : ${r.role})`,
    });
  }
  for (const r of o5.ambiguousInterfaceProviderRecords) {
    warns.push({
      type: 'AMBIGUOUS-INTERFACE-PROVIDER', ref: `${r.routeFile} (${r.endpoint})`,
      msg: `"${r.routeFile}" (endpoint ${r.endpoint}) résout vers ${r.providerFeatures.length} features (${r.providerFeatures.join(', ')}) — provider ambigu pour le canal interface, aucun owner choisi arbitrairement`,
    });
  }
  for (const r of o5.interfaceConsumerUnresolved) {
    warns.push({
      type: 'INTERFACE-CONSUMER-FILE-UNRESOLVED', ref: `${r.scope}:${r.module} (${r.endpoint})`,
      msg: `module consumer "${r.module}" (scope ${r.scope}, endpoint ${r.endpoint}) non résolu vers un fileId gouverné — ${r.consumerStatus}`,
    });
  }
  const gapByManifest = new Map();
  for (const r of o5.localManifestGapRecords) {
    const list = gapByManifest.get(r.consumerManifest) || [];
    list.push(r);
    gapByManifest.set(r.consumerManifest, list);
  }
  for (const [manifestName, records] of gapByManifest.entries()) {
    const providers = [...new Set(records.map(r => r.providerFeature))].sort();
    warns.push({
      type: 'LOCAL-MANIFEST-DEPENDENCY-WITHOUT-CANONICAL-CONSUMER', ref: `boutique-manifest:${manifestName}`,
      msg: `${records.length} dépendance(s) technique(s) observée(s) depuis boutique-manifest:${manifestName} (ontology gap déjà documenté, canonicalFeature=null) vers ${providers.join(', ')} — visible mais non collapsable en paire canonical-feature (pas de Feature Card consumer pour déclarer contract.consumes)`,
    });
  }
  for (const [scope, list] of o5.dynamicUnresolvedByScope.entries()) {
    warns.push({
      type: 'DYNAMIC-LOCAL-DEPENDENCY-UNRESOLVED', ref: `scope:${scope}`,
      msg: `${list.length} appel(s) require()/import() dynamique(s) non résolu(s) statiquement dans le scope ${scope} (ex. ${list.slice(0, 3).map(d => `${d.sourceFileId}: ${d.raw}`).join(' | ')}) — limitation du modèle statique O5, jamais inventé`,
    });
  }

  // ── 5.9 Lot O6 — Feature Dependency Disposition ──────────────────────────
  // Couche de qualification/décision au-dessus des paires O5. NE réobserve rien,
  // NE modifie pas les warns O5 (le ratchet O5 reste intact), NE crée pas de 2e
  // graphe. Les issues O6 (unclassified/stale/…) vivent dans model.o6 et sont
  // ENFORCÉES par le gate séparé scripts/business-graph-disposition-check.js.
  const o6KindOf = (name) => {
    const n = featureNodes.find(f => f.name === name);
    return n ? n.businessKind : (name === 'admin-dashboard' ? 'projection' : 'unclassified');
  };
  let o6CompRootConfig = { wiringFiles: [] };
  if (fs.existsSync(COMPOSITION_ROOT_FILES)) {
    try { o6CompRootConfig = JSON.parse(fs.readFileSync(COMPOSITION_ROOT_FILES, 'utf8')); }
    catch (e) { sourceErrors.push(`Source illisible : governance/composition-root-files.json (O6) — ${e.message}`); }
  } else {
    sourceErrors.push('Source manquante : governance/composition-root-files.json (O6). La famille COMPOSITION_ROOT_WIRING ne pourra pas être dérivée.');
  }
  const o6WiringFiles = new Set(o6CompRootConfig.wiringFiles || []);
  // Propriétaires du composition-root : dérivés de l'ownership déclaré des fichiers
  // wiring dans les manifests (JAMAIS du nom 'infrastructure').
  const o6CompRootOwners = new Set();
  for (const man of manifests) {
    if (man.__broken || !man.name) continue;
    const flat = JSON.stringify(man.files || {});
    for (const w of o6WiringFiles) { if (flat.includes(w)) { o6CompRootOwners.add(man.name); break; } }
  }
  const o6Dispositions = featureDependencyDisposition.buildDispositions(o5.pairs, {
    kindOf: o6KindOf, compRootOwners: o6CompRootOwners, wiringFiles: o6WiringFiles,
  });
  let o6Ledger = { exceptions: [] };
  if (fs.existsSync(EXCEPTIONS_LEDGER_FILE)) {
    try { o6Ledger = JSON.parse(fs.readFileSync(EXCEPTIONS_LEDGER_FILE, 'utf8')); }
    catch (e) { sourceErrors.push(`Source illisible : governance/feature-dependency-exceptions.json (O6) — ${e.message}`); }
  }
  let o6OntologyRegistry = null;
  if (fs.existsSync(ONTOLOGY_GAPS_FILE)) {
    try { o6OntologyRegistry = JSON.parse(fs.readFileSync(ONTOLOGY_GAPS_FILE, 'utf8')); } catch { /* déjà signalé ailleurs */ }
  }
  const o6ExceptionRecon = featureDependencyDisposition.reconcileExceptions(o6Dispositions, o6Ledger);
  const o6OntologyGapCoverage = featureDependencyDisposition.reconcileOntologyGaps(
    o5.localManifestGapRecords, o6OntologyRegistry,
  );

  const model = {
    // Lot O4-2 (point 8) : le format a changé depuis O3-1.0 — nouveaux nœuds
    // (boutique-manifest), nouvel edge type (BOUTIQUE_MANIFEST_IMPLEMENTED_BY),
    // gouvernance boutique désormais stricte (CANONICAL-FEATURE-GOVERNANCE-INVALID),
    // ratchet typé par type+catégorie sémantique, model.scopeTopology. Un
    // consommateur qui lisait O3-1.0 doit être revérifié avant de lire O4-1.0.
    // Lot O5 closure : bump O4-1.0 -> O5-1.0 — le format racine porte
    // désormais nativement les edges O5 (OBSERVED_CODE_DEPENDENCY,
    // OBSERVED_INTERFACE_DEPENDENCY) et la section model.o5, pas seulement
    // model.o5.version. Un consommateur qui lisait O4-1.0 doit être
    // revérifié avant de lire O5-1.0.
    // Lot O6 : bump O5-1.0 -> O6-1.0 — le format porte désormais model.o6
    // (dispositions par famille, cycles runtime, couverture ontology gap,
    // réconciliation du ledger d'exceptions). model.o5 reste O5-1.0 inchangé.
    version: 'O6-1.0',
    generatedFrom: {
      featureManifests: manifests.map(m => m.__file).filter(Boolean),
      technicalArchitectureGraph: toPosixPath(path.relative(ROOT, ARCH_GRAPH_FILE)),
      openapiContract: openapi ? toPosixPath(path.relative(ROOT, OPENAPI_FILE)) : null,
      boutiqueRoot: fs.existsSync(BOUTIQUE_ROOT) ? toPosixPath(path.relative(ROOT, BOUTIQUE_ROOT)) : null,
      dashRoot: DASH_ROOT_MOUNTED ? toPosixPath(path.relative(ROOT, DASH_ROOT)) : null,
    },
    scope: {
      businessManifestsResolved: manifests.filter(m => !m.__broken).length,
      businessManifestsBroken: manifests.filter(m => m.__broken).length,
      declaredOnlyNodes: featureNodes.filter(n => n.declaredOnly).length,
      dashRepoMounted: DASH_ROOT_MOUNTED,
      boutiqueRepoMounted: fs.existsSync(BOUTIQUE_ROOT),
    },
    nodeTypes: ['business-feature', 'business-transversal', 'technical-transversal', 'piloting-capability', 'projection', 'frontend-transversal', 'deprecated'],
    edgeTypes: ['IMPLEMENTED_BY', 'OWNS_TABLE_LIFECYCLE', 'WRITES_TABLE', 'READS_TABLE', 'EXPOSES_INTERFACE', 'PROVIDES_INTERNAL_API', 'CONSUMES_FEATURE', 'IMPLEMENTED_IN', 'BOUTIQUE_MANIFEST_IMPLEMENTED_BY', 'OBSERVED_CODE_DEPENDENCY', 'OBSERVED_INTERFACE_DEPENDENCY'],
    nodes: { features: featureNodes, boutiqueManifests: boutiqueManifestNodes },
    edges: {
      implementedBy: implementedByEdges,
      exposesInterface: exposesEdges,
      providesInternalApi: internalApiEdges,
      consumesFeature: consumesEdges,
      implementedIn: implementedInEdges,
      // Lot O4-2 (point 3) : boutique-manifest -> IMPLEMENTED_BY -> file,
      // edge explicite et vérifiée sur disque (exists:bool par entrée) —
      // c'est CETTE liste qui fait foi pour la résolution des orphelins
      // techniques boutique (5.3), pas une simple présence dans files.*.
      boutiqueManifestImplementedBy: boutiqueImplementedByEdges,
    },
    o5: {
      version: 'O5-1.0',
      pairs: o5.pairs,
      transversalTopology: o5.transversalRecords,
      localManifestDependenciesWithoutCanonicalConsumer: o5.localManifestGapRecords,
      ambiguousOwners: o5.ambiguousOwnerRecords,
      ambiguousInterfaceProviders: o5.ambiguousInterfaceProviderRecords,
      interfaceConsumerUnresolved: o5.interfaceConsumerUnresolved,
      dynamicUnresolvedByScope: Object.fromEntries([...o5.dynamicUnresolvedByScope.entries()].map(([k, v]) => [k, v])),
      coverage: o5.coverage,
      metaGraphMounted: !!metaGraph,
    },
    o6: {
      version: 'O6-1.0',
      compositionRootOwners: [...o6CompRootOwners].sort(),
      wiringFiles: [...o6WiringFiles].sort(),
      familySummary: o6Dispositions.familySummary,
      pairClassifications: o6Dispositions.classifications.map(c => ({
        from: c.from, to: c.to, family: c.family, evidenceRole: c.evidenceRole,
        consumerKind: c.consumerKind, providerKind: c.providerKind,
        channels: c.channels, couplingObserved: c.couplingObserved,
        policy: c.policy, exceptionRequired: c.exceptionRequired, exceptionReasons: c.exceptionReasons,
      })),
      unclassified: o6Dispositions.unclassified,
      matrix: o6Dispositions.matrix,
      runtimeCycles: o6Dispositions.cycles,
      exceptions: o6ExceptionRecon.exceptions,
      staleExceptions: o6ExceptionRecon.staleExceptions,
      duplicateExceptionKeys: o6ExceptionRecon.duplicateKeys,
      illegitimateExceptions: o6ExceptionRecon.illegitimateExceptions,
      missingExceptions: o6ExceptionRecon.missingExceptions,
      emptyRationaleExceptions: o6ExceptionRecon.emptyRationale,
      unexplainedRuntimeCycles: o6ExceptionRecon.unexplainedRuntimeCycles,
      ontologyGapCoverage: o6OntologyGapCoverage,
    },
    tableOwnership,
    orphanTechnicalNodes,
    bigMap,
    // Lot O4-2 (point 9) : constat factuel, pas une doctrine — distingue
    // franchissement de SCOPE (backend/dash/boutique, toujours vrai — chacun
    // a ses propres manifests/registre/autorité) de franchissement d'ARBRE
    // (vrai seulement si relation==='external-path-scope'). "cross-repo" dans
    // bigMap.canonical.crossRepoFeatures et dans les livrables O4 précédents
    // doit se lire "cross-scope" tant que la relation ci-dessous n'est pas
    // 'external-path-scope'.
    // Lot O5-closure : relation dérive uniquement des chemins configurés
    // (ROOT/DASH_ROOT/BOUTIQUE_ROOT) — jamais de la présence de `.git`, qui
    // n'est pas déterministe entre un clone Git et un ZIP livré sans `.git`.
    scopeTopology: {
      backend: { mountPath: '.', relation: 'self', note: 'scope de référence — ce générateur tourne depuis ce dépôt' },
      dash: { mountPath: toPosixPath(path.relative(ROOT, DASH_ROOT)) || '.', ...detectScopeRelation(DASH_ROOT) },
      boutique: { mountPath: toPosixPath(path.relative(ROOT, BOUTIQUE_ROOT)) || '.', ...detectScopeRelation(BOUTIQUE_ROOT) },
      note: '"cross-repo" ailleurs dans ce document = cross-scope (frontière de gouvernance), sauf si relation="external-path-scope" ci-dessus pour le scope concerné.',
    },
    drifts: (() => {
      const candidates = warns.sort((a, b) => a.type.localeCompare(b.type) || String(a.ref).localeCompare(String(b.ref)));
      const semantic = warningSemantics.partition(candidates, { ROOT, pairClassifications: o6Dispositions.classifications });
      return {
        error: errors.sort((a, b) => a.type.localeCompare(b.type) || String(a.ref).localeCompare(String(b.ref))),
        // Doctrine 2026-08-17 : un warning est une anomalie actionnable / dette,
        // jamais une topologie attendue ni une preuve test-only. Les candidats
        // restent classifiés ci-dessous et visibles dans leurs inventaires dédiés.
        warn: semantic.debt,
        debt: semantic.debt,
        expectedTopology: semantic.expectedTopology,
        generatorLimitations: semantic.generatorLimitations,
        summary: {
          signals: semantic.debt.length,
          debt: semantic.debt.length,
          expectedTopology: semantic.expectedTopology.length,
          generatorLimitations: semantic.generatorLimitations.length,
          classifiedCandidates: candidates.length,
        },
      };
    })(),
  };

  return { model, sourceErrors };
}

// ─────────────────────────────────────────────────────────────────────────
// MARKDOWN PROJECTION
// ─────────────────────────────────────────────────────────────────────────
function renderMd(model) {
  const L = [];
  L.push('# Business Feature Graph — Komerce (Lot O3)');
  L.push('');
  L.push('> Généré par `scripts/business-graph-gen.js`. Ne pas éditer à la main.');
  L.push('> Source d\'autorité : FEATURE_DOCTRINE > APP_FEATURE_REGISTRY > features/*.feature.js > ce document.');
  L.push('> Vérifié par `node scripts/business-graph-gen.js --check` (`npm run business-graph:check`).');
  L.push('');

  const F = model.nodes.features;
  const byKind = {};
  for (const n of F) (byKind[n.businessKind] = byKind[n.businessKind] || []).push(n);

  L.push('## Feature Map');
  L.push('');
  const KIND_LABELS = {
    'business-feature': 'Business features',
    'business-transversal': 'Business transversals',
    'technical-transversal': 'Technical transversals',
    'piloting-capability': 'Piloting capabilities',
    'projection': 'Projections / UI shells',
    'frontend-transversal': 'Projections / UI shells',
    'deprecated': 'Deprecated',
  };
  const grouped = {};
  for (const [kind, label] of Object.entries(KIND_LABELS)) {
    grouped[label] = grouped[label] || [];
    for (const n of (byKind[kind] || [])) grouped[label].push(n);
  }
  for (const [label, nodes] of Object.entries(grouped)) {
    if (!nodes.length) continue;
    L.push(`### ${label}`);
    L.push('');
    for (const n of nodes.sort((a, b) => a.name.localeCompare(b.name))) {
      const tag = n.declaredOnly ? ' _(déclaré seulement — ' + n.unresolvedReason.split(' — ')[0] + ')_' : '';
      L.push(`- \`${n.name}\`${tag}`);
    }
    L.push('');
  }

  L.push('## Big Map — couverture cross-scope (Lot O4)');
  L.push('');
  L.push('Synthèse de couverture par scope et identités métier cross-scope. Voir mission O4 §13.');
  L.push('');
  L.push('> **Note de terminologie (Lot O4-2, point 9)** — "cross-repo" dans les livrables O4 précédents désignait en réalité un franchissement de **scope** (frontière de gouvernance : manifests/registre/autorité propres à backend, dash, boutique), pas nécessairement un franchissement d\'**arbre** séparé. Le tableau ci-dessous constate la relation réelle par scope, dérivée uniquement des chemins configurés (déterministe, indépendante de la présence de `.git`). Tant qu\'une ligne n\'affiche pas `external-path-scope`, "cross-repo" doit se lire "cross-scope" — un franchissement de frontière de gouvernance à l\'intérieur du même arbre.');
  L.push('');
  if (model.scopeTopology) {
    L.push('### Topologie des scopes (relation de chemin constatée)');
    L.push('');
    L.push('| Scope | Chemin monté | Relation constatée | Sous ROOT ? |');
    L.push('|---|---|---|---|');
    for (const [scope, t] of Object.entries(model.scopeTopology)) {
      if (scope === 'note') continue;
      L.push(`| ${scope} | \`${t.mountPath}\` | \`${t.relation}\` | ${t.isNestedUnderRoot === undefined ? '—' : (t.isNestedUnderRoot ? 'oui' : 'non')} |`);
    }
    L.push('');
    L.push(`_${model.scopeTopology.note}_`);
    L.push('');
  }
  if (model.bigMap) {
    L.push('### Par dépôt');
    L.push('');
    L.push('| Dépôt | Manifests découverts | Manifests connectés | Nœuds techniques | Owned | Orphelins |');
    L.push('|---|---|---|---|---|---|');
    for (const [repo, s] of Object.entries(model.bigMap.perRepo)) {
      const total = s.technicalNodesTotal === null ? 'N/A' : s.technicalNodesTotal;
      const owned = s.technicalNodesOwned === null ? 'N/A' : s.technicalNodesOwned;
      const orph  = s.technicalOrphans === null ? 'N/A' : s.technicalOrphans;
      L.push(`| ${repo} | ${s.manifestsDiscovered} | ${s.manifestsConnected} | ${total} | ${owned} | ${orph} |`);
    }
    for (const [repo, s] of Object.entries(model.bigMap.perRepo)) {
      if (s.note) L.push(`\n_${repo}_ : ${s.note}`);
    }
    L.push('');
    L.push('### Identités canoniques');
    L.push('');
    L.push(`- **Cross-repo features** (${model.bigMap.canonical.crossRepoFeatures.length}) : ${model.bigMap.canonical.crossRepoFeatures.map(n => '`' + n + '`').join(', ') || '—'}`);
    L.push(`- **Single-repo features** (${model.bigMap.canonical.singleRepoFeatures.length}) : ${model.bigMap.canonical.singleRepoFeatures.map(n => '`' + n + '`').join(', ') || '—'}`);
    L.push(`- **Unmapped local manifests** (${model.bigMap.canonical.unmappedLocalManifests.length}) : ${model.bigMap.canonical.unmappedLocalManifests.map(n => '`' + n + '`').join(', ') || '—'}`);
    L.push('');
    if (model.bigMap.canonical.ontologyGaps.length) {
      L.push('### Ontology gaps');
      L.push('');
      for (const g of model.bigMap.canonical.ontologyGaps) {
        L.push(`- **${g.id}** (manifest boutique \`${g.boutiqueManifest}\`)`);
        L.push(`  - constat : ${g.finding}`);
        L.push(`  - décision actuelle : ${g.currentDecision}`);
        L.push(`  - question ouverte : ${g.openQuestion}`);
      }
      L.push('');
    }
  } else {
    L.push('_Big Map non calculée (générateur pré-O4)._');
    L.push('');
  }

  L.push('## Feature → implémentation');
  L.push('');
  for (const n of F.filter(x => !x.declaredOnly).sort((a, b) => a.name.localeCompare(b.name))) {
    const impl = model.edges.implementedBy.filter(e => e.feature === n.name);
    const byCat = {};
    for (const e of impl) (byCat[e.category] = byCat[e.category] || []).push(e);
    const tablesOwned = Object.entries(model.tableOwnership).filter(([, t]) => t.lifecycleOwner === n.name).map(([t]) => t);
    const tablesWritten = Object.entries(model.tableOwnership).filter(([, t]) => (t.writers || []).some(w => w.feature === n.name)).map(([t]) => t);
    const exposed = model.edges.exposesInterface.filter(e => e.feature === n.name);
    const internalApi = model.edges.providesInternalApi.filter(e => e.feature === n.name);
    const deps = model.edges.consumesFeature.filter(e => e.from === n.name);
    const consumers = model.edges.consumesFeature.filter(e => e.to === n.name);

    L.push(`### ${n.name} _(${n.businessKind})_`);
    L.push('');
    if (n.service) L.push(`> ${n.service}`);
    L.push('');
    for (const [cat, items] of Object.entries(byCat)) {
      L.push(`- ${cat}: ${items.length}`);
    }
    L.push(`- tables owned (lifecycle): ${tablesOwned.length}${tablesOwned.length ? ' — ' + tablesOwned.map(t => '`' + t + '`').join(', ') : ''}`);
    L.push(`- tables written: ${tablesWritten.length}`);
    L.push(`- interfaces exposed: ${exposed.length}`);
    L.push(`- internal APIs: ${internalApi.length}`);
    L.push(`- dependencies (consumes): ${deps.length}${deps.length ? ' — ' + deps.map(d => d.to).join(', ') : ''}`);
    L.push(`- consumers: ${consumers.length}${consumers.length ? ' — ' + consumers.map(d => d.from).join(', ') : ''}`);
    L.push('');
  }

  L.push('## Table ownership');
  L.push('');
  L.push('| Table | Lifecycle owner | Résolution | Writers | Readers |');
  L.push('|---|---|---|---|---|');
  for (const [table, t] of Object.entries(model.tableOwnership).sort(([a], [b]) => a.localeCompare(b))) {
    L.push(`| \`${table}\` | ${t.lifecycleOwner ? '`' + t.lifecycleOwner + '`' : '_ambiguë_'} | ${t.resolution} | ${(t.writers || []).map(w => w.feature).join(', ') || '—'} | ${(t.readers || []).join(', ') || '—'} |`);
  }
  L.push('');

  L.push('## Interface ownership');
  L.push('');
  L.push('### Routes (contract.exposes)');
  L.push('');
  L.push('| Route | Feature | Résolution technique |');
  L.push('|---|---|---|');
  for (const e of model.edges.exposesInterface) {
    L.push(`| \`${e.method} ${e.path}\` | ${e.feature} | ${e.routeFile ? '`' + e.routeFile + '`' : '—'} (${e.status}) |`);
  }
  L.push('');
  L.push('### API internes (contract.internalApi)');
  L.push('');
  L.push('| Fonction | Fichier | Feature | Statut |');
  L.push('|---|---|---|---|');
  for (const e of model.edges.providesInternalApi) {
    L.push(`| \`${e.fn || '—'}\` | \`${e.file}\` | ${e.feature} | ${e.status} |`);
  }
  L.push('');

  L.push('## Cross-feature dependencies');
  L.push('');
  L.push('| Feature | consumes | Résolu ? |');
  L.push('|---|---|---|');
  for (const e of model.edges.consumesFeature) {
    L.push(`| ${e.from} | ${e.to} (\`${e.raw}\`) | ${e.resolved ? '✔' : '✖'} |`);
  }
  L.push('');

  L.push('## Drifts');
  L.push('');
  L.push(`### ERROR (${model.drifts.error.length})`);
  L.push('');
  if (!model.drifts.error.length) L.push('- none');
  for (const d of model.drifts.error) L.push(`- **[${d.type}]** ${d.ref} — ${d.msg}`);
  L.push('');
  L.push(`### DETTE / DRIFT ACTIONNABLE (${model.drifts.debt.length})`);
  L.push('');
  L.push('Seules INVALID_DECLARATION, ACTIONABLE_DRIFT et KNOWN_DEBT constituent de la dette gouvernance. Les topologies attendues et limites du générateur restent visibles séparément et ne consomment aucun budget de dette.');
  L.push('');
  if (!model.drifts.debt.length) L.push('- none');
  for (const d of model.drifts.debt) {
    const { category } = warningSemantics.classify(d, { ROOT });
    L.push(`- **[${d.type}]** _[${category}]_ ${d.ref} — ${d.msg}`);
  }
  L.push('');
  L.push(`### TOPOLOGIE ATTENDUE — hors dette (${model.drifts.expectedTopology.length})`);
  L.push('');
  if (!model.drifts.expectedTopology.length) L.push('- none');
  for (const d of model.drifts.expectedTopology) L.push(`- **[${d.type}]** ${d.ref} — ${d.msg}`);
  L.push('');
  L.push(`### LIMITES DU GÉNÉRATEUR — hors dette (${model.drifts.generatorLimitations.length})`);
  L.push('');
  if (!model.drifts.generatorLimitations.length) L.push('- none');
  for (const d of model.drifts.generatorLimitations) L.push(`- **[${d.type}]** ${d.ref} — ${d.msg}`);
  L.push('');

  L.push('## Orphan technical nodes');
  L.push('');
  L.push('Fichiers présents dans le Technical Architecture Graph, non revendiqués par une carte feature ni un transversal déclaré (`governance/transversal-paths.json`).');
  L.push('');
  if (!model.orphanTechnicalNodes.length) L.push('- none');
  for (const f of model.orphanTechnicalNodes) L.push(`- ${f}`);
  L.push('');

  L.push('## Lot O5 — Feature Dependency Conformance & Hidden Coupling Gate');
  L.push('');
  L.push(`Meta Graph monté : ${model.o5.metaGraphMounted ? 'oui' : 'non (canal interface dégradé)'}.`);
  L.push('');
  L.push('### Coverage par scope');
  L.push('');
  L.push(`- backend : ${model.o5.coverage.backend.filesObserved} fichier(s) \`.js\`/\`.mjs\` observés (canal A)`);
  L.push(`- boutique : ${model.o5.coverage.boutique.filesObserved} fichier(s) observés, dont ${model.o5.coverage.boutique.nonCanonicalManifestFiles} sous manifest non-canonique (canonicalFeature=null)`);
  L.push(`- dash : ${model.o5.coverage.dash.filesObserved} fichier(s) observés`);
  for (const lim of model.o5.coverage.dash.limitations) L.push(`  - _${lim}_`);
  L.push('');
  L.push('### Dependency conformance summary (paires canonical-feature → canonical-feature)');
  L.push('');
  L.push('| Consumer | Provider | Canaux | Preuves | Statut |');
  L.push('|---|---|---|---|---|');
  if (!model.o5.pairs.length) L.push('| _none_ | | | | |');
  for (const p of model.o5.pairs) {
    const chans = p.channels.map(c => c.channel).join(', ');
    const nEvidence = p.channels.reduce((n, c) => n + c.evidence.length, 0);
    L.push(`| ${p.from} | ${p.to} | ${chans} | ${nEvidence} | **${p.conformanceStatus}** |`);
  }
  L.push('');
  L.push('### Observed undeclared dependencies');
  L.push('');
  const undeclared = model.o5.pairs.filter(p => p.conformanceStatus === 'OBSERVED_UNDECLARED');
  if (!undeclared.length) L.push('- none');
  for (const p of undeclared) L.push(`- \`${p.from}\` → \`${p.to}\` (canaux: ${p.channels.map(c => c.channel).join(', ')})`);
  L.push('');
  L.push('### Declared without observed evidence (canal A/D uniquement — ne signifie pas "dépendance inexistante")');
  L.push('');
  const observedPairKeys = new Set(model.o5.pairs.map(p => `${p.from}\u0000${p.to}`));
  const declaredWithoutO5Evidence = model.edges.consumesFeature.filter(e => e.resolved && !observedPairKeys.has(`${e.from}\u0000${e.to}`));
  if (!declaredWithoutO5Evidence.length) L.push('- none');
  for (const e of declaredWithoutO5Evidence) L.push(`- \`${e.from}\` → \`${e.to}\` (déclaré : \`${e.raw}\`)`);
  L.push('');
  L.push('### Transversal topology (consumer = local-manifest frontend-transversal, hors ontology gap)');
  L.push('');
  const transversalByManifest = {};
  for (const r of model.o5.transversalTopology) (transversalByManifest[r.consumerManifest] = transversalByManifest[r.consumerManifest] || new Set()).add(`${r.providerFeature} (${r.channel})`);
  if (!Object.keys(transversalByManifest).length) L.push('- none');
  for (const [m, set] of Object.entries(transversalByManifest)) L.push(`- \`boutique-manifest:${m}\` → ${[...set].sort().join(', ')}`);
  L.push('');
  L.push('### Local-manifest dependencies without canonical consumer (ontology gap, KNOWN_DEBT)');
  L.push('');
  const gapByM = {};
  for (const r of model.o5.localManifestDependenciesWithoutCanonicalConsumer) (gapByM[r.consumerManifest] = gapByM[r.consumerManifest] || new Set()).add(`${r.providerFeature} (${r.channel})`);
  if (!Object.keys(gapByM).length) L.push('- none');
  for (const [m, set] of Object.entries(gapByM)) L.push(`- \`boutique-manifest:${m}\` → ${[...set].sort().join(', ')}`);
  L.push('');
  L.push('### Ambiguous owners / providers (jamais collapsés arbitrairement)');
  L.push('');
  if (!model.o5.ambiguousOwners.length && !model.o5.ambiguousInterfaceProviders.length) L.push('- none');
  for (const r of model.o5.ambiguousOwners) L.push(`- \`${r.fileId}\` (${r.role}) revendiqué par : ${r.candidates.join(', ')}`);
  for (const r of model.o5.ambiguousInterfaceProviders) L.push(`- \`${r.routeFile}\` (endpoint ${r.endpoint}) résout vers : ${r.providerFeatures.join(', ')}`);
  L.push('');
  L.push('### Interface consumer unresolved (canal D)');
  L.push('');
  if (!model.o5.interfaceConsumerUnresolved.length) L.push('- none');
  for (const r of model.o5.interfaceConsumerUnresolved.slice(0, 30)) L.push(`- ${r.scope}:\`${r.module}\` (endpoint ${r.endpoint}) — ${r.consumerStatus}`);
  if (model.o5.interfaceConsumerUnresolved.length > 30) L.push(`- … (${model.o5.interfaceConsumerUnresolved.length - 30} de plus, cf. docs/BUSINESS_FEATURE_GRAPH.json → o5.interfaceConsumerUnresolved)`);
  L.push('');
  L.push('### Dynamic dependencies non résolues statiquement (limitation du modèle, jamais inventées)');
  L.push('');
  const dynEntries = Object.entries(model.o5.dynamicUnresolvedByScope);
  if (!dynEntries.length) L.push('- none');
  for (const [scope, list] of dynEntries) L.push(`- scope \`${scope}\` : ${list.length} appel(s) — ex. ${list.slice(0, 3).map(d => `\`${d.sourceFileId}\`: \`${d.raw}\``).join(', ')}`);
  L.push('');

  renderO6Section(L, model);

  return L.join('\n') + '\n';
}

// ── Lot O6 — Dependency Disposition (vues markdown) ───────────────────────
function renderO6Section(L, model) {
  const o6 = model.o6;
  if (!o6) return;
  const cls = o6.pairClassifications;
  const byFam = {};
  for (const c of cls) (byFam[c.family] = byFam[c.family] || []).push(c);

  L.push('## O6 — Dependency Disposition');
  L.push('');
  L.push('> Couche de qualification/décision au-dessus des paires O5 `OBSERVED_UNDECLARED`. O6 classifie et gouverne la dette ; **O6 ne remédie pas** encore les coutures cross-feature. Détail par paire : `docs/O6_INVENTORY.md`. Enforcement : `npm run business-graph:disposition-check`.');
  L.push('');
  L.push(`Composition-root owners (dérivés de l'ownership des fichiers wiring, pas du nom) : ${o6.compositionRootOwners.map(o => '`' + o + '`').join(', ') || '_none_'}.`);
  L.push('');

  L.push('### Summary by family');
  L.push('');
  L.push('| Family | N | Policy |');
  L.push('|---|---|---|');
  for (const f of featureDependencyDisposition.FAMILIES) {
    L.push(`| ${f} | ${o6.familySummary[f] || 0} | ${featureDependencyDisposition.POLICY[f]} |`);
  }
  L.push(`| UNCLASSIFIED | ${o6.familySummary.UNCLASSIFIED || 0} | _(bloquant si > 0)_ |`);
  L.push(`| **TOTAL** | **${cls.length}** | |`);
  L.push('');

  const famBlock = (title, family, note) => {
    L.push(`### ${title}`);
    L.push('');
    if (note) { L.push(note); L.push(''); }
    const list = (byFam[family] || []).slice().sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
    if (!list.length) { L.push('- _none_'); L.push(''); return; }
    for (const c of list) L.push(`- \`${c.from}\` → \`${c.to}\` — ${c.couplingObserved}, ${c.evidenceRole}${c.exceptionRequired ? ' _(exception: ' + c.exceptionReasons.join(', ') + ')_' : ''}`);
    L.push('');
  };

  famBlock('Projection dependencies', 'PROJECTION', 'Vues Dash → endpoint backend. Jamais dans un `contract.consumes` backend.');
  famBlock('Composition root wiring', 'COMPOSITION_ROOT_WIRING', 'Bootstrap/cron/error-handler qui montent ou déclenchent une feature. Pas une consommation de service.');
  famBlock('Non-runtime test evidence', 'NON_RUNTIME_TEST', 'Preuves 100 % tests/. Visible mais hors dette de contrat runtime.');
  famBlock('Technical primitives', 'TECHNICAL_PRIMITIVE', "Usage de db.js / middleware / logger / utils / validators d'un transversal technique. Politique technique, pas `contract.consumes`.");
  famBlock('Business transversal services', 'BUSINESS_TRANSVERSAL_SERVICE', 'Consommation réelle d\'un service transversal métier — candidat `contract.consumes` (internal API préférée).');
  famBlock('Cross-feature direct imports', 'CROSS_FEATURE_DIRECT_IMPORT', 'require() direct d\'un fichier d\'une autre business-feature — couture à casser AVANT déclaration.');
  famBlock('Business feature interfaces', 'BUSINESS_FEATURE_INTERFACE', 'Consommation d\'une business-feature via interface/http — candidat `contract.consumes`.');
  famBlock('Piloting capability dependencies', 'PILOTING_CAPABILITY', 'Consommation de decision-signals (capacité de pilotage).');

  L.push('### Exceptions requiring human decision');
  L.push('');
  L.push('Ledger `governance/feature-dependency-exceptions.json` — uniquement les paires dont la politique de famille ne suffit pas (imports directs, cycles, ownership suspects). Une entrée dont la paire disparaît d\'O5 devient stale (bloquant).');
  L.push('');
  if (!o6.exceptions.length) L.push('- _none_');
  for (const e of o6.exceptions.slice().sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to))) {
    L.push(`- \`${e.from}\` → \`${e.to}\` — **${e.decision}** — ${e.rationale}`);
  }
  L.push('');

  L.push('### Runtime cycles');
  L.push('');
  L.push('Cycles runtime réels (après exclusion test-only + composition-root). Chaque direction porte une décision dans le ledger.');
  L.push('');
  if (!o6.runtimeCycles.length) L.push('- _none_');
  for (const cy of o6.runtimeCycles) {
    L.push(`- \`${cy.nodes[0]}\` ↔ \`${cy.nodes[1]}\` — ${cy.directions.map(d => `${d.from}→${d.to} (${d.family})`).join(' ; ')}`);
  }
  L.push('');

  L.push('### Ontology gap coverage (flux local-manifest séparé, hors paires)');
  L.push('');
  L.push('`tracking` et consorts vivent dans `model.o5.localManifestDependenciesWithoutCanonicalConsumer`, pas dans les paires `from → to`. Couverture par le registre ontologique autoritaire.');
  L.push('');
  const gc = o6.ontologyGapCoverage;
  if (!gc.consumers.length) L.push('- _none_');
  for (const c of gc.consumers) {
    const status = gc.covered.includes(c) ? 'couvert' : '**NON COUVERT (bloquant)**';
    L.push(`- \`${c}\` → ${(gc.providersByConsumer[c] || []).join(', ')} — ${status}`);
  }
  L.push('');

  L.push('### Unclassified dependencies');
  L.push('');
  if (!o6.unclassified.length) L.push('- _none_ (gate vert)');
  for (const u of o6.unclassified) L.push(`- \`${u.from}\` → \`${u.to}\` — ${u.couplingObserved}, ${u.evidenceRole}`);
  L.push('');
}

// ── Lot O6 — Inventaire déterministe des 94 (projection) ──────────────────
function renderO6Inventory(model) {
  const o6 = model.o6;
  const L = [];
  L.push('# O6 — Dependency Debt Inventory');
  L.push('');
  L.push('> Projection déterministe générée par `scripts/business-graph-gen.js`. Ne pas éditer à la main.');
  L.push('> Chaque paire ci-dessous est une dépendance O5 `OBSERVED_UNDECLARED` classée dans exactement une famille O6, dérivée de ses preuves réelles.');
  L.push('> O6 classifie et gouverne ; **O6 ne remédie pas** encore les coutures.');
  L.push('');
  L.push('## Summary by family');
  L.push('');
  L.push('| Family | N |');
  L.push('|---|---|');
  for (const f of featureDependencyDisposition.FAMILIES) L.push(`| ${f} | ${o6.familySummary[f] || 0} |`);
  L.push(`| UNCLASSIFIED | ${o6.familySummary.UNCLASSIFIED || 0} |`);
  L.push(`| **TOTAL** | **${o6.pairClassifications.length}** |`);
  L.push('');
  L.push('## The 94 pairs (from → to)');
  L.push('');
  L.push('| from → to | family | evidence role | consumer kind | provider kind | channels | coupling | policy | exception | top evidence |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  const rows = o6.pairClassifications.slice().sort((a, b) => (a.from + '->' + a.to).localeCompare(b.from + '->' + b.to));
  for (const c of rows) {
    const ev = (c.topEvidence || []).length
      ? (c.topEvidence.find(e => e.role === 'RUNTIME') || c.topEvidence[0]).label.replace(/\|/g, '/')
      : '';
    const exc = c.exceptionRequired ? c.exceptionReasons.join(', ') : '—';
    L.push(`| ${c.from} → ${c.to} | ${c.family} | ${c.evidenceRole} | ${c.consumerKind} | ${c.providerKind} | ${c.channels.join('+')} | ${c.couplingObserved} | ${c.policy || '—'} | ${exc} | \`${ev}\` |`);
  }
  L.push('');
  L.push('## Exceptions ledger (measured, not fixed)');
  L.push('');
  L.push(`Total exceptions : **${o6.exceptions.length}**.`);
  L.push('');
  L.push('| from → to | decision | rationale |');
  L.push('|---|---|---|');
  for (const e of o6.exceptions.slice().sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to))) {
    L.push(`| ${e.from} → ${e.to} | ${e.decision} | ${(e.rationale || '').replace(/\|/g, '/')} |`);
  }
  L.push('');
  L.push('## Runtime cycles');
  L.push('');
  if (!o6.runtimeCycles.length) L.push('- _none_');
  for (const cy of o6.runtimeCycles) L.push(`- \`${cy.nodes[0]}\` ↔ \`${cy.nodes[1]}\``);
  L.push('');
  L.push('## Ontology gap coverage (separate flux)');
  L.push('');
  const gc = o6.ontologyGapCoverage;
  if (!gc.consumers.length) L.push('- _none_');
  for (const c of gc.consumers) L.push(`- \`${c}\` → ${(gc.providersByConsumer[c] || []).join(', ')} — ${gc.covered.includes(c) ? 'couvert' : 'NON COUVERT'}`);
  L.push('');
  return L.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────
function stableStringify(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

// Lot déterminisme (2026-08) : la génération/écriture/process.exit() ne doit
// s'exécuter que lorsqu'on lance ce fichier directement (node scripts/
// business-graph-gen.js), jamais lors d'un require() — même pattern que
// parseDbTables/resolveTableOwnership déjà extraits en module testable.
// require('../../scripts/business-graph-gen.js') dans
// tests/unit/business-graph-determinism.test.js ne doit ni lire le disque
// réel ni appeler process.exit().
function runMain() {
const { model, fatal, sourceErrors } = build();
if (fatal) {
  console.error(`${C.red}${C.bld}✖ Impossible de générer le Business Feature Graph :${C.r}`);
  sourceErrors.forEach(e => console.error(`${C.red}  - ${e}${C.r}`));
  process.exit(2);
}
if (sourceErrors.length) {
  sourceErrors.forEach(e => console.log(`${C.ylw}⚠ ${e}${C.r}`));
}

const jsonOut = stableStringify(model);
const mdOut = renderMd(model);
const o6InventoryOut = renderO6Inventory(model);

if (CHECK) {
  let stale = false;
  const reasons = [];
  if (!fs.existsSync(OUT_JSON)) { stale = true; reasons.push('docs/BUSINESS_FEATURE_GRAPH.json absent'); }
  else if (fs.readFileSync(OUT_JSON, 'utf8') !== jsonOut) { stale = true; reasons.push('docs/BUSINESS_FEATURE_GRAPH.json ne correspond plus au générateur — régénère avec npm run business-graph:gen'); }
  if (!fs.existsSync(OUT_MD)) { stale = true; reasons.push('docs/BUSINESS_FEATURE_GRAPH.md absent'); }
  else if (fs.readFileSync(OUT_MD, 'utf8') !== mdOut) { stale = true; reasons.push('docs/BUSINESS_FEATURE_GRAPH.md ne correspond plus au générateur'); }
  if (!fs.existsSync(OUT_O6_INVENTORY)) { stale = true; reasons.push('docs/O6_INVENTORY.md absent'); }
  else if (fs.readFileSync(OUT_O6_INVENTORY, 'utf8') !== o6InventoryOut) { stale = true; reasons.push('docs/O6_INVENTORY.md ne correspond plus au générateur'); }

  const nErr = model.drifts.error.length;
  const nDebt = model.drifts.debt.length;
  const nExpected = model.drifts.expectedTopology.length;
  const nLimitations = model.drifts.generatorLimitations.length;
  console.log(`${C.bld}Business Feature Graph check${C.r} — ${model.nodes.features.length} feature(s), ${nErr} error(s), ${nDebt} debt/drift, ${nExpected} expected, ${nLimitations} tool-limit`);
  if (stale) {
    console.log(`${C.red}${C.bld}✖ Artefact stale :${C.r}`);
    reasons.forEach(r => console.log(`${C.red}   ↳ ${r}${C.r}`));
  }
  if (nErr) {
    console.log(`${C.red}${C.bld}✖ ${nErr} référence(s) métier non résolue(s) / contradiction(s) :${C.r}`);
    model.drifts.error.forEach(d => console.log(`${C.red}   [${d.type}] ${d.ref} — ${d.msg}${C.r}`));
  }
  if (nDebt) {
    console.log(`${C.ylw}▲ ${nDebt} dette(s) / drift(s) réel(s) visible(s) (non bloquant) :${C.r}`);
    model.drifts.debt.forEach(d => console.log(`${C.ylw}   [${d.type}] ${d.ref} — ${d.msg}${C.r}`));
  }
  if (nExpected) console.log(`${C.dim}ℹ ${nExpected} topologie(s) attendue(s), hors dette.${C.r}`);
  if (nLimitations) console.log(`${C.dim}ℹ ${nLimitations} limite(s) du générateur, hors dette.${C.r}`);
  if (stale || nErr) process.exit(1);
  console.log(`${C.grn}${C.bld}✔ Business Feature Graph reconstructible et à jour.${C.r}`);
  process.exit(0);
}

fs.mkdirSync(DOCS, { recursive: true });
fs.writeFileSync(OUT_JSON, jsonOut);
fs.writeFileSync(OUT_MD, mdOut);
fs.writeFileSync(OUT_O6_INVENTORY, o6InventoryOut);
console.log(`${C.grn}${C.bld}✔ Business Feature Graph généré${C.r} — ${model.nodes.features.length} feature(s), ${model.drifts.error.length} error(s), ${model.drifts.debt.length} debt/drift, ${model.drifts.expectedTopology.length} expected, ${model.drifts.generatorLimitations.length} tool-limit`);
console.log(`  docs/BUSINESS_FEATURE_GRAPH.json + docs/BUSINESS_FEATURE_GRAPH.md + docs/O6_INVENTORY.md`);
}

if (require.main === module) {
  runMain();
}

module.exports = { stableReadDir, parseDbTables, resolveTableOwnership, runMain };
