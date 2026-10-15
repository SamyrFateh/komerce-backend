/**
 * @komerce-arch
 * @role          customs-dynamic-category-classifier
 * @domain        customs
 * @layer         service
 * @criticality   high
 * @inputs        normalized supplier object, supplier-category path, active customs_categories, optional active boutique subcategory customs affinities
 * @outputs       resolved customs category key + confidence + scoring evidence
 * @depends       none
 * @used-by       services/supplier-catalog-scanner.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dynamic_taxonomy_from_customs_categories, no_hardcoded_category_keys, object_first_then_provider_leaf, supplier_identity_over_discovery_intent, boutique_subcategory_affinity_only_as_fallback
 * @impact-areas  catalog, sourcing, customs, economic-engine
 * @version       2026-10-v3
 */

'use strict';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phrasePresent(value, rawTerm) {
  const haystack = ` ${normalizeText(value)} `;
  const term = normalizeText(rawTerm);
  return Boolean(term) && haystack.includes(` ${term} `);
}

function termsForCategory(category = {}) {
  const terms = new Map();
  const configured = category.classification_terms;
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    for (const [rawTerm, rawWeight] of Object.entries(configured)) {
      const term = normalizeText(rawTerm);
      const weight = Number(rawWeight);
      if (term && Number.isFinite(weight) && weight > 0) {
        terms.set(term, Math.max(terms.get(term) || 0, weight));
      }
    }
  }

  // Metadata = low-priority fallback. Explicit terms remain authoritative.
  for (const raw of [category.key, category.label, category.sub_label]) {
    const term = normalizeText(raw);
    if (term) terms.set(term, Math.max(terms.get(term) || 0, 1));
  }

  return terms;
}

// Les taxonomies fournisseur ne sont PAS du texte plat. Un nom de rayon parent
// (« Jewelry & Watches ») décrit un ensemble hétérogène ; il ne peut pas suffire
// à décider que des boucles d'oreilles sont un appareil électrique.
// Ne dépend d'aucun fournisseur, d'aucune clé douanière en dur.
function supplierCategoryLevels(value) {
  const parts = String(value || '').split(/\s*(?:>|\/)\s*/)
    .map(part => part.trim()).filter(Boolean);
  return parts;
}

function supplierSignals(product = {}) {
  const discovery = product?.raw_payload?.discovery || {};
  const levels = supplierCategoryLevels(product.supplier_category);
  // Compatibilité : une catégorie fournisseur plate reste une source directe,
  // notamment pour les connecteurs historiques sans chemin hiérarchique.
  const categorySignals = levels.length <= 1
    ? [{ name:'supplier_category', value:levels[0], multiplier:4 }]
    : [
      { name:'supplier_category_leaf', value:levels[levels.length - 1], multiplier:4 },
      // La branche est un INDICE secondaire, pas une preuve d'identité objet.
      // La racine est volontairement ignorée : elle est souvent multi-rayons.
      ...(levels.length > 2 ? [{
        name:'supplier_category_branch', value:levels[levels.length - 2], multiplier:1,
      }] : []),
    ];
  // L'identité de l'objet vendu est prioritaire ; la recherche initiale et la
  // branche fournisseur ne peuvent pas, seules, valider une catégorie douanière.
  return [
    { name:'product_name', value:product.product_name, multiplier:6 },
    ...categorySignals,
    { name:'description', value:product.description, multiplier:2 },
    { name:'keyword', value:discovery.keyword, multiplier:2 },
    { name:'target_subcategory', value:discovery.target_subcategory, multiplier:1 },
  ].filter(signal => String(signal.value || '').trim());
}

// Une traduction attestée du titre fournisseur est une preuve d'identité objet,
// contrairement au mot-clé de recherche ou à la catégorie racine.
const IDENTITY_SIGNALS = new Set(['product_name', 'supplier_category', 'supplier_category_leaf', 'glossary_product_name']);

function hasObjectEvidence(result) {
  return result.evidence.some(row => IDENTITY_SIGNALS.has(row.signal));
}

function unresolvedCategory(fallback, reason, top = null, second = null, signals = []) {
  return {
    key:fallback?.key || null,
    source:'default',
    confidence:'low',
    score:top?.score || 0,
    evidence:top?.evidence || [],
    reason,
    top_candidate_key:top?.category?.key || null,
    second_candidate_key:second?.category?.key || null,
    second_score:second?.score || 0,
    product_name_present:signals.some(signal => signal.name === 'product_name'),
  };
}

function scoreCategory(category, signals) {
  const terms = termsForCategory(category);
  let score = 0;
  const evidence = [];

  for (const signal of signals) {
    for (const [term, termWeight] of terms.entries()) {
      if (!phrasePresent(signal.value, term)) continue;
      const contribution = termWeight * signal.multiplier;
      score += contribution;
      evidence.push({
        signal: signal.name,
        term,
        term_weight: termWeight,
        signal_multiplier: signal.multiplier,
        contribution,
      });
    }
  }

  return { category, score, evidence };
}

