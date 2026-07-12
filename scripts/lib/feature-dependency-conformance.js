'use strict';

/**
 * scripts/lib/feature-dependency-conformance.js
 *
 * Lot O5 — orchestration. Ce module NE réextrait rien qui existe déjà dans le
 * Business Feature Graph (O4) ni dans le Meta Graph (gen-meta-graph.js) : il
 * consomme leurs edges déjà vérifiées sur disque et construit par-dessus :
 *
 *   1. un index d'identité technique multi-scope (fileId -> owner discriminé),
 *      construit UNIQUEMENT à partir des bridges O4 existants (implementedBy,
 *      boutiqueManifestImplementedBy, implementedIn) — jamais par nom de fichier ;
 *   2. le scan des imports/require locaux (Canal A — délégué à
 *      feature-dependency-observer.js, qui ne fait QUE l'extraction regex et
 *      la résolution disque, jamais la résolution métier) ;
 *   3. la jointure du canal interface (Canal D) à partir de docs/META_GRAPH.json,
 *      déjà généré par gen-meta-graph.js — aucune ré-extraction d'endpoint ;
 *   4. l'agrégation en paires (from, to) canoniques avec canaux[] + evidence[],
 *      et la classification de conformance (DECLARED_AND_OBSERVED /
 *      OBSERVED_UNDECLARED / TRANSVERSAL_TOPOLOGY / UNRESOLVED).
 *
 * Représentation du consumer (mission §5) : jamais réduite à `featureName|null`.
 *   { kind: 'canonical-feature', id }
 *   { kind: 'local-manifest', scope, id, canonicalFeature: null, ontologyGap: bool }
 *   { kind: 'ambiguous-owner', id, candidates: [...] }
 */

const fs = require('fs');
const path = require('path');
const observer = require('./feature-dependency-observer.js');

const JS_SOURCE_EXT = new Set(['.js', '.mjs', '.cjs']);

