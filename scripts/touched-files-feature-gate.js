#!/usr/bin/env node
'use strict';

/**
 * touched-files-feature-gate.js — Gate 1 (clé de voûte).
 *
 *   Tout fichier applicatif modifié dans une PR doit appartenir au `files` d'une
 *   carte de feature, ou à un périmètre transversal déclaré. Sinon → merge bloqué.
 *
 *   Effet : « toute demande entre par une feature » cesse d'être une intention et
 *   devient une condition de merge. Et les `files` des cartes restent honnêtes
 *   mécaniquement — toucher un fichier force à le déclarer quelque part.
 *
 *   Le transversal (auth, db, cache, middleware, infra…) n'est PAS une feature
 *   métier : il est couvert soit par une carte `type:'transversal'`, soit par
 *   governance/transversal-paths.json (globs), pour ne pas tordre l'abstraction.
 *
 * Usage :
 *   node scripts/touched-files-feature-gate.js                 # git diff vs origin/main
 *   node scripts/touched-files-feature-gate.js --base <ref>
 *   node scripts/touched-files-feature-gate.js --files a,b,c   # test / CI custom
 *   node scripts/touched-files-feature-gate.js --root DIR
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const args = process.argv.slice(2);
const ROOT = path.resolve(argVal('--root') || process.cwd());
function argVal(f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; }
const C = { red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', dim: '\x1b[2m', bld: '\x1b[1m', r: '\x1b[0m' };

// ── Fichiers applicatifs à gouverner (le reste = non concerné) ──────────────
// On gouverne le code source. On exclut : docs, archive, généré (dist), infra de
// dépôt, dépendances. Les fichiers générés sont couverts par le gate --check.
const ENFORCE_EXT = /\.(js|mjs|cjs|ts|css|html)$/;
const EXCLUDE = [
  /^archive\//, /node_modules\//, /\/dist\//, /\.github\//, /(^|\/)docs\//,
  /\.md$/, /\.feature\.js$/, /\.capability\.js$/, /(^|\/)tests?\//, /\.spec\.js$/, /\.test\.js$/,
  /(^|\/)migrations\//, /(^|\/)scripts\//,        // infra repo (gouvernée à part)
  /package(-lock)?\.json$/, /\.config\.(js|cjs|mjs)$/,
];

// ── Périmètres ──────────────────────────────────────────────────────────────
function loadCards() {
  const cards = [];
  for (const dir of ['features', 'public/boutique/features']) {
    const abs = path.join(ROOT, dir); if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.feature.js')) continue;
      try { const m = require(path.join(abs, f)); m.__base = abs; cards.push(m); } catch {}
    }
  }
  return cards;
}

// Piloting capabilities (docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md) — même
// mécanique de propriété que les cartes feature, déjà reconnue par
// feature-registry-check.js (Lot O1). Sans ce chargement, un fichier retiré
// d'une feature pour être gouverné comme capability redevient "orphelin" ici.
function loadCapabilities() {
  const caps = [];
  const abs = path.join(ROOT, 'capabilities');
  if (!fs.existsSync(abs)) return caps;
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith('.capability.js')) continue;
    try { const m = require(path.join(abs, f)); m.__base = abs; caps.push(m); } catch {}
  }
  return caps;
}

function repoRel(abs) {
  return path.relative(ROOT, abs).replace(/\\/g, '/');
}

// Préfixes par catégorie (même logique que feature-guard.js).
// Pas de vérification filesystem — repos dash/boutique séparés du backend.
const CATEGORY_PREFIX = { boutique: 'public/boutique', dash: 'public' };

function declaredPath(cardBase, rel, category) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.endsWith('/')) return null;

  if (clean.startsWith('../')) return repoRel(path.resolve(cardBase, clean));

  // Category-based prefix — résolution sans filesystem
  const prefix = CATEGORY_PREFIX[category];
  if (prefix) return `${prefix}/${clean}`;

  const rootCandidate = path.join(ROOT, clean);
  if (fs.existsSync(rootCandidate)) return clean;

  const localCandidate = path.resolve(cardBase, clean);
  if (fs.existsSync(localCandidate)) return repoRel(localCandidate);

  // New files may be declared before they exist locally. Treat those as
  // repo-relative by default; the touched file itself will still be checked.
  return clean;
}

// repo-relative file set + owner index
function ownershipIndex(cards, capabilities) {
  const owner = {};                  // repoRelPath -> feature/capability name
  const transversalCards = [];
  for (const m of cards) {
    for (const [category, files] of Object.entries(m.files || {})) {
      for (const rel of (files || [])) {
        const repoRelPath = declaredPath(m.__base, rel, category);
        if (repoRelPath) owner[repoRelPath] = m.name;
      }
    }
    if (m.type === 'transversal') transversalCards.push(m.name);
  }
  for (const m of (capabilities || [])) {
    for (const [category, files] of Object.entries(m.files || {})) {
      for (const rel of (files || [])) {
        const repoRelPath = declaredPath(m.__base, rel, category);
        if (repoRelPath && !owner[repoRelPath]) owner[repoRelPath] = `capability:${m.name}`;
      }
    }
  }
  return { owner, transversalCards };
}

function loadTransversalGlobs() {
  const f = path.join(ROOT, 'governance', 'transversal-paths.json');
  let globs = [
    // défauts raisonnables — surchargés par governance/transversal-paths.json
    'core/', 'bootstrap/', 'middleware/', 'db/', 'db.js',
  ];
  if (fs.existsSync(f)) {
    try { globs = JSON.parse(fs.readFileSync(f, 'utf8')).paths || globs; } catch {}
  }
  return globs;
}

// ── Liste des fichiers touchés ──────────────────────────────────────────────
function touched() {
  const explicit = argVal('--files');
  if (explicit) return explicit.split(',').map(s => s.trim()).filter(Boolean);
  const base = argVal('--base') || 'origin/main';
  try {
    // Un fichier supprimé n'a plus à être revendiqué par une carte courante :
    // le gate gouverne les artefacts encore présents après le changement.
    const out = cp.execSync(`git diff --name-only --diff-filter=ACMRTUXB ${base}...HEAD`, { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    console.error(`${C.ylw}⚠ git diff impossible (${e.message.split('\n')[0]}). Utilise --files pour tester.${C.r}`);
    process.exit(2);
  }
}

const cards = loadCards();
const capabilities = loadCapabilities();
const { owner, transversalCards } = ownershipIndex(cards, capabilities);
const transversalGlobs = loadTransversalGlobs();
const changed = touched().map(f => f.replace(/\\/g, '/'));

const enforced = changed.filter(f => ENFORCE_EXT.test(f) && !EXCLUDE.some(rx => rx.test(f)));
const skipped  = changed.filter(f => !enforced.includes(f));

console.log(`\n${C.bld}Gate 1 — Fichiers touchés → carte${C.r}  ${C.dim}(${changed.length} modifié(s), ${enforced.length} gouverné(s))${C.r}\n`);

const orphans = [];
for (const f of enforced) {
  if (owner[f]) { console.log(`${C.grn}✔${C.r} ${f} ${C.dim}→ ${owner[f]}${C.r}`); continue; }
  const tg = transversalGlobs.find(g => f.startsWith(g));
  if (tg) { console.log(`${C.grn}✔${C.r} ${f} ${C.dim}→ transversal (${tg})${C.r}`); continue; }
  orphans.push(f);
}

if (skipped.length) {
  console.log(`${C.dim}(${skipped.length} fichier(s) hors périmètre de gouvernance : docs, dist, tests, scripts, config)${C.r}`);
}

if (orphans.length) {
  console.log(`\n${C.red}${C.bld}✖ ${orphans.length} fichier(s) sans propriétaire feature/transversal :${C.r}`);
  orphans.forEach(f => console.log(`${C.red}   ↳ ${f}${C.r}`));
  console.log(`${C.dim}  → ajoute-les au \`files\` d'une carte features/*.feature.js,${C.r}`);
  console.log(`${C.dim}    ou déclare-les transversaux dans governance/transversal-paths.json.${C.r}`);
  process.exit(1);
}

console.log(`\n${C.grn}${C.bld}✔ Tout fichier gouverné appartient à une feature ou à un transversal.${C.r}`);
