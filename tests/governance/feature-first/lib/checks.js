/**
 * @komerce-arch
 * @role          feature-first-contract-checks
 * @domain        infrastructure
 * @layer         test-lib
 * @criticality   critical
 * @inputs        graphe de faits (feature-graph.js), baseline.json
 * @outputs       verdicts FF-*
 * @depends       tests/e2e/feature-first/lib/feature-graph.js
 * @db-write      none
 * @db-read       none
 * @used-by       scripts/feature-first-conformance.js
 * @doctrine      feature_first, cliquet
 * @version       2026-07
 *
 * @brief  Les affirmations POSITIVES de la doctrine Feature First.
 *
 * Chaque contrôle *affirme* qu'une invariante tient. C'est la différence avec
 * les gates historiques, qui vérifiaient l'absence de mauvais : une règle
 * supprimée ne crée aucune violation et laisse tous les gates négatifs verts.
 * Ici, supprimer la règle casse l'affirmation.
 *
 * Deux natures de contrôle :
 *   · DUR     — 0 toléré, aucune baseline. Casser = casser la doctrine.
 *   · CLIQUET — l'état réel est figé dans baseline.json. Une hausse bloque,
 *               une baisse est acceptée et doit être re-figée (`--save`).
 *               On ne bloque jamais sur la dette existante ; on interdit
 *               qu'elle grossisse.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, pairsOf } = require('./feature-graph');

const KIND_VOCAB = new Set([
  // 'technical-foundation' ajouté 2026-07-29 : oublié à la première écriture
  // de ce fichier alors que l'ontologie (docs/doctrine/ONTOLOGIE_FEATURE_FIRST.md
  // §1, Niveau 2) le définit explicitement comme second kind admis pour
  // classification.axis = 'support', distinct de 'technical-transversal'.
  // Sans lui, FF-A4 rejetait à tort infrastructure (seule feature du dépôt
  // portant ce kind).
  'business-feature', 'business-transversal',
  'technical-transversal', 'technical-foundation',
  'deprecated',
]);
const STATUS_VOCAB = new Set(['draft', 'staging', 'production', 'deprecated']);
const REQUIRED_FIELDS = [
  'name', 'type', 'domain', 'status', 'owner',
  'service', 'perimeter', 'authority', 'invariants',
];

const PASS = 'PASS';
const FAIL = 'FAIL';
const WARN = 'WARN';

// ── Helpers ────────────────────────────────────────────────────────────────

// BUGFIX (2026-07-29) : cette fonction dérivait support/business à partir de
// `m.type === 'transversal'`, en violation directe de la doctrine d'ontologie
// qui fait de `classification.axis` la SEULE source de cette binarité — `type`
// est un champ historique de topologie (feature vs transversal) et ne doit
// JAMAIS servir à dériver l'axe business/support. Conséquence du bug : toute
// feature business-transversal portant `type: 'transversal'` (dashboard,
// auth-identity, notifications, documents, incident-management...) était
// classée à tort 'support', ce qui produisait de faux positifs FF-C2 (les
// arêtes dashboard -> * et auth-identity -> * lues comme des inversions
// support → métier alors que dashboard et auth-identity SONT du métier).
const featureKind = m =>
  ((m.classification || {}).axis === 'support') ? 'support' : 'business';

function sccMax(edges) {
  const adj = new Map();
  const nodes = new Set();
  for (const e of edges) {
    nodes.add(e.from); nodes.add(e.to);
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from).add(e.to);
  }
  let idx = 0;
  const index = new Map(), low = new Map(), onStack = new Map(), stack = [], comps = [];
  const strong = v => {
    index.set(v, idx); low.set(v, idx); idx++; stack.push(v); onStack.set(v, true);
    for (const w of (adj.get(v) || [])) {
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.get(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const c = []; let w;
      do { w = stack.pop(); onStack.set(w, false); c.push(w); } while (w !== v);
      comps.push(c.sort());
    }
  };
  for (const n of nodes) if (!index.has(n)) strong(n);
  const nonTrivial = comps.filter(c => c.length > 1).sort((a, b) => b.length - a.length);
  return { max: nonTrivial.length ? nonTrivial[0].length : 0, components: nonTrivial };
}

// Cliquet ensembliste : un élément DÉJÀ connu ne bloque pas, un élément
// NOUVEAU bloque. Plus fort qu'un cliquet sur un simple compteur, qui laisse
// passer une substitution (on retire une dette, on en ajoute une autre).
function ratchetSet(actual, baseline, label) {
  const known = new Set(baseline || []);
  const added = actual.filter(x => !known.has(x));
  const removed = [...known].filter(x => !actual.includes(x));
  if (added.length) {
    return {
      status: FAIL,
      detail: `${added.length} nouvel(le)(s) ${label} hors cliquet (figé à ${known.size})`,
      evidence: added,
    };
  }
  if (removed.length) {
    return {
      status: WARN,
      detail: `${removed.length} ${label} résorbé(e)(s) — re-figer le cliquet (\`--save\`)`,
      evidence: removed,
    };
  }
  return { status: PASS, detail: `${actual.length} ${label} — cliquet tenu`, evidence: [] };
}

function ratchetCount(actual, baseline, label) {
  const max = Number.isFinite(baseline) ? baseline : actual;
  if (actual > max) {
    return { status: FAIL, detail: `${label} : ${actual} > cliquet ${max} — la dette grossit`, evidence: [] };
  }
  if (actual < max) {
    return { status: WARN, detail: `${label} : ${actual} < cliquet ${max} — re-figer (\`--save\`)`, evidence: [] };
  }
  return { status: PASS, detail: `${label} : ${actual} — cliquet tenu`, evidence: [] };
}

function hard(condition, okMsg, koMsg, evidence = []) {
  return condition
    ? { status: PASS, detail: okMsg, evidence: [] }
    : { status: FAIL, detail: koMsg, evidence };
}

// ── Les contrôles ──────────────────────────────────────────────────────────

function runAllChecks(g, baseline = {}) {
  const b = baseline || {};
  const out = [];
  const add = (id, block, title, kind, res) =>
    out.push({ id, block, title, kind, ...res });

  // ═══ BLOC A — ONTOLOGIE : tout est une feature, et elle se déclare ═══════

  const broken = g.manifests.filter(m => m._loadError);
  add('FF-A1', 'A · Ontologie', 'Tout manifest charge sans erreur', 'DUR',
    hard(broken.length === 0,
      `${g.valid.length} manifests chargés (${g.features.length} features + ${g.capabilities.length} capabilities)`,
      `${broken.length} manifest(s) illisible(s)`,
      broken.map(m => `${m._file} : ${m._loadError}`)));

  const missingFields = [];
  for (const m of g.valid) {
    if (String(m._file).startsWith('capabilities/')) continue; // schéma distinct (PILOTING_CAPABILITY_DOCTRINE §4)
    for (const f of REQUIRED_FIELDS) {
      const v = m[f];
      if (v === undefined || v === null || v === '') missingFields.push(`${m.name || m._file} → ${f}`);
    }
  }
  add('FF-A2', 'A · Ontologie', 'Chaque feature porte ses champs de Niveau 0', 'DUR',
    hard(missingFields.length === 0,
      `${REQUIRED_FIELDS.length} champs obligatoires présents sur toutes les features`,
      `${missingFields.length} champ(s) manquant(s)`, missingFields));

  const unclassified = g.valid
    .filter(m => !String(m._file).startsWith('capabilities/'))
    .filter(m => !m.classification || !m.classification.kind)
    .map(m => m.name || m._file)
    .sort();
  add('FF-A3', 'A · Ontologie',
    'Chaque feature est explicitement business OU support', 'CLIQUET',
    ratchetSet(unclassified, b.unclassifiedFeatures, 'feature(s) sans classification'));

  const badKind = g.valid
    .filter(m => m.classification && m.classification.kind && !KIND_VOCAB.has(m.classification.kind))
    .map(m => `${m.name} → ${m.classification.kind}`);
  add('FF-A4', 'A · Ontologie', 'La classification reste dans un vocabulaire fermé', 'DUR',
    hard(badKind.length === 0,
      `vocabulaire respecté : ${[...KIND_VOCAB].join(' | ')}`,
      'classification hors vocabulaire', badKind));

  const badStatus = g.valid
    .filter(m => m.status && !STATUS_VOCAB.has(m.status))
    .map(m => `${m.name} → ${m.status}`);
  add('FF-A5', 'A · Ontologie', 'Le statut de cycle de vie reste dans un vocabulaire fermé', 'DUR',
    hard(badStatus.length === 0, `statuts valides : ${[...STATUS_VOCAB].join(' | ')}`,
      'statut hors vocabulaire', badStatus));

  // ═══ BLOC B — COUVERTURE : rien ne vit hors d'une feature ════════════════

  add('FF-B1', 'B · Couverture',
    'Aucun fichier runtime backend hors feature', 'CLIQUET',
    ratchetSet(g.orphans.sort(), b.orphanArtifacts, 'artefact(s) orphelin(s)'));

  add('FF-B2', 'B · Couverture', 'Aucun fichier possédé par deux features', 'DUR',
    hard(g.multiOwned.length === 0,
      `propriété unique sur ${g.ownership.size} fichiers déclarés`,
      `${g.multiOwned.length} fichier(s) en multipropriété`,
      g.multiOwned.map(x => `${x.file} ← ${x.features.join(' + ')}`)));

  add('FF-B3', 'B · Couverture', 'Aucun fichier déclaré absent du disque', 'DUR',
    hard(g.declaredMissing.length === 0,
      'chaque chemin backend déclaré existe',
      `${g.declaredMissing.length} chemin(s) déclaré(s) introuvable(s)`, g.declaredMissing));

  const testsOnDisk = g.onDisk.filter(f => f.startsWith('tests/') && /\.(test|spec)\.js$/.test(f));
  const testsUnowned = testsOnDisk.filter(f => !g.ownership.has(f));
  add('FF-B4', 'B · Couverture',
    'Chaque test appartient à la feature qu\'il prouve', 'CLIQUET',
    ratchetCount(testsUnowned.length, b.unownedTests, 'tests non rattachés'));

  const scriptsOnDisk = g.onDisk.filter(f => f.startsWith('scripts/') && /\.(js|mjs|cjs)$/.test(f));
  const scriptsUnowned = scriptsOnDisk.filter(f => !g.ownership.has(f));
  add('FF-B5', 'B · Couverture',
    'Chaque outil de gouvernance appartient à une feature support', 'CLIQUET',
    ratchetCount(scriptsUnowned.length, b.unownedScripts, 'scripts non rattachés'));

  const migrationsOnDisk = g.onDisk.filter(f => f.startsWith('migrations/'));
  const migrationsUnowned = migrationsOnDisk.filter(f => !g.ownership.has(f));
  add('FF-B6', 'B · Couverture',
    'Chaque migration appartient à la feature dont elle change le schéma', 'CLIQUET',
    ratchetCount(migrationsUnowned.length, b.unownedMigrations, 'migrations non rattachées'));

  // ═══ BLOC C — FRONTIÈRES : le code respecte les contrats déclarés ════════

  const undeclaredPairs = [...pairsOf(g.classified.undeclared).keys()].sort();
  add('FF-C1', 'C · Frontières',
    'Toute dépendance inter-feature est déclarée dans contract.consumes', 'DUR',
    hard(undeclaredPairs.length === 0,
      '0 paire inter-feature non déclarée',
      `${undeclaredPairs.length} paire(s) inter-feature non déclarée(s)`,
      undeclaredPairs));

  const kindOf = new Map(g.valid.map(m => [m.name || m._file, featureKind(m)]));
  const supportToBusiness = [...g.classified.declared, ...g.classified.undeclared, ...g.classified.ambient]
    .filter(e => kindOf.get(e.from) === 'support' && kindOf.get(e.to) === 'business')
    .filter(e => !g.compositionRoots.has(e.file))
    .filter(e => !(g.supportExceptions || new Set()).has(`${e.from}|${e.to}|${e.file}|${e.target}`))
    .map(e => `${e.from} -> ${e.to} · ${e.file} -> ${e.target}`)
    .sort();
  add('FF-C2', 'C · Frontières',
    'Une feature support ne dépend du métier que par un composition root', 'DUR',
    hard(supportToBusiness.length === 0,
      '0 inversion support → métier hors composition root ou exception nominative',
      `${supportToBusiness.length} inversion(s) support → métier`,
      supportToBusiness));

  const businessEdges = [...g.classified.declared, ...g.classified.undeclared]
    .filter(e => kindOf.get(e.from) === 'business' && kindOf.get(e.to) === 'business');
  const scc = sccMax(businessEdges);
  add('FF-C3', 'C · Frontières',
    'L\'enchevêtrement mutuel des features métier ne grossit pas', 'CLIQUET',
    (() => {
      const r = ratchetCount(scc.max, b.businessSccMax, 'plus grande composante mutuellement dépendante');
      r.evidence = scc.components.map(c => `{ ${c.join(', ')} }`);
      return r;
    })());

  const ambientTargets = [...new Set(g.classified.ambient.map(e => e.to))];
  add('FF-C4', 'C · Frontières',
    'La dépendance ambiante non déclarée ne vise que l\'infrastructure', 'DUR',
    hard(ambientTargets.every(t => t === 'infrastructure'),
      `${g.classified.ambient.length} imports ambiants, tous vers infrastructure`,
      'dépendance ambiante hors infrastructure', ambientTargets));

  // ═══ BLOC D — INTERFACE : ce qui est exposé est réellement câblé ═════════

  const mountedUnowned = g.mounted
    .filter(r => r.file && !g.ownership.has(r.file))
    .map(r => `${r.mountPath} → ${r.file}`);
  add('FF-D1', 'D · Interface',
    'Chaque route montée au démarrage appartient à une feature', 'DUR',
    hard(mountedUnowned.length === 0,
      `${g.mounted.length} montages de routeur, tous rattachés`,
      `${mountedUnowned.length} route(s) montée(s) sans propriétaire`, mountedUnowned));

  const exposesUnbacked = [];
  for (const m of g.valid) {
    const exposes = ((m.contract || {}).exposes) || [];
    const owned = (((m.files || {}).routes) || []).filter(f => fs.existsSync(path.join(ROOT, f)));
    if (!exposes.length) continue;
    if (!owned.length) { exposes.forEach(e => exposesUnbacked.push(`${m.name} · ${e} (aucun fichier route possédé)`)); continue; }
    const corpus = owned.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    for (const raw of exposes) {
      // "GET/POST /api/orders/:id/cancel" → dernier segment littéral significatif
      const url = String(raw).split(/\s+/).slice(1).join(' ') || String(raw);
      const segs = url.split('/').filter(s => s && !s.startsWith(':'));
      const needle = segs.length ? segs[segs.length - 1] : null;
      if (needle && !corpus.includes(needle)) exposesUnbacked.push(`${m.name} · ${raw}`);
    }
  }
  add('FF-D2', 'D · Interface',
    'Chaque endpoint déclaré se retrouve dans une route possédée', 'CLIQUET',
    ratchetSet(exposesUnbacked.sort(), b.exposesUnbacked, 'endpoint(s) déclaré(s) sans trace'));

  // ═══ BLOC E — PREUVE : chaque feature prouve ce qu'elle affirme ══════════

  const invariantsWithoutTest = [];
  const invariantTestMissing = [];
  for (const m of g.valid) {
    for (const inv of m.invariants || []) {
      if (typeof inv === 'string') { invariantsWithoutTest.push(`${m.name} · ${inv.slice(0, 70)}`); continue; }
      if (inv && inv.test && !fs.existsSync(path.join(ROOT, inv.test))) {
        invariantTestMissing.push(`${m.name} · ${inv.test}`);
      }
    }
  }
  add('FF-E1', 'E · Preuve',
    'Tout invariant qui cite un test pointe un fichier existant', 'DUR',
    hard(invariantTestMissing.length === 0,
      'chaque test d\'invariant référencé existe',
      `${invariantTestMissing.length} test(s) d'invariant introuvable(s)`, invariantTestMissing));

  add('FF-E2', 'E · Preuve',
    'Un invariant est adossé à un test, pas seulement à une phrase', 'CLIQUET',
    ratchetCount(invariantsWithoutTest.length, b.invariantsWithoutTest, 'invariants sans test adossé'));

  const prodWithoutTest = g.valid
    .filter(m => m.status === 'production' && !String(m._file).startsWith('capabilities/'))
    .filter(m => !(((m.files || {}).tests) || []).some(t => fs.existsSync(path.join(ROOT, t))))
    .map(m => m.name);
  add('FF-E3', 'E · Preuve',
    'Toute feature en production déclare au moins un test qui existe', 'DUR',
    hard(prodWithoutTest.length === 0,
      'chaque feature de production porte au moins une preuve',
      `${prodWithoutTest.length} feature(s) de production sans test`, prodWithoutTest));

  // Une spec qui n'arrive pas à résoudre ses propres imports ne tourne pas.
  // C'est exactement le trou qui a laissé passer la régression de la modal :
  // un e2e qui tourne dans le vide est pire que pas d'e2e — il rassure.
  const deadSpecs = [];
  for (const f of g.onDisk.filter(x => x.startsWith('tests/') && /\.spec\.js$/.test(x))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const rx = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let m;
    while ((m = rx.exec(src)) !== null) {
      const base = path.resolve(path.dirname(path.join(ROOT, f)), m[1]);
      const found = [base, `${base}.js`, path.join(base, 'index.js')]
        .some(c => { try { return fs.statSync(c).isFile(); } catch { return false; } });
      if (!found) { deadSpecs.push(`${f} → ${m[1]}`); break; }
    }
  }
  add('FF-E4', 'E · Preuve',
    'Aucune spec E2E ne tourne dans le vide (imports résolus)', 'CLIQUET',
    ratchetSet(deadSpecs.sort(), b.deadSpecs, 'spec(s) E2E non exécutable(s)'));

  // ═══ BLOC F — DONNÉES : la propriété va jusqu'à la table ════════════════

  const multiWriter = g.multiWriterTables.map(t => t.table).sort();
  add('FF-F1', 'F · Données',
    'Aucune nouvelle table à écrivains multiples', 'CLIQUET',
    (() => {
      const r = ratchetSet(multiWriter, b.multiWriterTables, 'table(s) multi-écrivains');
      if (r.status === PASS) {
        r.evidence = g.multiWriterTables.slice(0, 5)
          .map(t => `${t.table} (${t.features.length}) : ${t.features.join(', ')}`);
      }
      return r;
    })());

  return out;
}

// Reconstruit une baseline à partir de la réalité observée.
function snapshotBaseline(g) {
  const kindOf = new Map(g.valid.map(m => [m.name || m._file, featureKind(m)]));
  const testsUnowned = g.onDisk.filter(f => f.startsWith('tests/') && /\.(test|spec)\.js$/.test(f) && !g.ownership.has(f));
  const scriptsUnowned = g.onDisk.filter(f => f.startsWith('scripts/') && /\.(js|mjs|cjs)$/.test(f) && !g.ownership.has(f));
  const migrationsUnowned = g.onDisk.filter(f => f.startsWith('migrations/') && !g.ownership.has(f));
  const businessEdges = [...g.classified.declared, ...g.classified.undeclared]
    .filter(e => kindOf.get(e.from) === 'business' && kindOf.get(e.to) === 'business');

  const probe = runAllChecks(g, {});
  const ev = id => (probe.find(c => c.id === id) || {}).evidence || [];

  return {
    _doctrine: 'Cliquet Feature First — une hausse bloque, une baisse se re-fige (`npm run e2e:ff:save`).',
    _frozenAt: new Date().toISOString().slice(0, 10),
    unclassifiedFeatures: g.valid
      .filter(m => !String(m._file).startsWith('capabilities/'))
      .filter(m => !m.classification || !m.classification.kind)
      .map(m => m.name).sort(),
    orphanArtifacts: g.orphans.slice().sort(),
    unownedTests: testsUnowned.length,
    unownedScripts: scriptsUnowned.length,
    unownedMigrations: migrationsUnowned.length,
    undeclaredEdges: [...pairsOf(g.classified.undeclared).keys()].sort(),
    supportToBusiness: [...g.classified.declared, ...g.classified.undeclared, ...g.classified.ambient]
      .filter(e => kindOf.get(e.from) === 'support' && kindOf.get(e.to) === 'business')
      .filter(e => !g.compositionRoots.has(e.file))
      .filter(e => !(g.supportExceptions || new Set()).has(`${e.from}|${e.to}|${e.file}|${e.target}`))
      .map(e => `${e.from} -> ${e.to} · ${e.file} -> ${e.target}`).sort(),
    businessSccMax: sccMax(businessEdges).max,
    exposesUnbacked: ev('FF-D2').slice().sort(),
    invariantsWithoutTest: g.valid
      .reduce((n, m) => n + (m.invariants || []).filter(i => typeof i === 'string').length, 0),
    deadSpecs: ev('FF-E4').slice().sort(),
    multiWriterTables: g.multiWriterTables.map(t => t.table).sort(),
  };
}

module.exports = { runAllChecks, snapshotBaseline, PASS, FAIL, WARN, featureKind, sccMax };
