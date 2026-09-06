#!/usr/bin/env node
'use strict';

/**
 * feature-schema-check.js — Gate 2 : schéma strict des cartes d'identité.
 *
 *   Une carte porte l'INTENTION (non dérivable), jamais le dérivé recopié.
 *   Ce gate fait échouer toute carte (a) incomplète sur les champs d'intention,
 *   ou (b) polluée par du dérivé (methods/selectors/exports… = boulot du
 *   générateur, pas de la carte).
 *
 *   Trois niveaux de sévérité, pour une adoption par paliers (cliquet) :
 *     STRUCTUREL  champs sans lesquels la carte est cassée → bloque en --strict
 *     FORBIDDEN   dérivé recopié → bloque en --strict (toujours)
 *     RATCHET     tests|verification|contracts : preuve de non-régression.
 *                 Bloque en --strict pour toute carte ABSENTE de la baseline
 *                 (= toute carte créée à partir de maintenant). Les cartes
 *                 déjà dans la baseline restent non-bloquantes (dette connue,
 *                 visible, ne peut que diminuer — jamais remontée par --save).
 *                 Raison : l'incident modal (carte→test disparu sans alerte)
 *                 doit rester impossible pour TOUTE NOUVELLE carte, sans
 *                 prétendre résoudre d'un coup les 16 cartes historiques.
 *     GOUVERNANCE autres champs de maturité (authority, contrat, invariants)
 *                 → bloque seulement en --strict --full (le temps de backfiller)
 *
 * Usage :
 *   node scripts/feature-schema-check.js              rapport
 *   node scripts/feature-schema-check.js --strict     exit 1 si STRUCTUREL/FORBIDDEN/RATCHET
 *   node scripts/feature-schema-check.js --strict --full   + GOUVERNANCE
 *   node scripts/feature-schema-check.js --save       régénère la baseline RATCHET (ne peut que rétrécir)
 *   node scripts/feature-schema-check.js --root DIR
 */
const fs = require('fs'), path = require('path');
const args = args_(); function args_(){return process.argv.slice(2);}
const STRICT = args.includes('--strict'), FULL = args.includes('--full'), SAVE = args.includes('--save');

// Garde-fou structurel : --save est une commande de MAINTENANCE MANUELLE
// uniquement (geler/rétrécir la dette = décision humaine consciente, jamais
// un effet de bord de pipeline). On refuse de l'exécuter en environnement CI,
// même si une future PR de workflow l'y branchait par erreur — la CI ne doit
// QUE lire le ratchet (`gate:schema`), jamais le réécrire (`--save`).
// CI=true est posé par défaut par GitHub Actions, GitLab CI, CircleCI, etc.
if (SAVE && process.env.CI) {
  console.error('\x1b[31m✖ --save refusé en environnement CI (process.env.CI détecté).\x1b[0m');
  console.error('  La baseline du ratchet tests|verification|contracts ne se régénère qu\'en local,');
  console.error('  par un humain qui décide consciemment de figer/rétrécir la dette.');
  console.error('  La CI ne doit appeler que `npm run gate:schema` (lecture seule).');
  process.exit(1);
}
const ROOT = path.resolve(argVal('--root') || process.cwd());
function argVal(f){const i=args.indexOf(f);return i>=0?args[i+1]:null;}
const C={red:'\x1b[31m',grn:'\x1b[32m',ylw:'\x1b[33m',dim:'\x1b[2m',bld:'\x1b[1m',cyn:'\x1b[36m',r:'\x1b[0m'};

const GLOBS = ['features', 'public/boutique/features'];
const TESTS_BASELINE_FILE = path.join(__dirname, '.feature-schema-tests-baseline.json');