function isJsSource(p) {
  const ext = p.slice(p.lastIndexOf('.'));
  return JS_SOURCE_EXT.has(ext);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. INDEX D'IDENTITÉ TECHNIQUE MULTI-SCOPE
// ─────────────────────────────────────────────────────────────────────────
/**
 * Construit :
 *  - fileOwners: Map(fileId -> [{kind:'canonical-feature', id:featureName} ...])
 *      (backend + dash — un fileId peut porter PLUSIEURS entrées si plusieurs
 *      manifests le revendiquent -> AMBIGUOUS_OWNER, jamais un overwrite silencieux)
 *  - boutiqueFileManifests: Map(fileId -> Set(manifestName))
 *      (boutique — ownership au niveau manifest, résolu séparément vers
 *      canonicalFeature via manifestToCanonical, cf. resolveConsumer)
 *  - manifestToCanonical: Map(manifestName -> {canonicalFeature, sliceKind, governed})
 *  - fileAbsIndex: [{ fileId, absPath }] — liste des fichiers gouvernés, TOUS
 *      scopes, TOUTES extensions (nécessaire pour la résolution de cible, pas
 *      seulement pour la liste à scanner)
 */
function buildIdentityIndex({ implementedByEdges, boutiqueManifestImplementedBy, boutiqueManifestNodes, ROOT, DASH_ROOT, BOUTIQUE_ROOT }) {
  const fileOwners = new Map(); // fileId -> [{kind:'canonical-feature', id}]
  const fileAbsIndex = [];

  const RESOLVED_STATUSES = new Set([
    'resolved-in-technical-graph', 'resolved-on-disk-out-of-arch-scan-scope',
    'resolved-on-disk-no-header', 'resolved-in-dash-repo',
  ]);

  for (const e of implementedByEdges) {
    if (!RESOLVED_STATUSES.has(e.status)) continue;
    const fileId = e.resolvedPath;
    const abs = fileId.startsWith('dash:')
      ? path.join(DASH_ROOT, fileId.slice('dash:'.length))
      : path.join(ROOT, fileId);
    const list = fileOwners.get(fileId) || [];
    if (!list.some(o => o.id === e.feature)) list.push({ kind: 'canonical-feature', id: e.feature });
    fileOwners.set(fileId, list);
    fileAbsIndex.push({ fileId, absPath: abs });
  }

  const boutiqueFileManifests = new Map(); // fileId -> Set(manifestName)
  for (const e of boutiqueManifestImplementedBy) {
    if (!e.exists) continue;
    const fileId = e.resolvedPath; // 'public/boutique/...'
    const set = boutiqueFileManifests.get(fileId) || new Set();
    set.add(e.boutiqueManifest);
    boutiqueFileManifests.set(fileId, set);
    const sub = fileId.slice('public/boutique/'.length);
    fileAbsIndex.push({ fileId, absPath: path.join(BOUTIQUE_ROOT, sub) });
  }

  const manifestToCanonical = new Map();
  for (const n of boutiqueManifestNodes) {
    manifestToCanonical.set(n.name, { canonicalFeature: n.canonicalFeature, sliceKind: n.sliceKind, governed: n.governed });
  }

  // Dédoublonnage de fileAbsIndex (un même fileId ne doit apparaître qu'une
  // fois dans la liste à résoudre, même s'il est référencé par plusieurs
  // edges — l'ambiguïté d'OWNERSHIP est déjà portée par fileOwners/boutiqueFileManifests).
  const seen = new Set();
  const dedupedFileAbsIndex = [];
  for (const f of fileAbsIndex) {
    if (seen.has(f.fileId)) continue;
    seen.add(f.fileId);
    dedupedFileAbsIndex.push(f);
  }

  return { fileOwners, boutiqueFileManifests, manifestToCanonical, fileAbsIndex: dedupedFileAbsIndex };
}

/**
 * Résout un chemin absolu réel vers un fileId de la convention O4/O5.
 * Ordre de test : boutique (le plus imbriqué) -> dash -> backend -> null.
 * Ne devine jamais : un chemin qui existe sur disque mais tombe hors de
 * toutes les racines de scope connues retourne null (mission §1 "resolveAbsToFileId
 * ... retourne null si aucune racine de scope connue").
 */
function makeResolveAbsToFileId({ ROOT, DASH_ROOT, BOUTIQUE_ROOT }) {
  return function resolveAbsToFileId(absPath) {
    const normAbs = path.normalize(absPath);
    if (BOUTIQUE_ROOT && !path.relative(BOUTIQUE_ROOT, normAbs).startsWith('..') && path.relative(BOUTIQUE_ROOT, normAbs) !== '') {
      const rel = path.relative(BOUTIQUE_ROOT, normAbs).split(path.sep).join('/');
      if (!rel.startsWith('..')) return `public/boutique/${rel}`;
    }
    if (DASH_ROOT && !path.relative(DASH_ROOT, normAbs).startsWith('..')) {
      const rel = path.relative(DASH_ROOT, normAbs).split(path.sep).join('/');
      if (!rel.startsWith('..')) return `dash:${rel}`;
    }
    if (ROOT && !path.relative(ROOT, normAbs).startsWith('..')) {
      const rel = path.relative(ROOT, normAbs).split(path.sep).join('/');
      if (!rel.startsWith('..')) return rel;
    }
    return null;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. RÉSOLUTION DE CONSUMER/PROVIDER DISCRIMINÉE (mission §5)
// ─────────────────────────────────────────────────────────────────────────
/**
 * Résout un fileId vers une identité discriminée. `ontologyGapManifests` est
 * l'ensemble des noms de manifest boutique déjà documentés comme ontology gap
 * par O4 (governance/business-graph-ontology-gaps.json, bigMap.canonical.ontologyGaps)
 * — jamais déduit par nom, uniquement par cette liste déjà arrêtée par O4.
 */
function resolveIdentity(fileId, index, ontologyGapManifests) {
  if (fileId.startsWith('public/boutique/')) {
    const manifests = [...(index.boutiqueFileManifests.get(fileId) || [])];
    if (manifests.length === 0) return null; // fichier boutique non gouverné (hors périmètre O4)
    if (manifests.length > 1) {
      return { kind: 'ambiguous-local-manifest', scope: 'boutique', id: fileId, candidates: manifests };
    }
    const manifestName = manifests[0];
    const meta = index.manifestToCanonical.get(manifestName) || {};
    if (meta.canonicalFeature) {
      return { kind: 'canonical-feature', id: meta.canonicalFeature, viaManifest: manifestName, scope: 'boutique' };
    }
    return {
      kind: 'local-manifest', scope: 'boutique', id: manifestName, canonicalFeature: null,
      sliceKind: meta.sliceKind || null,
      ontologyGap: ontologyGapManifests.has(manifestName),
    };
  }
  // backend ou dash
  const owners = index.fileOwners.get(fileId) || [];
  if (owners.length === 0) return null; // hors périmètre gouverné (orphelin technique, etc.)
  if (owners.length > 1) {
    return { kind: 'ambiguous-owner', scope: fileId.startsWith('dash:') ? 'dash' : 'backend', id: fileId, candidates: owners.map(o => o.id) };
  }
  return { kind: 'canonical-feature', id: owners[0].id, scope: fileId.startsWith('dash:') ? 'dash' : 'backend' };
}

function identityKey(idn) {
  if (!idn) return 'null';
  if (idn.kind === 'canonical-feature') return `feature:${idn.id}`;
  if (idn.kind === 'local-manifest') return `boutique-manifest:${idn.id}`;
  if (idn.kind === 'ambiguous-owner') return `ambiguous-owner:${idn.id}`;
  if (idn.kind === 'ambiguous-local-manifest') return `ambiguous-local-manifest:${idn.id}`;
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────
// 3. SCAN CANAL A (static local import/require) — backend + boutique + dash
// ─────────────────────────────────────────────────────────────────────────
function scanCodeChannel(index, resolveAbsToFileId) {
  const scanFiles = index.fileAbsIndex.filter(f => isJsSource(f.fileId));
  const { byFile } = observer.scanLocalDependencies(scanFiles, resolveAbsToFileId);
  return byFile; // Map(fileId -> {resolved:[{targetFile}], dynamic:[{kind,raw}]})
}

// ─────────────────────────────────────────────────────────────────────────
// 4. CANAL D (interface) — jointure sur docs/META_GRAPH.json (déjà généré)
// ─────────────────────────────────────────────────────────────────────────
/**
 * META_GRAPH.endpoints[route] = { boutique:[moduleName,...], dashboards:[...],
 *   inContract, status, routeFile, services, tables }.
 * `moduleName` (ex. "b-cart") n'est PAS un fileId — mission §9 interdit de le
 * reconstruire par supposition de basename ("b-cart -> b-cart.js"). On résout
 * le module UNIQUEMENT via la relation déjà connue boutiqueManifestImplementedBy
 * (déclared: le chemin déclaré par le manifest se termine par
 * "<moduleName>.js" — c'est la même convention que celle déjà utilisée par
 * gen-meta-graph.js pour PRODUIRE moduleName à partir du fichier, donc pas une
 * nouvelle supposition, juste l'inverse de la même fonction connue). Si aucun
 * fichier boutique gouverné ne correspond exactement -> INTERFACE-CONSUMER-FILE-UNRESOLVED,
 * jamais une invention de fileId.
 */
function buildBoutiqueModuleToFileId(boutiqueManifestImplementedBy) {
  const map = new Map(); // moduleName -> [fileId,...]
  for (const e of boutiqueManifestImplementedBy) {
    if (!e.exists || !e.resolvedPath.endsWith('.js')) continue;
    const base = path.basename(e.resolvedPath, '.js');
    const list = map.get(base) || [];
    if (!list.includes(e.resolvedPath)) list.push(e.resolvedPath);
    map.set(base, list);
  }
  return map;
}

/**
 * Bridge dash "vue" (META_GRAPH.endpoints[*].dashboards[], ex. "AccountingView")
 * -> fileId gouverné (ex. "dash:dashboards/admin/js/views/AccountingView.js").
 *
 * Même principe que buildBoutiqueModuleToFileId : PAS de reconstruction de
 * chemin par supposition (on ne concatène jamais "public/dashboards/admin/js/"
 * en dur ici) — on inverse la même convention basename déjà utilisée par
 * gen-meta-graph.js pour PRODUIRE le nom de vue à partir du fichier
 * (docs/DASHBOARDS_360.json : callEdges[].view = basename sans extension d'un
 * module sous un dossier "views/", cf. gen-dashboards-360.js qui ne construit
 * de callEdges QUE pour les modules dont `file` commence par "views/"). Le
 * fileId lui-même vient exclusivement d'implementedByEdges (déjà vérifié sur
 * disque par O4, jamais deviné) — on ne fait qu'y chercher, parmi les entrées
 * dash déjà gouvernées, celles dont le segment de chemin contient "views/" et
 * dont le basename correspond au nom de vue recherché.
 */
function buildDashViewToFileId(implementedByEdges) {
  const map = new Map(); // viewName -> [fileId,...]
  for (const e of implementedByEdges) {
    if (!e.resolvedPath || !e.resolvedPath.startsWith('dash:')) continue;
    if (!e.status || !e.status.startsWith('resolved')) continue;
    if (!e.resolvedPath.endsWith('.js')) continue;
    const relSegs = e.resolvedPath.slice('dash:'.length).split('/');
    if (!relSegs.includes('views')) continue; // même filtre que gen-dashboards-360.js (mod.file.startsWith('views/'))
    const base = path.basename(e.resolvedPath, '.js');
    const list = map.get(base) || [];
    if (!list.includes(e.resolvedPath)) list.push(e.resolvedPath);
    map.set(base, list);
  }
  return map;
}

function scanInterfaceChannel({ metaGraph, boutiqueManifestImplementedBy, implementedByEdges }) {
  const moduleToFileId = buildBoutiqueModuleToFileId(boutiqueManifestImplementedBy);
  const dashViewToFileId = buildDashViewToFileId(implementedByEdges);
  // routeFile -> [feature,...] via implementedByEdges (backend uniquement —
  // les routes exposées sont toujours backend dans ce repo, cf. contract.exposes).
  const routeFileToFeatures = new Map();
  for (const e of implementedByEdges) {
    if (e.category !== 'routes') continue;
    if (!e.status.startsWith('resolved')) continue;
    const list = routeFileToFeatures.get(e.resolvedPath) || [];
    if (!list.includes(e.feature)) list.push(e.feature);
    routeFileToFeatures.set(e.resolvedPath, list);
  }

  const records = []; // { consumerFileId|null, consumerModule, endpoint, routeFile, providerFeatures, scope }
  if (!metaGraph || !metaGraph.endpoints) return { records, moduleToFileId, dashViewToFileId };

  for (const [endpoint, info] of Object.entries(metaGraph.endpoints)) {
    const consumerModules = [
      ...((info.boutique || []).map(m => ({ scope: 'boutique', module: m }))),
      ...((info.dashboards || []).map(m => ({ scope: 'dash', module: m }))),
    ];
    if (!consumerModules.length) continue;
    const providerFeatures = info.routeFile ? (routeFileToFeatures.get(info.routeFile) || []) : [];
    for (const cm of consumerModules) {
      let consumerFileId = null;
      let consumerStatus = 'resolved';
      if (cm.scope === 'boutique') {
        const candidates = moduleToFileId.get(cm.module) || [];
        if (candidates.length === 1) consumerFileId = candidates[0];
        else if (candidates.length === 0) consumerStatus = 'INTERFACE-CONSUMER-FILE-UNRESOLVED';
        else consumerStatus = 'INTERFACE-CONSUMER-FILE-AMBIGUOUS';
      } else {
        const candidates = dashViewToFileId.get(cm.module) || [];
        if (candidates.length === 1) consumerFileId = candidates[0];
        else if (candidates.length === 0) consumerStatus = 'INTERFACE-CONSUMER-FILE-UNRESOLVED';
        else consumerStatus = 'INTERFACE-CONSUMER-FILE-AMBIGUOUS';
      }
      records.push({
        endpoint, scope: cm.scope, module: cm.module, consumerFileId, consumerStatus,
        routeFile: info.routeFile || null, providerFeatures,
      });
    }
  }
  return { records, moduleToFileId, dashViewToFileId };
}

// ─────────────────────────────────────────────────────────────────────────
// 5. AGRÉGATION EN PAIRES + CLASSIFICATION DE CONFORMANCE
// ─────────────────────────────────────────────────────────────────────────
function pairKey(fromKey, toFeature) { return `${fromKey}\u0000${toFeature}`; }

/**
 * @returns {{
 *   pairs: [{ from, fromKind, to, channels:[{channel,evidence}], conformanceStatus }],
 *   localManifestGapRecords: [...],
 *   ambiguousOwnerRecords: [...],
 *   ambiguousInterfaceProviderRecords: [...],
 *   dynamicUnresolvedByScope: Map,
 *   interfaceConsumerUnresolved: [...],
 * }}
 */
function aggregate({ codeByFile, interfaceRecords, index, ontologyGapManifests, declaredPairs, resolveAbsToFileId }) {
  const pairs = new Map(); // key -> record
  const ambiguousOwnerRecords = [];
  const localManifestGapRecords = []; // consumer=local-manifest(canonicalFeature null), provider resolved
  const transversalRecords = []; // consumer=local-manifest transversal non-gap, provider resolved
  const dynamicUnresolvedByScope = new Map(); // scope -> [{sourceFileId, kind, raw}]
  const interfaceConsumerUnresolved = [];
  const ambiguousInterfaceProviderRecords = [];

  function noteDynamic(fileId, dynamic) {
    if (!dynamic.length) return;
    const scope = fileId.startsWith('public/boutique/') ? 'boutique' : fileId.startsWith('dash:') ? 'dash' : 'backend';
    const list = dynamicUnresolvedByScope.get(scope) || [];
    for (const d of dynamic) list.push({ sourceFileId: fileId, kind: d.kind, raw: d.raw });
    dynamicUnresolvedByScope.set(scope, list);
  }

  function recordEvidence(consumerIdn, providerFeature, channel, evidence) {
    const fromKey = identityKey(consumerIdn);
    const key = pairKey(fromKey, providerFeature);
    let rec = pairs.get(key);
    if (!rec) {
      rec = { from: consumerIdn, to: providerFeature, channels: new Map() };
      pairs.set(key, rec);
    }
    const chList = rec.channels.get(channel) || [];
    chList.push(evidence);
    rec.channels.set(channel, chList);
  }

  // ── Canal A : code (backend + boutique + dash) ──────────────────────────
  for (const [sourceFileId, { resolved, dynamic }] of codeByFile.entries()) {
    noteDynamic(sourceFileId, dynamic);
    const consumerIdn = resolveIdentity(sourceFileId, index, ontologyGapManifests);
    if (!consumerIdn) continue; // fichier scanné mais non gouverné (ne devrait pas arriver, filtré en amont)

    if (consumerIdn.kind === 'ambiguous-owner') {
      ambiguousOwnerRecords.push({ fileId: sourceFileId, candidates: consumerIdn.candidates, role: 'consumer' });
    }

    for (const { targetFile } of resolved) {
      const providerIdn = resolveIdentity(targetFile, index, ontologyGapManifests);
      if (!providerIdn) continue; // cible hors périmètre gouverné (ex. lib externe déjà filtrée par l'observer, ou fichier non revendiqué)

      if (providerIdn.kind === 'ambiguous-owner') {
        ambiguousOwnerRecords.push({ fileId: targetFile, candidates: providerIdn.candidates, role: 'provider' });
        continue; // mission §3 : ne choisis jamais un owner arbitraire
      }
      if (providerIdn.kind === 'ambiguous-local-manifest') {
        continue; // mission §4 : idem côté boutique, pas de collapse arbitraire
      }
      if (consumerIdn.kind === 'ambiguous-owner' || consumerIdn.kind === 'ambiguous-local-manifest') {
        continue;
      }

      // Provider doit être une feature canonique pour produire une paire —
      // un provider local-manifest (transversal/gap) n'est jamais un provider
      // valide (mission : canonicalFeature=null ne devient jamais un nœud feature).
      if (providerIdn.kind !== 'canonical-feature') continue;
      const toFeature = providerIdn.id;

      if (consumerIdn.kind === 'canonical-feature') {
        if (consumerIdn.id === toFeature) continue; // relation interne, pas cross-feature
        recordEvidence(consumerIdn, toFeature, 'static-code', { sourceFileId, targetFile });
      } else if (consumerIdn.kind === 'local-manifest') {
        if (consumerIdn.ontologyGap) {
          localManifestGapRecords.push({ consumerManifest: consumerIdn.id, sourceFileId, targetFile, providerFeature: toFeature, channel: 'static-code' });
        } else {
          transversalRecords.push({ consumerManifest: consumerIdn.id, sourceFileId, targetFile, providerFeature: toFeature, channel: 'static-code' });
        }
      }
    }
  }

  // ── Canal D : interface (jointure META_GRAPH) ───────────────────────────
  for (const rec of interfaceRecords) {
    if (rec.consumerStatus === 'INTERFACE-CONSUMER-FILE-UNRESOLVED' || rec.consumerStatus === 'INTERFACE-CONSUMER-FILE-AMBIGUOUS') {
      interfaceConsumerUnresolved.push(rec);
      continue;
    }
    if (!rec.providerFeatures || rec.providerFeatures.length === 0) continue; // pas de provider résolu — rien à affirmer
    if (rec.providerFeatures.length > 1) {
      ambiguousInterfaceProviderRecords.push(rec);
      continue; // mission §9 : AMBIGUOUS_PROVIDER, ne choisis aucun owner arbitraire
    }
    const toFeature = rec.providerFeatures[0];
    const consumerIdn = resolveIdentity(rec.consumerFileId, index, ontologyGapManifests);
    if (!consumerIdn || consumerIdn.kind === 'ambiguous-owner' || consumerIdn.kind === 'ambiguous-local-manifest') continue;

    if (consumerIdn.kind === 'canonical-feature') {
      if (consumerIdn.id === toFeature) continue;
      recordEvidence(consumerIdn, toFeature, 'interface', { endpoint: rec.endpoint, routeFile: rec.routeFile, consumerFileId: rec.consumerFileId });
    } else if (consumerIdn.kind === 'local-manifest') {
      if (consumerIdn.ontologyGap) {
        localManifestGapRecords.push({ consumerManifest: consumerIdn.id, sourceFileId: rec.consumerFileId, endpoint: rec.endpoint, providerFeature: toFeature, channel: 'interface' });
      } else {
        transversalRecords.push({ consumerManifest: consumerIdn.id, sourceFileId: rec.consumerFileId, endpoint: rec.endpoint, providerFeature: toFeature, channel: 'interface' });
      }
    }
  }

  // ── Classification de conformance par paire canonique ───────────────────
  const declaredSet = new Set(declaredPairs.map(p => `${p.from}\u0000${p.to}`));
  const finalPairs = [];
  for (const rec of pairs.values()) {
    const fromFeature = rec.from.id; // toujours canonical-feature ici (local-manifest traité à part)
    const declared = declaredSet.has(`${fromFeature}\u0000${rec.to}`);
    const channels = [...rec.channels.entries()].map(([channel, evidence]) => ({ channel, evidence }));
    finalPairs.push({
      from: fromFeature, to: rec.to,
      channels,
      conformanceStatus: declared ? 'DECLARED_AND_OBSERVED' : 'OBSERVED_UNDECLARED',
    });
  }
  finalPairs.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return {
    pairs: finalPairs,
    localManifestGapRecords,
    transversalRecords,
    ambiguousOwnerRecords,
    ambiguousInterfaceProviderRecords,
    dynamicUnresolvedByScope,
    interfaceConsumerUnresolved,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ENTRÉE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────
/**
 * @param {object} ctx
 *   implementedByEdges, boutiqueManifestImplementedBy, boutiqueManifestNodes,
 *   consumesEdges (déclaré O4 — source de vérité "declared"), ontologyGaps
 *   (bigMap.canonical.ontologyGaps), ROOT, DASH_ROOT, BOUTIQUE_ROOT, metaGraph
 */
function computeDependencyConformance(ctx) {
  const index = buildIdentityIndex(ctx);
  const resolveAbsToFileId = makeResolveAbsToFileId(ctx);
  const ontologyGapManifests = new Set((ctx.ontologyGaps || []).map(g => g.boutiqueManifest));

  const codeByFile = scanCodeChannel(index, resolveAbsToFileId);
  const { records: interfaceRecords } = scanInterfaceChannel({
    metaGraph: ctx.metaGraph,
    boutiqueManifestImplementedBy: ctx.boutiqueManifestImplementedBy,
    implementedByEdges: ctx.implementedByEdges,
  });

  const declaredPairs = (ctx.consumesEdges || []).filter(e => e.resolved).map(e => ({ from: e.from, to: e.to }));

  const result = aggregate({
    codeByFile, interfaceRecords, index, ontologyGapManifests, declaredPairs, resolveAbsToFileId,
  });

  // Coverage par scope (mission §14 point 2)
  const coverage = {
    backend: {
      filesObserved: index.fileAbsIndex.filter(f => !f.fileId.startsWith('public/boutique/') && !f.fileId.startsWith('dash:') && isJsSource(f.fileId)).length,
    },
    boutique: {
      filesObserved: index.fileAbsIndex.filter(f => f.fileId.startsWith('public/boutique/') && isJsSource(f.fileId)).length,
      nonCanonicalManifestFiles: [...index.boutiqueFileManifests.entries()].filter(([fileId, manifests]) => {
        const m = [...manifests][0];
        const meta = manifests.size === 1 ? index.manifestToCanonical.get(m) : null;
        return manifests.size === 1 && meta && !meta.canonicalFeature;
      }).length,
    },
    dash: {
      filesObserved: index.fileAbsIndex.filter(f => f.fileId.startsWith('dash:') && isJsSource(f.fileId)).length,
      limitations: ['dash static-string local dependency file coverage: COMPLETE (fichiers .js déclarés, résolus)', 'dash interface channel: consumer file resolution câblée via docs/DASHBOARDS_360.json (bridge vue -> fileId basé sur les entrées "views/" déjà gouvernées par implementedByEdges) — les modules dashboards référencés par META_GRAPH mais absents des vues gouvernées (ou ambigus) restent INTERFACE-CONSUMER-FILE-UNRESOLVED, jamais devinés', 'dash total runtime dependency observability: LIMITED BY O5 STATIC MODEL (dynamic import, registry lookup, dependency injection, event-driven dependency hors périmètre statique)'],
    },
  };

  return { ...result, coverage, ontologyGapManifests };
}

module.exports = {
  buildIdentityIndex,
  makeResolveAbsToFileId,
  resolveIdentity,
  identityKey,
  scanCodeChannel,
  scanInterfaceChannel,
  buildBoutiqueModuleToFileId,
  buildDashViewToFileId,
  aggregate,
  computeDependencyConformance,
};
