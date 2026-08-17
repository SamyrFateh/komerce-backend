'use strict';

/**
 * business-graph-warning-semantics.js — Lot O4 Phase E.
 *
 *   Classe chaque warning du Business Feature Graph (docs/BUSINESS_FEATURE_GRAPH.json,
 *   drifts.warn) dans l'une des 5 catégories de la mission O4 §11 :
 *
 *     EXPECTED_TOPOLOGY     — relation légitime, déjà documentée par la doctrine
 *     KNOWN_DEBT            — dette réelle mais non urgente (déclaration manquante,
 *                             pas un défaut de comportement)
 *     ACTIONABLE_DRIFT      — écart probable, mérite une correction ciblée
 *     INVALID_DECLARATION   — la déclaration elle-même est fautive (typo, nom
 *                             de feature inexistant)
 *     GENERATOR_LIMITATION  — artefact d'extraction (agrégateur de routes,
 *                             format non supporté), pas une dette de gouvernance
 *
 *   Principe (mission O4 §9/§11) : classification par RÈGLE, pas par liste
 *   figée warning-par-warning — un nouveau warning de la même famille et du
 *   même pattern structurel doit se classer automatiquement, sans édition
 *   manuelle de ce fichier à chaque régénération.
 *
 *   Chaque règle documente sa preuve. Si aucune règle ne matche, la
 *   classification par défaut de la famille s'applique (voir DEFAULT_BY_TYPE) —
 *   jamais un classement silencieux en EXPECTED_TOPOLOGY par défaut (cf.
 *   mission O4 §11 : « ne reclassifie pas automatiquement tous les
 *   WRITER-NOT-OWNER en EXPECTED TOPOLOGY »).
 */

// ── Défaut par famille si aucune règle spécifique ne matche ────────────────
// Choisi pour être le classement le PLUS PRUDENT de la famille (jamais
// EXPECTED_TOPOLOGY par défaut), de sorte qu'un nouveau warning inconnu
// attire l'attention plutôt que d'être noyé.
const DEFAULT_BY_TYPE = {
  'WRITER-NOT-OWNER':               'KNOWN_DEBT',
  'CONSUMES-REFERENCE-UNRESOLVED':  'INVALID_DECLARATION',
  'EXPOSED-ROUTE-OWNER-MISMATCH':   'ACTIONABLE_DRIFT',
  'EXPOSED-ROUTE-UNRESOLVED':       'ACTIONABLE_DRIFT',
  'DASH-MANIFEST-DUPLICATE-COPY':   'KNOWN_DEBT',
  'EXPOSE-ENTRY-UNPARSED':          'GENERATOR_LIMITATION',
  'BOUTIQUE-MANIFEST-UNGOVERNED':   'ACTIONABLE_DRIFT',
  // Lot O4-2 (point 5) : deux manifests boutique revendiquant le même fichier
  // est une contradiction de gouvernance active, pas juste de la dette de
  // déclaration — classé ACTIONABLE_DRIFT par défaut (jamais EXPECTED_TOPOLOGY,
  // même principe que le reste de ce fichier : un nouveau cas doit attirer
  // l'attention, pas être noyé).
  'BOUTIQUE-FILE-MULTIPLE-OWNERS':  'ACTIONABLE_DRIFT',
  // Lot O5 — Feature Dependency Conformance & Hidden Coupling Gate.
  // Une couture cross-feature techniquement observée (code ou interface)
  // sans contract.consumes déclaré est un écart probable à corriger, jamais
  // un classement EXPECTED_TOPOLOGY par défaut (même principe que le reste
  // de ce fichier) : soit la déclaration manque, soit le couplage est réel
  // et non désiré.
  'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY': 'ACTIONABLE_DRIFT',
  // Ambiguïté d'ownership technique (fichier backend/dash revendiqué par
  // plusieurs features) — même sémantique que BOUTIQUE-FILE-MULTIPLE-OWNERS
  // côté boutique : contradiction de gouvernance active.
  'AMBIGUOUS-FILE-OWNER': 'ACTIONABLE_DRIFT',
  // Un routeFile qui résout vers plusieurs features canoniques est un défaut
  // d'attribution d'ownership de route, à trancher explicitement.
  'AMBIGUOUS-INTERFACE-PROVIDER': 'ACTIONABLE_DRIFT',
  // require()/import() dynamique non résolu statiquement : limitation
  // inhérente au modèle regex/disque d'O5 (mission §14), pas une dette de
  // gouvernance déclarative.
  'DYNAMIC-LOCAL-DEPENDENCY-UNRESOLVED': 'GENERATOR_LIMITATION',
  // Module consumer côté Meta Graph non résolu vers un fileId gouverné —
  // artefact d'extraction/convention de nommage, pas une déclaration fautive.
  'INTERFACE-CONSUMER-FILE-UNRESOLVED': 'GENERATOR_LIMITATION',
  // Dépendance technique réelle depuis un manifest boutique dont l'absence
  // de canonicalFeature est un ontology gap DÉJÀ documenté par O4
  // (governance/business-graph-ontology-gaps.json) — dette réelle mais déjà
  // connue et déjà assumée en amont, pas un nouvel écart de comportement.
  'LOCAL-MANIFEST-DEPENDENCY-WITHOUT-CANONICAL-CONSUMER': 'KNOWN_DEBT',
};