// ── Baseline RATCHET (tests|verification|contracts) ─────────────────────────
// Liste nominative des cartes EXEMPTÉES (dette pré-existante au 2026-06-28).
// --save ne peut que RÉTRÉCIR cette liste (carte backfillée → retirée pour de
// bon), jamais l'agrandir silencieusement : une carte absente de la baseline
// qui échoue est une VRAIE régression, pas une dette à absorber automatiquement.
function loadTestsBaseline() {
  if (!fs.existsSync(TESTS_BASELINE_FILE)) {
    console.log(`${C.dim}(pas de baseline trouvée à ${TESTS_BASELINE_FILE} — toutes les cartes seront jugées sans dette grand-fathered)${C.r}`);
    return new Set();
  }
  let raw;
  try { raw = fs.readFileSync(TESTS_BASELINE_FILE, 'utf8'); }
  catch (e) {
    console.log(`${C.ylw}⚠ Baseline illisible (${e.message}) — traitée comme vide.${C.r}`);
    return new Set();
  }
  // BOM UTF-8 fréquent sous Windows (PowerShell `>`, Notepad "Enregistrer sous",
  // certains téléchargements de navigateur) : fait planter JSON.parse sinon,
  // silencieusement avant ce fix (catch générique = baseline vide sans alerte).
  raw = raw.replace(/^\uFEFF/, '');
  try {
    const parsed = JSON.parse(raw);
    const set = new Set(parsed.exempt || []);
    if (set.size === 0) console.log(`${C.ylw}⚠ Baseline trouvée mais "exempt" est vide ou absent — vérifier le contenu de ${path.basename(TESTS_BASELINE_FILE)}.${C.r}`);
    return set;
  } catch (e) {
    console.log(`${C.red}⚠ Baseline présente mais JSON invalide (${e.message.slice(0,80)}) — traitée comme vide, donc toutes les cartes apparaîtront "hors baseline".${C.r}`);
    console.log(`${C.dim}  Cause fréquente : BOM résiduel ou fichier tronqué. Vérifier avec : node -e "console.log(Buffer.from(require('fs').readFileSync('${TESTS_BASELINE_FILE.replace(/\\/g,'/')}')).slice(0,4))"${C.r}`);
    return new Set();
  }
}
function saveTestsBaseline(stillMissing, oldBaseline, isBootstrap) {
  // Amorçage (première exécution, aucune baseline sur disque) : on fige la
  // dette actuelle telle quelle — c'est l'acte humain volontaire qui ouvre
  // le cliquet. Ensuite, --save ne fait plus QUE rétrécir : une carte
  // manquante mais absente de l'ancienne baseline n'est jamais ajoutée
  // automatiquement (régression réelle, pas une dette à absorber).
  const next = isBootstrap
    ? [...stillMissing].sort()
    : [...stillMissing].filter(n => oldBaseline.has(n)).sort();
  fs.writeFileSync(TESTS_BASELINE_FILE, JSON.stringify({
    _doctrine: 'Cliquet : ne peut que rétrécir. Une carte retirée d\'ici doit le rester (régression sinon). Régénéré par --save.',
    _updated: new Date().toISOString().slice(0,10),
    exempt: next,
  }, null, 2) + '\n');
  return next;
}

// ── Schéma ──────────────────────────────────────────────────────────────────
const STRUCTURAL = ['name', 'type', 'status', 'service'];
const FORBIDDEN  = ['methods', 'selectors', 'exports', 'domEvents', 'metrics', 'routesReal', 'dependencies'];
function hasTestsProof(m) {
  // La preuve de tests est rangée sous files.tests dans les cartes (schéma
  // `files: { ..., tests: [...] }`), jamais en top-level m.tests — ce champ
  // top-level n'existe dans aucune carte du dépôt (backend ou boutique).
  // m.verification et m.contracts restent des preuves alternatives légitimes
  // pour les cartes sans fichiers de test dédiés (ex. dashboard : lecture
  // seule, prouvée par des commandes de gouvernance ; modal-product : preuve
  // par contrat déclaré).
  const filesTests = m.files && Array.isArray(m.files.tests) && m.files.tests.length;
  return !!(filesTests || m.tests || m.verification || (m.contracts && Object.keys(m.contracts).length));
}
function isDeprecatedCard(m) {
  return m && (
    m.status === 'deprecated' ||
    m.classification?.kind === 'deprecated' ||
    m.classification?.decision === 'deprecated'
  );
}
function governanceChecks(m) {
  const miss = [];
  const deprecated = isDeprecatedCard(m);
  // Une tombstone deprecated doit conserver la FORME des champs, mais leur
  // vacuité est précisément la preuve qu'elle n'exerce plus d'autorité.
  if (!m.perimeter || !Array.isArray(m.perimeter.in) || (!deprecated && !m.perimeter.in.length)) miss.push('perimeter.in');
  if (!m.perimeter || !Array.isArray(m.perimeter.out) || !m.perimeter.out.length) miss.push('perimeter.out');
  if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files) || (!deprecated && !Object.keys(m.files).length)) miss.push('files');
  if (!m.authority) miss.push('authority');
  if (!m.contract || !Array.isArray(m.contract.exposes))  miss.push('contract.exposes');
  if (!m.contract || !Array.isArray(m.contract.consumes)) miss.push('contract.consumes');
  if (!Array.isArray(m.invariants) || (!deprecated && !m.invariants.length)) miss.push('invariants');
  return miss;
}

function load() {
  const out = [];
  for (const dir of GLOBS) { const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) { if (!f.endsWith('.feature.js')) continue;
      const full = path.join(abs, f);
      try { const m = require(full); m.__file = path.relative(ROOT, full); out.push(m); }
      catch (e) { out.push({ name: f, __file: path.relative(ROOT, full), __broken: e.message }); }
    }
  }
  return out;
}

