#!/usr/bin/env node
/**
 * registry-doc-check.js
 * Niveau 0 de la Pyramide (docs/doctrine/FEATURE_DOCTRINE.md) : vérifie que
 * docs/doctrine/APP_FEATURE_REGISTRY.md — le registre canonique — est en
 * bijection stricte avec les manifests réels de features/*.feature.js.
 *
 * Contrairement à feature-registry-check.js (qui vérifie le contenu des
 * manifests et leurs fichiers déclarés), ce script vérifie le DOCUMENT
 * lui-même : chaque lien du tableau doit pointer vers un fichier qui existe,
 * et chaque manifest existant doit apparaître dans exactement une ligne.
 *
 * Créé le 2026-07-06 suite à l'audit gouvernance : le registre affirmait être
 * "vérifié par node scripts/feature-registry-check.js" alors qu'aucun script
 * ne le lisait — il avait dérivé du disque (2 liens morts, 3 manifests
 * absents du tableau) sans qu'aucun outil ne le signale.
 *
 * Usage :
 *   node scripts/registry-doc-check.js               → rapport
 *   node scripts/registry-doc-check.js --strict      → exit(1) si erreurs (CI)
 *   node scripts/registry-doc-check.js --json         → sortie JSON machine
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT          = path.join(__dirname, '..');
const FEATURES_DIR   = path.join(ROOT, 'features');
const REGISTRY_FILE  = path.join(ROOT, 'docs', 'doctrine', 'APP_FEATURE_REGISTRY.md');
const STRICT         = process.argv.includes('--strict');
const JSON_OUTPUT    = process.argv.includes('--json');

// Capture les liens Markdown du type [`x.feature.js`](../../features/x.feature.js)
const LINK_RE = /\[`([^`]+\.feature\.js)`\]\(\.\.\/\.\.\/features\/([^)]+\.feature\.js)\)/g;

function run() {
  const errors = [];

  if (!fs.existsSync(REGISTRY_FILE)) {
    errors.push({ type: 'REGISTRY-MISSING', msg: `${path.relative(ROOT, REGISTRY_FILE)} introuvable` });
    return report(errors, [], []);
  }
  if (!fs.existsSync(FEATURES_DIR)) {
    errors.push({ type: 'FEATURES-DIR-MISSING', msg: `${path.relative(ROOT, FEATURES_DIR)} introuvable` });
    return report(errors, [], []);
  }

  const registryContent = fs.readFileSync(REGISTRY_FILE, 'utf8');
  const registryLinks = []; // { linkText, linkTarget }
  let m;
  while ((m = LINK_RE.exec(registryContent)) !== null) {
    registryLinks.push({ linkText: m[1], linkTarget: m[2] });
  }

  const diskManifests = fs.readdirSync(FEATURES_DIR)
    .filter(f => f.endsWith('.feature.js') && !f.startsWith('_'));

  // 1. Chaque lien du registre doit pointer vers un fichier qui existe réellement
  for (const link of registryLinks) {
    if (!diskManifests.includes(link.linkTarget)) {
      errors.push({
        type: 'BROKEN-LINK',
        msg: `le registre référence "${link.linkTarget}" mais ce fichier n'existe pas dans features/ — lien mort`,
      });
    }
    if (link.linkText !== link.linkTarget) {
      errors.push({
        type: 'LINK-TEXT-MISMATCH',
        msg: `le texte du lien ("${link.linkText}") ne correspond pas à sa cible ("${link.linkTarget}")`,
      });
    }
  }

  // 2. Chaque manifest disque doit apparaître dans exactement une ligne du registre
  const registeredTargets = registryLinks.map(l => l.linkTarget);
  for (const file of diskManifests) {
    const count = registeredTargets.filter(t => t === file).length;
    if (count === 0) {
      errors.push({
        type: 'UNREGISTERED-MANIFEST',
        msg: `${file} existe dans features/ mais n'apparaît dans aucune ligne du registre — ajouter une ligne dans APP_FEATURE_REGISTRY.md`,
      });
    } else if (count > 1) {
      errors.push({
        type: 'DUPLICATE-REGISTRATION',
        msg: `${file} apparaît ${count} fois dans le registre — une seule ligne attendue par manifest`,
      });
    }
  }

  return report(errors, registryLinks, diskManifests);
}

function report(errors, registryLinks, diskManifests) {
  const summary = {
    registry_links: registryLinks.length,
    disk_manifests: diskManifests.length,
    errors: errors.length,
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ summary, errors }, null, 2));
    if (STRICT && errors.length > 0) process.exit(1);
    return;
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  Registry Doc Check — bijection disque ↔ registre         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Liens dans le registre : ${summary.registry_links}`);
  console.log(`  Manifests sur disque   : ${summary.disk_manifests}`);
  console.log(`  Erreurs                : ${summary.errors}`);

  if (errors.length === 0) {
    console.log('\n  ✅ Registre et disque en bijection stricte.\n');
    return;
  }

  console.log(`\n  ❌ ${errors.length} erreur(s)\n`);
  for (const e of errors) {
    console.log(`  [${e.type}] ${e.msg}`);
  }
  console.log('');

  if (STRICT) process.exit(1);
}

run();
