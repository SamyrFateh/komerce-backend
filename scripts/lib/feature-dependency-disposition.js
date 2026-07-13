'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Lot O6 — Feature Dependency Disposition (bottom-up, evidence-derived)
//
// Cette couche NE réobserve rien. Elle prend les paires O5 OBSERVED_UNDECLARED
// déjà produites par feature-dependency-conformance.js et leur attribue
// exactement UNE famille architecturale, dérivée des PREUVES réelles de la
// paire (fichiers sources, cibles, canaux, businessKind), jamais du seul nom.
//
// Invariants (voir docs/O6_RECONCILIATION_FACTUELLE.md et le prompt O6) :
//   - 8 familles prouvées, aucune famille à zéro instance inventée.
//   - COMPOSITION_ROOT_WIRING dérive de l'appartenance des fichiers de preuve
//     à l'ensemble wiring (governance/composition-root-files.json) ET du fait
//     que le consumer POSSÈDE un fichier wiring — jamais de `from==='infrastructure'`.
//   - Une forme non comprise => UNCLASSIFIED_OBSERVED_DEPENDENCY (bloquant).
//   - Le ledger d'exceptions ne porte QUE les paires exigeant une décision
//     humaine (F, cycles, ownership suspects). Pas les 94.
//   - tracking (localManifestGap) n'est JAMAIS une paire from->to ; il est
//     couvert par un flux ontologique séparé.
// ─────────────────────────────────────────────────────────────────────────

const FAMILIES = [
  'PROJECTION',
  'COMPOSITION_ROOT_WIRING',
  'NON_RUNTIME_TEST',
  'TECHNICAL_PRIMITIVE',
  'BUSINESS_TRANSVERSAL_SERVICE',
  'CROSS_FEATURE_DIRECT_IMPORT',
  'BUSINESS_FEATURE_INTERFACE',
  'PILOTING_CAPABILITY',
];

// Politique O6 par famille (langage machine minimal). Aucune n'écrit de manifest.
const POLICY = {
  PROJECTION: 'projection-dependency-policy',
  COMPOSITION_ROOT_WIRING: 'application-wiring-not-consumption',
  NON_RUNTIME_TEST: 'non-runtime-evidence',
  TECHNICAL_PRIMITIVE: 'technical-dependency-policy',
  BUSINESS_TRANSVERSAL_SERVICE: 'business-dependency-declare-candidate',
  CROSS_FEATURE_DIRECT_IMPORT: 'boundary-remediation-required',
  BUSINESS_FEATURE_INTERFACE: 'business-dependency-declare-candidate',
  PILOTING_CAPABILITY: 'piloting-capability-dependency',
};

// Familles dont la politique de famille NE suffit PAS à décider sans jugement
// humain -> une entrée de ledger est requise. (F par construction ; les cycles
// et ownership suspects ajoutent des paires d'autres familles, voir buildDispositions.)
const EXCEPTION_FAMILIES = new Set(['CROSS_FEATURE_DIRECT_IMPORT']);