const cards = load();
const featureKey = m => String(m.__file || m.name || '').replace(/\\/g, '/');
const BASELINE_EXISTED = fs.existsSync(TESTS_BASELINE_FILE);
const baseline = loadTestsBaseline();
console.log(`\n${C.bld}Gate 2 — Schéma des cartes${C.r}  ${C.dim}(${cards.length} carte(s), racine ${ROOT})${C.r}\n`);

let errStruct = 0, errForbidden = 0, debtGov = 0, errRatchet = 0;
const stillMissingTests = new Set();
for (const m of cards) {
  if (m.__broken) { console.log(`${C.red}✖ ${m.name}${C.r} illisible: ${m.__broken}`); errStruct++; continue; }
  const missStruct = STRUCTURAL.filter(k => m[k] === undefined || m[k] === null || m[k] === '');
  const forb = FORBIDDEN.filter(k => k in m);
  const missGov = governanceChecks(m);
  const missingTests = !hasTestsProof(m);

  const baselineKey = featureKey(m);
  if (missingTests) stillMissingTests.add(baselineKey);
  const ratchetFail = missingTests && !baseline.has(baselineKey); // nouvelle carte / régression

  errStruct += missStruct.length ? 1 : 0;
  errForbidden += forb.length ? 1 : 0;
  debtGov += missGov.length ? 1 : 0;
  errRatchet += ratchetFail ? 1 : 0;

  if (!missStruct.length && !forb.length && !missGov.length && !missingTests) { console.log(`${C.grn}✔ ${m.name}${C.r}`); continue; }
  const tag = (missStruct.length || forb.length || ratchetFail) ? `${C.red}✖` : `${C.ylw}▲`;
  console.log(`${tag} ${m.name}${C.r} ${C.dim}(${m.__file})${C.r}`);
  if (missStruct.length) console.log(`    ${C.red}structurel manquant${C.r} : ${missStruct.join(', ')}`);
  if (forb.length)       console.log(`    ${C.red}dérivé interdit${C.r}    : ${forb.join(', ')} ${C.dim}(→ générateur)${C.r}`);
  if (missingTests) {
    if (ratchetFail) console.log(`    ${C.red}tests|verification|contracts manquant${C.r} ${C.dim}(carte hors baseline — bloquant en --strict)${C.r}`);
    else              console.log(`    ${C.ylw}tests|verification|contracts manquant${C.r} ${C.dim}(dette pré-existante, baseline — npm run gate:schema -- --save pour rétrécir)${C.r}`);
  }
  if (missGov.length)    console.log(`    ${C.ylw}gouvernance${C.r}        : ${missGov.join(', ')} ${C.dim}(à backfiller)${C.r}`);
}

const staleBaseline = [...baseline].filter(key => !stillMissingTests.has(key));
if (staleBaseline.length) {
  errRatchet += staleBaseline.length;
  console.log(`\n${C.red}✖ ${staleBaseline.length} exemption(s) tests devenue(s) inutile(s) :${C.r}`);
  staleBaseline.forEach(key => console.log(`${C.red}   ↓ ${key}${C.r}`));
  console.log(`${C.dim}  Rétrécir scripts/.feature-schema-tests-baseline.json ; une dette remboursée ne reste jamais baselinée.${C.r}`);
}

if (SAVE) {
  const next = saveTestsBaseline(stillMissingTests, baseline, !BASELINE_EXISTED);
  console.log(`\n${C.cyn}↻ Baseline RATCHET ${BASELINE_EXISTED ? 'réécrite' : 'amorcée'} : ${next.length} carte(s) exemptée(s) (${baseline.size} avant).${C.r}`);
}

console.log(`\n${C.bld}Bilan${C.r} : ${errStruct} cassée(s) structurel · ${errForbidden} polluée(s) dérivé · ${errRatchet} régression(s) tests · ${debtGov} immature(s) gouvernance`);
const hardFail = errStruct + errForbidden + errRatchet;
const govFail  = FULL ? debtGov : 0;
if (STRICT && (hardFail + govFail) > 0) {
  console.log(`${C.red}${C.bld}✖ Schéma non conforme${C.r}${FULL ? ' (mode --full : gouvernance incluse)' : C.dim+' (gouvernance non bloquante sans --full)'+C.r}`);
  process.exit(1);
}
console.log(`${C.grn}${C.bld}✔ Schéma OK${C.r}${!FULL && debtGov ? C.dim+` (${debtGov} carte(s) à backfiller — passe --full pour bloquer)`+C.r : ''}${baseline.size ? C.dim+` (${baseline.size} carte(s) sous dette tests ratchet)`+C.r : ''}`);