function confidenceFor(topScore, secondScore) {
  if (!(topScore > 0)) return 'low';
  const gap = topScore - Math.max(0, secondScore || 0);
  const ratio = secondScore > 0 ? topScore / secondScore : Infinity;
  if (topScore >= 30 && (secondScore <= 0 || ratio >= 1.5 || gap >= 15)) return 'high';
  if (topScore >= 12 && (secondScore <= 0 || ratio >= 1.2 || gap >= 5)) return 'medium';
  return 'low';
}

function resolveBoutiqueAffinity(product = {}, affinities = [], activeKeys = new Set()) {
  const discovery = product?.raw_payload?.discovery || {};
  const categoryKey = String(discovery.target_category || '').trim();
  const subcategoryKey = String(discovery.target_subcategory || '').trim();
  if (!categoryKey || !subcategoryKey) return null;

  const row = (Array.isArray(affinities) ? affinities : []).find(item =>
    String(item?.category_key || '') === categoryKey
    && String(item?.subcategory_key || '') === subcategoryKey
    && activeKeys.has(String(item?.customs_category_key || ''))
  );
  if (!row) return null;
  return {
    key: String(row.customs_category_key),
    source: 'boutique_affinity',
    confidence: 'medium',
    score: 0,
    evidence: [{
      signal: 'boutique_subcategory_affinity',
      category_key: categoryKey,
      subcategory_key: subcategoryKey,
      customs_category_key: String(row.customs_category_key),
    }],
    reason: 'boutique_subcategory_affinity',
  };
}

function classifySupplierProduct(product, categories = [], options = {}) {
  const active = (Array.isArray(categories) ? categories : [])
    .filter(category => category && category.is_active !== false);
  const fallback = active.find(category => category.key === 'default') || null;
  const activeKeys = new Set(active.map(category => String(category.key || '')).filter(Boolean));
  const affinity = resolveBoutiqueAffinity(product, options.boutique_customs_affinities, activeKeys);
  const signals = supplierSignals(product);
  // Extension par expressions complètes du glossaire actif : aucun dictionnaire parallèle.
  // Ne jamais traduire à partir d'un simple keyword de découverte.
  const title = String(product?.product_name || '');
  const glossary = Array.isArray(options.catalog_glossary) ? options.catalog_glossary : [];
  const translated = [...new Set(glossary.filter(row =>
    row && phrasePresent(title, row.term_source) && String(row.term_fr || '').trim()
  ).map(row => String(row.term_fr).trim()))];
  if (translated.length) signals.push({ name:'glossary_product_name', value:translated.join(' ; '), multiplier:4 });

  if (!active.length) {
    return {
      key: null,
      source: 'default',
      confidence: 'low',
      score: 0,
      evidence: [],
      reason: 'no_active_customs_categories',
    };
  }

  const ranked = active
    .filter(category => category.key !== 'default')
    .map(category => scoreCategory(category, signals))
    .filter(result => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(a.category.display_order || 999) - Number(b.category.display_order || 999);
    });

  if (!ranked.length) {
    if (affinity) return affinity;
    return unresolvedCategory(fallback,
      signals.length ? 'no_configured_term_match' : 'no_supplier_signals',
      null, null, signals);
  }

  const top = ranked[0];
  const second = ranked[1] || { score: 0 };
  // L'inférence fournisseur (branche) ou une intention de recherche ne peuvent
  // jamais être les seules preuves d'une classification douanière automatique.
  // L'affinité boutique existante reste un fallback distinct, auditable.
  if (!hasObjectEvidence(top)) {
    if (affinity) return {
      ...affinity,
      lexical_top_candidate_key:top.category.key,
      lexical_top_score:top.score,
      lexical_second_candidate_key:ranked[1]?.category?.key || null,
      lexical_second_score:second.score,
    };
    return unresolvedCategory(fallback, 'object_identity_unconfirmed', top, ranked[1], signals);
  }
  const confidence = confidenceFor(top.score, second.score);

  if (confidence === 'low') {
    if (affinity) {
      return {
        ...affinity,
        lexical_top_candidate_key: top.category.key,
        lexical_top_score: top.score,
        lexical_second_candidate_key: ranked[1]?.category?.key || null,
        lexical_second_score: second.score,
      };
    }
    return unresolvedCategory(fallback, 'ambiguous_category_match', top, ranked[1], signals);
  }

  return {
    key: top.category.key,
    source: 'mapped',
    confidence,
    score: top.score,
    evidence: top.evidence,
    reason: 'configured_terms_match',
    second_candidate_key: ranked[1]?.category?.key || null,
    second_score: second.score,
  };
}

module.exports = {
  normalizeText,
  phrasePresent,
  termsForCategory,
  supplierCategoryLevels,
  supplierSignals,
  hasObjectEvidence,
  scoreCategory,
  confidenceFor,
  resolveBoutiqueAffinity,
  classifySupplierProduct,
};