// ── Rôle de preuve d'un fichier source ───────────────────────────────────
function fileEvidenceRole(fileId) {
  if (!fileId) return 'RUNTIME'; // preuve interface sans consumerFileId = vue/module runtime résolu via Meta Graph
  if (/(^|\/)tests?\//.test(fileId) || /\.test\.js$/.test(fileId) || /\.spec\.js$/.test(fileId) || /public\/boutique\/tests\//.test(fileId)) return 'TEST';
  if (/^scripts\//.test(fileId) || /^governance\//.test(fileId)) return 'TOOLING';
  return 'RUNTIME';
}

// Une cible d'import est une primitive technique si le fichier possédé est un
// primitive transverse (middleware, db, logger, request-id, utils, validators, core).
function isTechnicalPrimitiveTarget(target) {
  if (!target) return false;
  return /^middleware\//.test(target)
    || /^db\.js$/.test(target)
    || /(^|\/)logger/.test(target)
    || /request-id/.test(target)
    || /^utils\//.test(target)
    || /^validators\//.test(target)
    || /^core\//.test(target);
}

// ── Analyse d'une paire : rôle agrégé + forme de couplage observée ────────
function analyzePair(pair, ctx) {
  const wiring = ctx.wiringFiles;
  const roles = new Set();
  const channels = new Set();
  const evidenceFiles = [];
  for (const c of pair.channels) {
    channels.add(c.channel);
    for (const e of c.evidence) {
      const src = e.sourceFileId || e.consumerFileId || null;
      const role = fileEvidenceRole(src);
      roles.add(role);
      evidenceFiles.push({ role, channel: c.channel, source: src, target: e.targetFile || null, endpoint: e.endpoint || null });
    }
  }

  let evidenceRole;
  if (roles.size === 1) evidenceRole = [...roles][0] + '_ONLY';
  else if (roles.has('RUNTIME') && roles.has('TEST') && !roles.has('TOOLING')) evidenceRole = 'RUNTIME_AND_TEST';
  else if (roles.has('RUNTIME') && roles.has('TOOLING') && !roles.has('TEST')) evidenceRole = 'RUNTIME_AND_TOOLING';
  else evidenceRole = 'MIXED';

  const runtimeFiles = evidenceFiles.filter(f => f.role === 'RUNTIME');
  const evForShape = runtimeFiles.length ? runtimeFiles : evidenceFiles;
  const hasStatic = channels.has('static-code');
  const hasIface = channels.has('interface');
  const staticTargets = evForShape.filter(f => f.channel === 'static-code').map(f => f.target).filter(Boolean);
  const techTargets = staticTargets.filter(isTechnicalPrimitiveTarget).length;
  const bizTargets = staticTargets.length - techTargets;

  let couplingObserved;
  if (hasStatic && hasIface) couplingObserved = 'mixed';
  else if (hasIface) couplingObserved = 'interface';
  else if (techTargets > 0 && bizTargets === 0) couplingObserved = 'technical-primitive';
  else if (bizTargets > 0 && techTargets === 0) couplingObserved = 'business-file-import';
  else couplingObserved = 'import-mixed';

  // toutes les preuves runtime proviennent-elles de fichiers wiring ?
  const allRuntimeFromWiring = runtimeFiles.length > 0 && runtimeFiles.every(f => wiring.has(f.source));

  return {
    evidenceRole,
    channels: [...channels].sort(),
    couplingObserved,
    allRuntimeFromWiring,
    topEvidence: dedupeEvidence(evidenceFiles),
  };
}

function dedupeEvidence(files) {
  const out = [], seen = new Set();
  for (const f of files) {
    const label = f.channel === 'interface'
      ? `${f.source || '(view)'} -> ${f.endpoint}`
      : `${f.source} -> ${f.target}`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ role: f.role, channel: f.channel, label });
    if (out.length >= 5) break;
  }
  return out;
}

// ── Classification d'une paire en exactement une famille (ou UNCLASSIFIED) ─
function classifyPair(pair, ctx) {
  const a = analyzePair(pair, ctx);
  const consumerKind = ctx.kindOf(pair.from);
  const providerKind = ctx.kindOf(pair.to);

  let family;
  if (a.evidenceRole === 'TEST_ONLY') {
    family = 'NON_RUNTIME_TEST';
  } else if (a.evidenceRole === 'TOOLING_ONLY' || a.evidenceRole === 'RUNTIME_AND_TOOLING') {
    // 0 instance dans l'état O5 actuel — jamais absorbé silencieusement.
    family = 'UNCLASSIFIED';
  } else if (consumerKind === 'projection' || consumerKind === 'frontend-transversal') {
    family = 'PROJECTION';
  } else if (ctx.compRootOwners.has(pair.from)) {
    // Le consumer POSSÈDE des fichiers wiring (dérivé de l'ownership, pas du nom).
    // Légitime UNIQUEMENT si toute la preuve runtime vient de ces fichiers wiring.
    // Sinon : le composition-root touche une feature hors de son rôle => non compris.
    family = a.allRuntimeFromWiring ? 'COMPOSITION_ROOT_WIRING' : 'UNCLASSIFIED';
  } else if (providerKind === 'technical-transversal') {
    family = 'TECHNICAL_PRIMITIVE';
  } else if (providerKind === 'business-transversal') {
    family = 'BUSINESS_TRANSVERSAL_SERVICE';
  } else if (providerKind === 'piloting-capability') {
    family = 'PILOTING_CAPABILITY';
  } else if (providerKind === 'business-feature') {
    family = (a.couplingObserved === 'business-file-import' || a.couplingObserved === 'import-mixed')
      ? 'CROSS_FEATURE_DIRECT_IMPORT'
      : 'BUSINESS_FEATURE_INTERFACE';
  } else {
    family = 'UNCLASSIFIED';
  }

  return {
    from: pair.from,
    to: pair.to,
    family,
    evidenceRole: a.evidenceRole,
    consumerKind,
    providerKind,
    channels: a.channels,
    couplingObserved: a.couplingObserved,
    policy: family === 'UNCLASSIFIED' ? null : POLICY[family],
    topEvidence: a.topEvidence,
  };
}