// ── Noms de features réellement connus (pour distinguer INVALID_DECLARATION
//    d'une simple divergence de nommage vs un vrai champ libre documentaire) ─
// Chargé paresseusement pour éviter une dépendance dure au générateur.
function loadKnownFeatureNames(ROOT) {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(ROOT, 'features');
  const names = new Set();
  if (!fs.existsSync(dir)) return names;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.feature.js')) names.add(f.replace(/\.feature\.js$/, ''));
  }
  return names;
}

// ── Règles par famille ───────────────────────────────────────────────────

function classifyWriterNotOwner(w) {
  // Ancien cas "users -> owner déclaré loyalty" (Phase E) : corrigé à la
  // racine (campagne WRITER-NOT-OWNER, 2026-08) via un marqueur de owner
  // explicite sur auth-identity.feature.js (db.tables "users: RW!"), plutôt
  // que toléré ici en aval — cf. governance/data-ownership.json (arbitrage
  // 2026-07-29). La règle spécifique n'est plus nécessaire : le générateur
  // résout désormais "users" vers auth-identity directement.
  // Forme A : "lifecycle owner = X ... mais aussi écrite par Y[, Z...]"
  const mOwner = w.msg.match(/lifecycle owner = ([a-z0-9-]+).*mais aussi écrite par (.+)$/);
  if (mOwner) {
    const extraWriters = mOwner[2].split(',').map(s => s.trim());
    // Doctrine déjà documentée (FEATURE_DOCTRINE.md) : dashboard écrit en
    // opérationnel (hub/relais) sans être strictement readonly. Si dashboard
    // est le SEUL écrivain additionnel, c'est une topologie attendue connue.
    if (extraWriters.length === 1 && extraWriters[0] === 'dashboard') {
      return { category: 'EXPECTED_TOPOLOGY', reason: 'seul écrivain additionnel = dashboard, exception opérationnelle déjà documentée (FEATURE_DOCTRINE.md, hub/relais)' };
    }
    return { category: 'KNOWN_DEBT', reason: `écrivain(s) additionnel(s) au-delà du owner déclaré (${extraWriters.join(', ')}) — cross-feature write réel, pas encore déclaré via contract.consumes` };
  }
  // Forme B : "N écrivain(s) déclaré(s) (...) sans owner de lifecycle univoque"
  const mNoOwner = w.msg.match(/déclaré\(s\) \(([^)]+)\) sans owner de lifecycle/);
  if (mNoOwner) {
    const writers = mNoOwner[1].split(',').map(s => s.trim());
    // Cas repéré en Phase A (users -> owner déclaré loyalty, incohérent avec
    // le service réel = auth-identity) : PAS ce pattern (ce pattern est pour
    // "sans owner"), donc rien à faire ici — géré par la règle users ci-dessous
    // si jamais un futur run le fait apparaître sous cette forme aussi.
    return { category: 'KNOWN_DEBT', reason: `${writers.length} écrivain(s) sans classification.signals.ownsTables déclaré — déclaration de gouvernance manquante, pas un défaut de comportement observé` };
  }
  return null;
}

function classifyConsumesUnresolved(w, knownFeatureNames) {
  // Texte libre descriptif (pas une simple référence de nom) : limitation du
  // générateur (le champ contract.consumes mélange noms courts et prose).
  const freeTextPatterns = [/^ops-api legacy$/i, /^toutes les features emettrices$/i];
  const refMatch = w.ref.match(/-> "([^"]+)"/);
  const target = refMatch ? refMatch[1] : w.ref;
  if (freeTextPatterns.some(re => re.test(target))) {
    return { category: 'GENERATOR_LIMITATION', reason: 'entrée contract.consumes délibérément descriptive (prose), pas un nom de feature — le générateur attend un nom strict' };
  }
  // Nom proche d'une feature réelle mais mal orthographié / singulier-pluriel
  // (ex. "notification" -> "notifications", "payment" -> "payments") :
  // déclaration fautive facilement corrigible.
  const NEAR_MISS = { notification: 'notifications', operations: 'platform-ops (ou generique, à confirmer)', payment: 'payments', products: 'catalog' };
  if (Object.prototype.hasOwnProperty.call(NEAR_MISS, target)) {
    return { category: 'INVALID_DECLARATION', reason: `"${target}" ne correspond à aucune feature ; nom le plus proche : "${NEAR_MISS[target]}"` };
  }
  return null;
}

