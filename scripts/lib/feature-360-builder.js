'use strict';

/**
 * feature-360-builder.js — cœur de reconstruction de la Feature 360 (Lot O8).
 *
 *   Feature 360 ne possède aucune vérité : ce module PROJETTE exclusivement
 *   les autorités déjà gouvernées par la chaîne Feature First (O2-O7.3) :
 *
 *     - features/*.feature.js, capabilities/*.capability.js,
 *       public/features/*.feature.js, public/dashboards/features/*.feature.js
 *       (Feature Card = ce que la feature AFFIRME être)
 *     - docs/BUSINESS_FEATURE_GRAPH.json (nodes, edges, o5, o6, tableOwnership)
 *       (ce que la feature EST réellement, observé + qualifié)
 *
 *   Aucune nouvelle classification n'est recalculée ici. Toute correction
 *   métier ou architecturale se fait dans la source autoritaire existante,
 *   jamais dans ce module.
 *
 * Exporte build() -> modèle Feature 360 complet (JSON-serializable, déterministe).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BFG_PATH = path.join(ROOT, 'docs', 'BUSINESS_FEATURE_GRAPH.json');

const VERSION = 'F360-1.0';

// Familles O6 qui constituent une vraie dépendance métier (business coupling
// observé mais non déclaré dans contract.consumes — légitime, pas du bruit).
const BUSINESS_FAMILIES = new Set([
  'BUSINESS_FEATURE_INTERFACE',
  'BUSINESS_TRANSVERSAL_SERVICE',
  'PILOTING_CAPABILITY',
]);

// Familles O6 qui sont du bruit technique — jamais mélangées aux dépendances
// métier (O6 les a précisément qualifiées comme telles).
const TECHNICAL_FAMILIES = new Set([
  'TECHNICAL_PRIMITIVE',
  'NON_RUNTIME_TEST',
  'COMPOSITION_ROOT_WIRING',
]);

function loadBFG() {
  return JSON.parse(fs.readFileSync(BFG_PATH, 'utf8'));
}

// Résout "dash:X" -> "public/X" (scopeTopology : dash mounté sous public/),
// sinon chemin relatif direct depuis la racine backend.
function resolveManifestPath(file) {
  if (file.startsWith('dash:')) return path.join(ROOT, 'public', file.slice(5));
  return path.join(ROOT, file);
}

function requireManifest(node) {
  const abs = resolveManifestPath(node.file);
  if (!fs.existsSync(abs)) return { __missing: true, __path: abs };
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

function norm(p) { return String(p).replace(/\\/g, '/'); }

function sortBy(arr, keyFn) {
  return [...arr].sort((a, b) => {
    const ka = keyFn(a), kb = keyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

// ── Construction ─────────────────────────────────────────────────────────

function build() {
  const bfg = loadBFG();
  const featureNodes = sortBy(bfg.nodes.features, n => n.name);
  const names = new Set(featureNodes.map(n => n.name));

  // ── Index global des dépendances métier (toutes features, une passe) ────
  // union o5.DECLARED_AND_OBSERVED + o6.pairClassifications[family in BUSINESS_FAMILIES]
  const businessEdges = [];
  for (const p of bfg.o5.pairs) {
    if (p.conformanceStatus === 'DECLARED_AND_OBSERVED') {
      businessEdges.push({
        from: p.from, to: p.to,
        disposition: 'DECLARED_AND_OBSERVED',
        channels: [...new Set((p.channels || []).map(c => c.channel))],
      });
    }
  }
  for (const p of bfg.o6.pairClassifications) {
    if (BUSINESS_FAMILIES.has(p.family)) {
      businessEdges.push({
        from: p.from, to: p.to,
        disposition: p.family,
        channels: [...new Set(p.channels || [])],
      });
    }
  }

  // ── Index technicalContext (bruit qualifié, par consommateur) ───────────
  const technicalEdgesByFrom = new Map();
  for (const p of bfg.o6.pairClassifications) {
    if (!TECHNICAL_FAMILIES.has(p.family)) continue;
    if (!technicalEdgesByFrom.has(p.from)) technicalEdgesByFrom.set(p.from, []);
    technicalEdgesByFrom.get(p.from).push(p);
  }

  // ── Index projections (family PROJECTION, consumer -> provider) ─────────
  const projectionEdgesByTo = new Map(); // provider -> [consumer projections]
  for (const p of bfg.o6.pairClassifications) {
    if (p.family !== 'PROJECTION') continue;
    if (!projectionEdgesByTo.has(p.to)) projectionEdgesByTo.set(p.to, []);
    projectionEdgesByTo.get(p.to).push(p.from);
  }

  // ── Index implementedBy par feature ──────────────────────────────────────
  const implByFeature = new Map();
  for (const e of bfg.edges.implementedBy) {
    if (!implByFeature.has(e.feature)) implByFeature.set(e.feature, []);
    implByFeature.get(e.feature).push(e);
  }

  // ── Index implementedIn (canonicalFeature -> boutiqueManifest) ──────────
  const boutiqueManifestByFeature = new Map();
  for (const e of bfg.edges.implementedIn) {
    boutiqueManifestByFeature.set(e.canonicalFeature, e.boutiqueManifest);
  }
  const boutiqueFilesByManifest = new Map();
  for (const e of bfg.edges.boutiqueManifestImplementedBy) {
    if (!boutiqueFilesByManifest.has(e.boutiqueManifest)) boutiqueFilesByManifest.set(e.boutiqueManifest, []);
    boutiqueFilesByManifest.get(e.boutiqueManifest).push(e);
  }

  // ── Index exposesInterface / providesInternalApi par feature ────────────
  const exposesByFeature = new Map();
  for (const e of bfg.edges.exposesInterface) {
    if (!exposesByFeature.has(e.feature)) exposesByFeature.set(e.feature, []);
    exposesByFeature.get(e.feature).push(e);
  }
  const internalApiByFeature = new Map();
  for (const e of bfg.edges.providesInternalApi) {
    if (!internalApiByFeature.has(e.feature)) internalApiByFeature.set(e.feature, []);
    internalApiByFeature.get(e.feature).push(e);
  }

  // ── Index consumesFeature (déclaré, brut, feature card) par from ────────
  const consumesByFrom = new Map();
  for (const e of bfg.edges.consumesFeature) {
    if (!consumesByFrom.has(e.from)) consumesByFrom.set(e.from, []);
    consumesByFrom.get(e.from).push(e);
  }

  // Ensemble des paires (from,to) présentes dans o5.pairs, quel que soit le statut —
  // sert à détecter "déclaré (nom résolu) mais jamais observé, ni déclaré-observé ni
  // observé-non-déclaré" = trou complet de preuve.
  const o5PairSet = new Set(bfg.o5.pairs.map(p => `${p.from}=>${p.to}`));

  // ── Ownership / data par table ───────────────────────────────────────────
  const tableOwnership = bfg.tableOwnership;

  // ── runtimeCycles / unclassified (génériques — vides dans la baseline O6) ─
  const runtimeCycleMembers = (cycle) => Array.isArray(cycle) ? cycle : (cycle.cycle || cycle.path || []);
  const unclassifiedInvolves = (item, id) => (item && (item.from === id || item.to === id));

  const ontologyGapCoverage = bfg.o6.ontologyGapCoverage || { consumers: [], covered: [], uncovered: [], providersByConsumer: {} };

  // ── Construction par feature ──────────────────────────────────────────────
  const features = featureNodes.map(node => buildFeature(node));

  function buildFeature(node) {
    const id = node.name;
    const man = requireManifest(node);
    const manifestOk = !man.__missing;

    // ── Identity ────────────────────────────────────────────────────────
    const identity = { id, kind: node.businessKind, status: node.status };

    // ── Service / perimeter / authority / invariants (Feature Card) ──────
    const service = (manifestOk && (man.service || man.capability)) || node.service || null;
    const perimeter = (manifestOk && man.perimeter) || null;
    const authority = (manifestOk && man.authority) || null;
    const invariants = (manifestOk && man.invariants) || [];

    // ── Implementation (agrégée depuis implementedBy, groupée par catégorie) ─
    const implEntries = implByFeature.get(id) || [];
    const implByCategory = {};
    for (const e of implEntries) {
      if (!implByCategory[e.category]) implByCategory[e.category] = [];
      implByCategory[e.category].push({
        declared: norm(e.declared),
        resolvedPath: e.resolvedPath ? norm(e.resolvedPath) : null,
        status: e.status,
      });
    }
    for (const cat of Object.keys(implByCategory)) {
      implByCategory[cat] = sortBy(implByCategory[cat], f => f.declared);
    }

    // boutique projection (frontend-slice implémentant cette feature canonique)
    const boutiqueManifest = boutiqueManifestByFeature.get(id) || null;
    const boutiqueFiles = boutiqueManifest
      ? sortBy((boutiqueFilesByManifest.get(boutiqueManifest) || []).map(e => ({
          declared: norm(e.declared), resolvedPath: e.resolvedPath ? norm(e.resolvedPath) : null,
          category: e.category, exists: e.exists, status: e.status,
        })), f => f.declared)
      : [];

    const implementation = {
      byCategory: Object.fromEntries(
        Object.keys(implByCategory).sort().map(cat => [cat, {
          count: implByCategory[cat].length,
          files: implByCategory[cat],
        }])
      ),
      totalFiles: implEntries.length,
      boutiqueManifest,
      boutiqueFiles: { count: boutiqueFiles.length, files: boutiqueFiles },
    };

    // orphan implementation = déclaré mais absent du disque (status ne commence
    // pas par "resolved"). Aucune supposition : uniquement le signal machine.
    const orphanImplFiles = implEntries.filter(e => !String(e.status).startsWith('resolved'));

    // ── Ownership / Data ────────────────────────────────────────────────
    const ownsTables = [], writesTables = [], readsTables = [];
    for (const [table, info] of Object.entries(tableOwnership)) {
      const writer = (info.writers || []).find(w => w.feature === id);
      const isReader = (info.readers || []).includes(id);
      if (info.lifecycleOwner === id) {
        ownsTables.push({ table, resolution: info.resolution });
      }
      if (writer) {
        let ownershipStatus;
        if (info.lifecycleOwner === id) ownershipStatus = 'owner';
        else if (info.lifecycleOwner === null) ownershipStatus = 'ambiguous';
        else ownershipStatus = 'writer-not-owner';
        writesTables.push({ table, mode: writer.mode, lifecycleOwner: info.lifecycleOwner, ownershipStatus });
      }
      if (isReader) readsTables.push({ table, lifecycleOwner: info.lifecycleOwner });
    }

    const data = {
      ownsTables: sortBy(ownsTables, t => t.table),
      writesTables: sortBy(writesTables, t => t.table),
      readsTables: sortBy(readsTables, t => t.table),
    };

    // ── Interfaces exposées ────────────────────────────────────────────
    // Deux formes légitimes déclarées en Feature Card : { fn, file } (le plus
    // fréquent), ou une chaîne "signature(args)" nue — pattern assumé pour une
    // API polymorphe qui ne mappe pas à un fichier unique (ex. refunds).
    const declaredInternalApiRaw = (manifestOk && man.contract && man.contract.internalApi) || [];
    const declaredInternalApi = declaredInternalApiRaw.map(a =>
      typeof a === 'string' ? { fn: a, file: null } : { fn: a.fn, file: a.file || null }
    );
    const resolvedInternalApiByFn = new Map();
    for (const e of (internalApiByFeature.get(id) || [])) {
      resolvedInternalApiByFn.set(`${e.fn}::${e.file}`, e.status);
    }
    const internalApis = sortBy(declaredInternalApi.map(a => ({
      fn: a.fn, file: a.file ? norm(a.file) : null,
      status: resolvedInternalApiByFn.get(`${a.fn}::${a.file}`) || 'undeclared-in-graph',
    })), a => `${a.fn}::${a.file}`);

    const httpInterfaceEntries = exposesByFeature.get(id) || [];
    const interfaces = {
      internalApis,
      httpInterfaces: { count: httpInterfaceEntries.length },
    };

    // unresolved internal API = un statut qui n'est ni "resolved" ni le pattern
    // légitime "documented-signature-no-file" (signature polymorphe documentée,
    // ne mappe pas à un fichier unique — convention assumée, pas un défaut).
    const unresolvedInternalApiEntries = internalApis.filter(
      a => a.status !== 'resolved' && a.status !== 'documented-signature-no-file'
    );

    // ── Business dependencies (ce que CETTE feature consomme) ────────────
    const businessDependencies = sortBy(
      businessEdges.filter(e => e.from === id),
      e => e.to
    ).map(e => ({ provider: e.to, disposition: e.disposition, channels: e.channels }));

    // ── Consumed by (projection inverse, déterministe, business only) ────
    const consumedBy = sortBy(
      businessEdges.filter(e => e.to === id),
      e => e.from
    ).map(e => ({ consumer: e.from, disposition: e.disposition, channels: e.channels }));

    // ── Projections (jamais mélangées aux dépendances métier) ────────────
    const projectedBy = sortBy(projectionEdgesByTo.get(id) || [], x => x);

    // ── Technical context (bruit masqué mais traçable) ───────────────────
    const techEdges = technicalEdgesByFrom.get(id) || [];
    const techByFamily = {};
    for (const f of TECHNICAL_FAMILIES) techByFamily[f] = techEdges.filter(e => e.family === f).length;
    const technicalContext = {
      technicalPrimitiveDependencies: techByFamily.TECHNICAL_PRIMITIVE,
      testOnlyRelations: techByFamily.NON_RUNTIME_TEST,
      compositionRootRelations: techByFamily.COMPOSITION_ROOT_WIRING,
      details: sortBy(techEdges.map(e => ({ to: e.to, family: e.family })), e => e.to),
    };

    // ── declaredNotObserved : déclaré (nom résolu) mais AUCUNE preuve O5 ──
    // (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED) — trou complet.
    const declaredNotObservedEdges = (consumesByFrom.get(id) || [])
      .filter(e => e.resolved && !o5PairSet.has(`${e.from}=>${e.to}`));

    // ── declaredOnly (référence non résolue à un nom de feature connu) ────
    const declaredOnlyUnresolved = (consumesByFrom.get(id) || []).filter(e => !e.resolved);

    // ── Boundary health ───────────────────────────────────────────────────
    const directCrossFeatureImports = bfg.o6.pairClassifications.filter(
      p => p.from === id && p.family === 'CROSS_FEATURE_DIRECT_IMPORT'
    ).length;
    const runtimeCyclesCount = (bfg.o6.runtimeCycles || []).filter(c => runtimeCycleMembers(c).includes(id)).length;
    const unclassifiedCount = (bfg.o6.unclassified || []).filter(item => unclassifiedInvolves(item, id)).length;
    const missingExceptionsLinked = (bfg.o6.missingExceptions || []).filter(
      k => typeof k === 'string' && k.startsWith(`${id}->`)
    ).length;
    const uncoveredGapLinked = (ontologyGapCoverage.uncovered || []).includes(id);

    let boundaryStatus = 'HEALTHY';
    if (unclassifiedCount > 0 || runtimeCyclesCount > 0 || missingExceptionsLinked > 0 || uncoveredGapLinked) {
      boundaryStatus = 'BLOCKED';
    } else if (directCrossFeatureImports > 0 || declaredNotObservedEdges.length > 0) {
      boundaryStatus = 'ATTENTION';
    }

    const boundaryHealth = {
      status: boundaryStatus,
      directCrossFeatureImports,
      runtimeCycles: runtimeCyclesCount,
      unclassifiedDependencies: unclassifiedCount,
      declaredNotObserved: declaredNotObservedEdges.length,
      declaredNotObservedEvidence: sortBy(declaredNotObservedEdges.map(e => e.to), x => x),
    };

    // ── Governance health ──────────────────────────────────────────────
    const ambiguousTables = data.writesTables.filter(t => t.ownershipStatus === 'ambiguous');
    const ontologyGapsLinkedCount = uncoveredGapLinked ? 1 : 0;

    const governanceIssues = [
      orphanImplFiles.length,
      unresolvedInternalApiEntries.length,
      declaredOnlyUnresolved.length,
      ontologyGapsLinkedCount,
      ambiguousTables.length,
    ];
    const governanceHealth = {
      status: governanceIssues.some(n => n > 0) ? 'ATTENTION' : 'HEALTHY',
      manifestPresent: manifestOk,
      registryPresent: true,
      orphanFiles: orphanImplFiles.length,
      unresolvedInternalApis: unresolvedInternalApiEntries.length,
      declaredOnlyDependencyCount: declaredOnlyUnresolved.length,
      ontologyGapsLinked: ontologyGapsLinkedCount,
      ambiguousOwnershipCount: ambiguousTables.length,
    };

    // ── Architectural debt (dérivée exclusivement de signaux machine) ────
    const debtItems = [];
    for (const t of ambiguousTables) {
      debtItems.push({
        type: 'AMBIGUOUS_TABLE_OWNERSHIP', severity: 'medium',
        evidence: `table ${t.table} — écrite par ${id} (${t.mode}), aucun lifecycle owner résolu (multi-writer non classifié)`,
      });
    }
    for (const e of orphanImplFiles) {
      debtItems.push({
        type: 'ORPHAN_IMPLEMENTATION', severity: 'high',
        evidence: `${e.category}/${e.declared} déclaré, statut résolution: ${e.status}`,
      });
    }
    for (const e of unresolvedInternalApiEntries) {
      debtItems.push({
        type: 'UNRESOLVED_INTERNAL_API', severity: 'medium',
        evidence: `${e.fn} (${e.file}) — statut: ${e.status}`,
      });
    }
    for (const to of declaredNotObservedEdges.map(e => e.to)) {
      debtItems.push({
        type: 'DECLARED_NOT_OBSERVED', severity: 'low',
        evidence: `contract.consumes déclare "${to}" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)`,
      });
    }
    for (const e of declaredOnlyUnresolved) {
      debtItems.push({
        type: 'CONSUMES_REFERENCE_UNRESOLVED', severity: 'low',
        evidence: `contract.consumes référence "${e.raw}" — ne correspond à aucun nom de feature connu`,
      });
    }
    if (directCrossFeatureImports > 0) {
      debtItems.push({
        type: 'DIRECT_CROSS_FEATURE_IMPORT', severity: 'high',
        evidence: `${directCrossFeatureImports} paire(s) classées CROSS_FEATURE_DIRECT_IMPORT`,
      });
    }
    if (runtimeCyclesCount > 0) {
      debtItems.push({
        type: 'RUNTIME_CYCLE', severity: 'high',
        evidence: `${runtimeCyclesCount} cycle(s) runtime impliquant ${id}`,
      });
    }
    if (uncoveredGapLinked) {
      debtItems.push({
        type: 'ONTOLOGY_GAP', severity: 'medium',
        evidence: `${id} référencé dans ontologyGapCoverage.uncovered`,
      });
    }
    const sortedDebtItems = sortBy(debtItems, d => `${d.type}::${d.evidence}`);

    return {
      id, kind: identity.kind, status: identity.status,
      manifestFile: manifestOk ? norm(path.relative(ROOT, resolveManifestPath(node.file))) : null,
      repo: node.repo,
      identity,
      service, perimeter, authority, invariants,
      implementation,
      ownership: data,
      data,
      interfaces,
      businessDependencies,
      consumedBy,
      projections: { projectedBy },
      technicalContext,
      boundaryHealth,
      governanceHealth,
      architecturalDebt: { debtCount: sortedDebtItems.length, debtItems: sortedDebtItems },
      evidence: {
        source: 'docs/BUSINESS_FEATURE_GRAPH.json',
        businessFeatureGraphVersion: bfg.version,
      },
    };
  }

  // ── Sommaire global (scorecard) ────────────────────────────────────────
  const summary = {
    features: features.length,
    healthy: features.filter(f => f.boundaryHealth.status === 'HEALTHY' && f.governanceHealth.status === 'HEALTHY').length,
    attention: features.filter(f =>
      (f.boundaryHealth.status === 'ATTENTION' || f.governanceHealth.status === 'ATTENTION') &&
      f.boundaryHealth.status !== 'BLOCKED'
    ).length,
    blocked: features.filter(f => f.boundaryHealth.status === 'BLOCKED').length,
    businessDependencies: businessEdges.length,
    directCrossFeatureImports: features.reduce((s, f) => s + f.boundaryHealth.directCrossFeatureImports, 0),
    runtimeCycles: features.reduce((s, f) => s + f.boundaryHealth.runtimeCycles, 0),
    ambiguousOwnershipSignals: features.reduce((s, f) => s + f.governanceHealth.ambiguousOwnershipCount, 0),
    ontologyGaps: (ontologyGapCoverage.uncovered || []).length,
    debtItemsTotal: features.reduce((s, f) => s + f.architecturalDebt.debtCount, 0),
  };

  return {
    version: VERSION,
    sourceModel: {
      businessFeatureGraphVersion: bfg.version,
      generatedFrom: bfg.generatedFrom,
    },
    summary,
    features,
  };
}

// ── Fonctions pures exportées pour tests négatifs (fixtures synthétiques,
//    aucun accès disque) — même logique que celle utilisée par build() ──────

// Classe une liste de o5.pairs + o6.pairClassifications en dépendances métier
// (union DECLARED_AND_OBSERVED + familles business), en excluant explicitement
// le bruit technique et les projections. Retourne { businessEdges, noiseEdges }.
function classifyPairsToBusinessEdges(o5Pairs, o6PairClassifications) {
  const businessEdges = [];
  const noiseEdges = [];
  for (const p of o5Pairs) {
    if (p.conformanceStatus === 'DECLARED_AND_OBSERVED') {
      businessEdges.push({ from: p.from, to: p.to, disposition: 'DECLARED_AND_OBSERVED' });
    }
  }
  for (const p of o6PairClassifications) {
    if (BUSINESS_FAMILIES.has(p.family)) {
      businessEdges.push({ from: p.from, to: p.to, disposition: p.family });
    } else {
      noiseEdges.push({ from: p.from, to: p.to, disposition: p.family });
    }
  }
  return { businessEdges, noiseEdges };
}

// Calcule le statut boundaryHealth à partir des compteurs bruts (mission §16).
function computeBoundaryStatus(counts) {
  const { unclassifiedDependencies = 0, runtimeCycles = 0, missingExceptionsLinked = 0,
    uncoveredGapLinked = false, directCrossFeatureImports = 0, declaredNotObserved = 0 } = counts;
  if (unclassifiedDependencies > 0 || runtimeCycles > 0 || missingExceptionsLinked > 0 || uncoveredGapLinked) return 'BLOCKED';
  if (directCrossFeatureImports > 0 || declaredNotObserved > 0) return 'ATTENTION';
  return 'HEALTHY';
}

// Détermine ownershipStatus d'une table pour un writer donné (WRITER != OWNER).
function tableOwnershipStatus(featureId, tableInfo) {
  if (tableInfo.lifecycleOwner === featureId) return 'owner';
  if (tableInfo.lifecycleOwner === null) return 'ambiguous';
  return 'writer-not-owner';
}

// Vérifie la cohérence inverse consumes/consumedBy sur un tableau de features
// déjà construites (même forme que model.features). Retourne la liste des
// mismatches (vide si cohérent).
function checkInverseConsistency(features) {
  const byId = new Map(features.map(f => [f.id, f]));
  const mismatches = [];
  for (const f of features) {
    for (const d of f.businessDependencies) {
      const provider = byId.get(d.provider);
      if (!provider) { mismatches.push(`${f.id} -> ${d.provider} : provider inconnu`); continue; }
      const back = provider.consumedBy.find(c => c.consumer === f.id && c.disposition === d.disposition);
      if (!back) mismatches.push(`${f.id} consumes ${d.provider} (${d.disposition}) sans réciproque dans ${d.provider}.consumedBy`);
    }
  }
  return mismatches;
}

module.exports = {
  build, VERSION, BUSINESS_FAMILIES, TECHNICAL_FAMILIES,
  classifyPairsToBusinessEdges, computeBoundaryStatus, tableOwnershipStatus, checkInverseConsistency,
};