// ── Cycles runtime réels (après exclusion test-only + composition-root) ────
// Un cycle est retenu seulement si LES DEUX sens sont des paires runtime-backed
// qui ne sont ni NON_RUNTIME_TEST ni COMPOSITION_ROOT_WIRING.
function computeRuntimeCycles(classifications) {
  const EXCLUDE = new Set(['NON_RUNTIME_TEST', 'COMPOSITION_ROOT_WIRING', 'UNCLASSIFIED']);
  const byKey = new Map();
  for (const c of classifications) byKey.set(c.from + '->' + c.to, c);
  const cycles = [];
  const seen = new Set();
  for (const c of classifications) {
    if (EXCLUDE.has(c.family)) continue;
    const rev = byKey.get(c.to + '->' + c.from);
    if (!rev || EXCLUDE.has(rev.family)) continue;
    const key = [c.from, c.to].sort().join('<->');
    if (seen.has(key)) continue;
    seen.add(key);
    const [a, b] = [c.from, c.to].sort();
    cycles.push({
      nodes: [a, b],
      key,
      directions: [
        { from: a, to: b, family: byKey.get(a + '->' + b).family },
        { from: b, to: a, family: byKey.get(b + '->' + a).family },
      ],
    });
  }
  return cycles.sort((x, y) => x.key.localeCompare(y.key));
}

// ── Ownership suspects (dérivé preuve : transversal technique important
//    directement un fichier de business-feature) ────────────────────────────
function isOwnershipSuspect(c) {
  return c.family === 'CROSS_FEATURE_DIRECT_IMPORT' && c.consumerKind === 'technical-transversal';
}

// ── Construction des dispositions + set exceptionRequired ─────────────────
function buildDispositions(pairs, ctx) {
  const observed = pairs.filter(p => p.conformanceStatus === 'OBSERVED_UNDECLARED');
  const classifications = observed.map(p => classifyPair(p, ctx))
    .sort((a, b) => (a.from + '->' + a.to).localeCompare(b.from + '->' + b.to));

  const cycles = computeRuntimeCycles(classifications);
  const cycleDirs = new Set();
  for (const cy of cycles) for (const d of cy.directions) cycleDirs.add(d.from + '->' + d.to);

  // exceptionRequired : F (boundary) ∪ directions de cycle ∪ ownership suspects
  for (const c of classifications) {
    const key = c.from + '->' + c.to;
    const reasons = [];
    if (EXCEPTION_FAMILIES.has(c.family)) reasons.push('direct-import');
    if (cycleDirs.has(key)) reasons.push('runtime-cycle');
    if (isOwnershipSuspect(c)) reasons.push('ownership-suspect');
    c.exceptionRequired = reasons.length > 0;
    c.exceptionReasons = reasons;
  }

  // Matrice empirique observée : signatures (famille|evidenceRole|consumerKind|providerKind|coupling)
  const matrix = {};
  for (const c of classifications) {
    const sig = [c.family, c.evidenceRole, c.consumerKind, c.providerKind, c.couplingObserved].join('|');
    matrix[sig] = (matrix[sig] || 0) + 1;
  }

  const familySummary = {};
  for (const f of FAMILIES) familySummary[f] = 0;
  familySummary.UNCLASSIFIED = 0;
  for (const c of classifications) familySummary[c.family] = (familySummary[c.family] || 0) + 1;

  const unclassified = classifications.filter(c => c.family === 'UNCLASSIFIED')
    .map(c => ({ from: c.from, to: c.to, evidenceRole: c.evidenceRole, couplingObserved: c.couplingObserved }));

  return { classifications, cycles, familySummary, unclassified, matrix };
}