function classifyExposedRouteOwnerMismatch(w) {
  const mFile = w.msg.match(/résout vers "([^"]+)"/);
  const file = mFile ? mFile[1] : '';
  // Fichiers agrégateurs de montage (routes/admin.js, routes/hub.js,
  // routes/dashboard.js) : plusieurs features déclarent chacune leur PROPRE
  // fichier nested (routes/admin/<feature>.js) mais le contrat OpenAPI généré
  // attribue la route au fichier où le mount Express est littéralement
  // enregistré. Vérifié en Phase E pour customs/documents/orders (tous les
  // trois déclarent déjà routes/admin/<name>.js) — artefact d'extraction, pas
  // une déclaration à corriger.
  if (/^routes\/(admin|hub|dashboard)\.js$/.test(file)) {
    return { category: 'GENERATOR_LIMITATION', reason: `"${file}" est un agrégateur de montage Express ; la feature déclare déjà son fichier nested dédié — artefact d'attribution du scanner OpenAPI` };
  }
  if (file === 'routes/unknown.js') {
    return { category: 'GENERATOR_LIMITATION', reason: 'le scanner OpenAPI n\'a pas pu résoudre le fichier réel (placeholder "unknown")' };
  }
  // sourcing.js réclamé par economic-engine mais sert en réalité sourcing —
  // vérifié en Phase E (economic-engine.files.routes liste bien "routes/sourcing.js"
  // par erreur ; sourcing.files.routes ne liste que routes/sourcing-scanner.js).
  if (file === 'routes/sourcing.js') {
    return { category: 'ACTIONABLE_DRIFT', reason: 'routes/sourcing.js est déclaré dans economic-engine.files.routes mais implémente en réalité les routes admin sourcing — mauvaise feature propriétaire (vérifié Phase E, à corriger : déplacer la déclaration vers sourcing)' };
  }
  if (file === 'routes/health.js') {
    return { category: 'ACTIONABLE_DRIFT', reason: 'routes/health.js est déjà déclaré par platform-ops.files.routes — exposition dupliquée côté infrastructure, source probable de confusion d\'ownership' };
  }
  if (file === 'routes/shared-cart-cash.js') {
    return { category: 'ACTIONABLE_DRIFT', reason: 'webhook Stripe implémenté dans un fichier shared-cart, exposé à tort sous infrastructure.contract.exposes' };
  }
  if (/^routes\/parcel-api-v2/.test(file)) {
    return { category: 'KNOWN_DEBT', reason: 'platform-ops possède déjà les tables parcels/scans/parcel_items (classification.signals.ownsTables) mais n\'a pas encore déclaré routes/parcel-api-v2/*.js dans ses files.routes — déclaration à compléter' };
  }
  if (/^routes\/(detailed|metrics|ready|version)\.js$/.test(file)) {
    return { category: 'KNOWN_DEBT', reason: 'sous-module du subsystem health (déjà partiellement déclaré via routes/health.js) — fichier frère non encore ajouté à platform-ops.files.routes' };
  }
  if (file === 'routes/public.js') {
    return { category: 'KNOWN_DEBT', reason: 'infrastructure.files.routes est actuellement vide (aucune route déclarée) — fichier légitimement infra mais jamais déclaré' };
  }
  return null;
}

function classifyExposedRouteUnresolved(w) {
  if (/\/skus/.test(w.ref)) {
    return { category: 'ACTIONABLE_DRIFT', reason: 'route SKU déclarée dans catalog.contract.exposes mais absente du contrat OpenAPI généré — même pattern que la dette déjà documentée par catalog (routes historiques non nettoyées, cf. catalog.feature.js debt.knownGaps)' };
  }
  if (/GET \/\*\.html|webhook\/authkey-whatsapp/.test(w.ref)) {
    return { category: 'GENERATOR_LIMITATION', reason: 'route wildcard ou webhook brut, non documentée en JSDoc OpenAPI — hors du format que le scanner sait extraire' };
  }
  if (/hub\/(photo|volume)/.test(w.ref)) {
    return { category: 'GENERATOR_LIMITATION', reason: 'route d\'upload multipart, pattern habituellement hors scan OpenAPI JSDoc' };
  }
  return null;
}

