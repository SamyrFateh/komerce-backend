#!/usr/bin/env node
'use strict';

/**
 * Gate concept-impact — gouvernance des concepts metier inter-features.
 *
 * Un concept versionne possede un owner, des chemins de contrat et des
 * consommateurs. Toute modification d'un chemin de contrat doit :
 *   1. changer la revision canonique du concept ;
 *   2. recevoir un ACK explicite de chaque consommateur pour cette revision.
 *
 * Usage:
 *   node scripts/concept-impact-gate.js
 *   node scripts/concept-impact-gate.js --base origin/main
 *   node scripts/concept-impact-gate.js --files docs/doctrine/X.md
 *   node scripts/concept-impact-gate.js --root DIR
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const args = process.argv.slice(2);
const ROOT = path.resolve(argVal('--root') || process.cwd());
const BASE = argVal('--base') || 'origin/main';
const REGISTRY_PATH = path.join(ROOT, 'governance', 'concepts.json');
const ACKS_PATH = path.join(ROOT, 'governance', 'concept-impact-acks.json');
const ALLOWED_ACK = new Set(['compatible', 'adapted', 'not-applicable']);

function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function changedFiles() {
  const explicit = argVal('--files');
  if (explicit) return explicit.split(',').map(s => s.trim().replace(/\\/g, '/')).filter(Boolean);
  try {
    const out = cp.execSync(`git diff --name-only ${BASE}...HEAD`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split('\n').map(s => s.trim().replace(/\\/g, '/')).filter(Boolean);
  } catch (e) {
    console.error(`✖ concept-impact: git diff impossible contre ${BASE}: ${e.message.split('\n')[0]}`);
    process.exit(2);
  }
}

function readBaseRegistry() {
  try {
    const raw = cp.execSync(`git show ${BASE}:governance/concepts.json`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return { concepts: [] };
  }
}

function key(c) {
  return `${c.id}@${c.version}`;
}

function fail(errors, message) {
  errors.push(message);
  console.log(`✖ ${message}`);
}

if (!fs.existsSync(REGISTRY_PATH)) {
  console.error('✖ concept-impact: governance/concepts.json absent');
  process.exit(1);
}
if (!fs.existsSync(ACKS_PATH)) {
  console.error('✖ concept-impact: governance/concept-impact-acks.json absent');
  process.exit(1);
}

const registry = readJson(REGISTRY_PATH);
const ackDoc = readJson(ACKS_PATH);
const concepts = Array.isArray(registry.concepts) ? registry.concepts : [];
const acks = Array.isArray(ackDoc.acks) ? ackDoc.acks : [];
const changed = new Set(changedFiles());
const baseConcepts = new Map((readBaseRegistry().concepts || []).map(c => [key(c), c]));
const errors = [];
const seenConcepts = new Set();

console.log(`\nGate concept-impact — ${concepts.length} concept(s), ${changed.size} fichier(s) modifie(s)\n`);

for (const concept of concepts) {
  const conceptKey = key(concept);
  if (!concept.id || !Number.isInteger(concept.version) || concept.version < 1) {
    fail(errors, `concept invalide: id/version requis (${JSON.stringify(concept)})`);
    continue;
  }
  if (seenConcepts.has(conceptKey)) {
    fail(errors, `concept duplique: ${conceptKey}`);
    continue;
  }
  seenConcepts.add(conceptKey);

  if (!concept.owner || !concept.revision || !Array.isArray(concept.contractPaths) || !concept.contractPaths.length) {
    fail(errors, `${conceptKey}: owner, revision et contractPaths sont obligatoires`);
    continue;
  }
  if (!Array.isArray(concept.consumers)) {
    fail(errors, `${conceptKey}: consumers doit etre un tableau`);
    continue;
  }

  const contractChanged = concept.contractPaths.some(p => changed.has(String(p).replace(/\\/g, '/')));
  const registryChanged = changed.has('governance/concepts.json');
  const previous = baseConcepts.get(conceptKey);
  const isNew = !previous;
  const revisionChanged = isNew || previous.revision !== concept.revision;
  const conceptChanged = contractChanged || (registryChanged && revisionChanged);

  if (contractChanged && previous && !revisionChanged) {
    fail(errors, `${conceptKey}: contrat modifie mais revision inchangee (${concept.revision})`);
    continue;
  }

  if (!conceptChanged) {
    console.log(`· ${conceptKey} — inchange`);
    continue;
  }

  console.log(`! CONCEPT CHANGED: ${conceptKey}`);
  console.log(`  OWNER: ${concept.owner}`);
  console.log(`  REVISION: ${concept.revision}`);
  console.log('  REQUIRED ACK:');

  const consumerNames = new Set();
  for (const consumer of concept.consumers) {
    const feature = typeof consumer === 'string' ? consumer : consumer && consumer.feature;
    const critical = typeof consumer === 'object' && consumer && consumer.critical === true;
    if (!feature) {
      fail(errors, `${conceptKey}: consommateur sans feature`);
      continue;
    }
    if (consumerNames.has(feature)) {
      fail(errors, `${conceptKey}: consommateur duplique ${feature}`);
      continue;
    }
    consumerNames.add(feature);

    const matches = acks.filter(a => a.concept === conceptKey && a.revision === concept.revision && a.feature === feature);
    if (matches.length !== 1) {
      console.log(`    ${feature.padEnd(20)} MISSING${critical ? ' [CRITICAL]' : ''}`);
      fail(errors, `${conceptKey}: ACK exact requis pour ${feature} revision ${concept.revision}`);
      continue;
    }
    const ack = matches[0];
    if (!ALLOWED_ACK.has(ack.status) || typeof ack.reason !== 'string' || ack.reason.trim().length < 20) {
      console.log(`    ${feature.padEnd(20)} INVALID`);
      fail(errors, `${conceptKey}: ACK invalide pour ${feature} (status/reason)`);
      continue;
    }
    console.log(`    ${feature.padEnd(20)} ${ack.status.toUpperCase()}${critical ? ' [CRITICAL]' : ''}`);
  }
}

for (const ack of acks) {
  if (!seenConcepts.has(ack.concept)) fail(errors, `ACK orphelin: concept inconnu ${ack.concept}`);
}

if (errors.length) {
  console.log(`\n✖ concept-impact BLOCK — ${errors.length} erreur(s)`);
  process.exit(1);
}

console.log('\n✔ concept-impact PASS — tous les concepts modifies ont leurs ACKs de consommation');