// ── Réconciliation du ledger d'exceptions ─────────────────────────────────
// ledger : { version, exceptions:[{from,to,decision,rationale}] }
function reconcileExceptions(dispositions, ledger) {
  const byKey = new Map();
  for (const c of dispositions.classifications) byKey.set(c.from + '->' + c.to, c);

  const entries = (ledger && ledger.exceptions) || [];
  const seenKeys = new Set();
  const duplicateKeys = [];
  const staleExceptions = [];
  const illegitimateExceptions = []; // entrée pour une paire mécaniquement fermée (exceptionRequired=false)
  const emptyRationale = [];

  for (const e of entries) {
    const key = e.from + '->' + e.to;
    if (seenKeys.has(key)) duplicateKeys.push(key);
    seenKeys.add(key);
    const c = byKey.get(key);
    if (!c) { staleExceptions.push(key); continue; }
    if (!c.exceptionRequired) illegitimateExceptions.push(key);
    if (!e.rationale || !String(e.rationale).trim()) emptyRationale.push(key);
  }

  const requiredKeys = dispositions.classifications.filter(c => c.exceptionRequired).map(c => c.from + '->' + c.to);
  const missingExceptions = requiredKeys.filter(k => !seenKeys.has(k)).sort();

  // Cycles sans décision explicite : un cycle est "expliqué" si CHACUNE de ses
  // directions a une entrée de ledger (donc une décision humaine enregistrée).
  const unexplainedRuntimeCycles = [];
  for (const cy of dispositions.cycles) {
    const undecided = cy.directions.filter(d => !seenKeys.has(d.from + '->' + d.to));
    if (undecided.length) unexplainedRuntimeCycles.push({ key: cy.key, undecided: undecided.map(d => d.from + '->' + d.to) });
  }

  return {
    exceptions: entries.map(e => ({ from: e.from, to: e.to, decision: e.decision, rationale: e.rationale })),
    duplicateKeys: [...new Set(duplicateKeys)].sort(),
    staleExceptions: staleExceptions.sort(),
    illegitimateExceptions: illegitimateExceptions.sort(),
    emptyRationale: emptyRationale.sort(),
    missingExceptions,
    unexplainedRuntimeCycles: unexplainedRuntimeCycles.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

// ── Couverture des ontology gaps (flux séparé, hors paires) ───────────────
// localManifestGaps : model.o5.localManifestDependenciesWithoutCanonicalConsumer
// registry : governance/business-graph-ontology-gaps.json (autorité existante)
function reconcileOntologyGaps(localManifestGaps, registry) {
  const gapConsumers = [...new Set((localManifestGaps || []).map(r => r.consumerManifest))].sort();
  const governed = new Set();
  if (registry) {
    // le registre existant peut lister les gaps sous plusieurs formes ; on tolère
    // un tableau `gaps[]` d'objets {manifest|consumerManifest|id} ou un objet clé->…
    const list = Array.isArray(registry.gaps) ? registry.gaps
      : Array.isArray(registry) ? registry
      : Object.keys(registry.gaps || registry || {}).map(k => ({ manifest: k }));
    for (const g of list) {
      const id = g.boutiqueManifest || g.manifest || g.consumerManifest || g.name || g.id;
      if (id) governed.add(id);
    }
  }
  const covered = gapConsumers.filter(c => governed.has(c));
  const uncovered = gapConsumers.filter(c => !governed.has(c));
  return {
    consumers: gapConsumers,
    covered: covered.sort(),
    uncovered: uncovered.sort(),
    providersByConsumer: Object.fromEntries(gapConsumers.map(c => [
      c, [...new Set((localManifestGaps || []).filter(r => r.consumerManifest === c).map(r => r.providerFeature))].sort(),
    ])),
  };
}

module.exports = {
  FAMILIES,
  POLICY,
  fileEvidenceRole,
  isTechnicalPrimitiveTarget,
  analyzePair,
  classifyPair,
  computeRuntimeCycles,
  buildDispositions,
  reconcileExceptions,
  reconcileOntologyGaps,
};