function classifyObservedUndeclared(w, ctx) {
  const pairClassifications = (ctx && ctx.pairClassifications) || [];
  const ref = String(w.ref || '');
  const arrow = ref.indexOf(' -> ');
  if (arrow < 0) return null;
  const from = ref.slice(0, arrow).trim();
  const to = ref.slice(arrow + 4).trim();
  const disposition = pairClassifications.find(p => p && p.from === from && p.to === to);
  if (!disposition) return null;

  if (
    disposition.family === 'NON_RUNTIME_TEST' &&
    disposition.evidenceRole === 'TEST_ONLY' &&
    disposition.policy === 'non-runtime-evidence' &&
    disposition.exceptionRequired === false
  ) {
    return {
      category: 'EXPECTED_TOPOLOGY',
      reason: 'O6 classe cette paire NON_RUNTIME_TEST : la seule preuve vient des tests et ne constitue pas une dépendance runtime à déclarer',
    };
  }

  if (
    disposition.family === 'COMPOSITION_ROOT_WIRING' &&
    disposition.policy === 'application-wiring-not-consumption' &&
    disposition.exceptionRequired === false
  ) {
    return {
      category: 'EXPECTED_TOPOLOGY',
      reason: 'O6 classe cette paire COMPOSITION_ROOT_WIRING : le composition root monte/câble la feature sans la consommer comme dépendance métier (application-wiring-not-consumption, aucune exception requise)',
    };
  }
  return null;
}

// ── Point d'entrée ───────────────────────────────────────────────────────

/**
 * @param {{type:string, ref:string, msg:string}} w
 * @param {{ROOT:string}} ctx
 * @returns {{category:string, reason:string}}
 */
function classify(w, ctx) {
  let result = null;
  switch (w.type) {
    case 'WRITER-NOT-OWNER':
      result = classifyWriterNotOwner(w);
      break;
    case 'CONSUMES-REFERENCE-UNRESOLVED':
      result = classifyConsumesUnresolved(w, loadKnownFeatureNames((ctx && ctx.ROOT) || process.cwd()));
      break;
    case 'EXPOSED-ROUTE-OWNER-MISMATCH':
      result = classifyExposedRouteOwnerMismatch(w);
      break;
    case 'EXPOSED-ROUTE-UNRESOLVED':
      result = classifyExposedRouteUnresolved(w);
      break;
    case 'OBSERVED-UNDECLARED-FEATURE-DEPENDENCY':
      result = classifyObservedUndeclared(w, ctx);
      break;
    case 'DASH-MANIFEST-DUPLICATE-COPY':
      result = { category: 'EXPECTED_TOPOLOGY', reason: 'divergence copie/canonique déjà documentée (APP_FEATURE_REGISTRY.md), tolérée explicitement par le générateur (DASH_KNOWN_COPY_DIVERGENCES)' };
      break;
    default:
      result = null;
  }
  if (result) return result;
  const fallback = DEFAULT_BY_TYPE[w.type] || 'ACTIONABLE_DRIFT';
  return { category: fallback, reason: `aucune règle spécifique ne matche — classement par défaut de la famille "${w.type}"` };
}

const DEBT_CATEGORIES = Object.freeze([
  'INVALID_DECLARATION',
  'ACTIONABLE_DRIFT',
  'KNOWN_DEBT',
]);

function isDebtCategory(category) {
  return DEBT_CATEGORIES.includes(category);
}

function partition(warnings, ctx) {
  const out = {
    debt: [],
    expectedTopology: [],
    generatorLimitations: [],
    classified: [],
  };
  for (const warning of warnings || []) {
    const semantic = classify(warning, ctx);
    out.classified.push({ warning, semantic });
    if (isDebtCategory(semantic.category)) out.debt.push(warning);
    else if (semantic.category === 'EXPECTED_TOPOLOGY') out.expectedTopology.push(warning);
    else if (semantic.category === 'GENERATOR_LIMITATION') out.generatorLimitations.push(warning);
    else throw new Error('Catégorie de warning Business Graph inconnue: ' + semantic.category);
  }
  out.summary = {
    signals: (warnings || []).length,
    debt: out.debt.length,
    expectedTopology: out.expectedTopology.length,
    generatorLimitations: out.generatorLimitations.length,
  };
  return out;
}

module.exports = {
  classify,
  partition,
  isDebtCategory,
  DEBT_CATEGORIES,
  DEFAULT_BY_TYPE,
};
