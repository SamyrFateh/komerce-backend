/**
 * @komerce-arch
 * @role          catalog-candidate-product-owner
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        sourcing_candidate, initial_price, normalized_source_contract
 * @outputs       product_id
 * @depends       none
 * @used-by       routes/sourcing-scanner.js
 * @db-read       boutique_categories, boutique_subcategories
 * @db-write      products
 * @db-txn        caller_owned
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md §7
 * @impact-areas  catalog, sourcing
 * @version       2026-09
 */

'use strict';

const { canonicalizeProductIdentity } = require('./catalog-promotion/editorial-identity');
const { findConfirmed, chooseCommercialPair } = require('./supplier-commercial-category-mapping');
const {semanticIntent,semanticConflict} = require('./commercial-taxonomy-semantics');

function sourceLocaleFromCandidate(candidate = {}) {
  const locale = candidate?.normalized_source_contract?.source_locale;
  if (typeof locale !== 'string') return 'en';
  const normalized = locale.trim();
  return normalized || 'en';
}

// Only an explicitly confirmed, candidate-specific human decision may be
// treated as an explicit boutique category. Discovery's target is a search
// hypothesis, not evidence that the supplier product belongs in that shelf.
function boutiqueTaxonomyFromCandidate(candidate = {}) {
  const confirmed = candidate?.commercial_taxonomy_review;
  if (confirmed?.status === 'CONFIRMED' && confirmed.category && confirmed.subcategory) {
    return {category:confirmed.category,subcategory:confirmed.subcategory};
  }
  return {category:null,subcategory:null};
}

function discoveryCommercialPrior(candidate = {}) {
  const discovery = candidate?.raw_payload?.discovery || {};
  const category = String(discovery.target_category || '').trim() || null;
  const subcategory = String(discovery.target_subcategory || '').trim() || null;
  return category && subcategory ? {category,subcategory} : null;
}

function normalizedObjectWords(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Match a configured multiword object phrase with up to four intervening
// descriptors, preserving order (e.g. "car zinc alloy leather key case").
// A generic word alone never qualifies as an object identity.
function objectPhraseMatch(title, rawTerm) {
  const words = normalizedObjectWords(rawTerm).split(' ').filter(Boolean);
  if (words.length < 2) return false;
  const tokens = normalizedObjectWords(title).split(' ').filter(Boolean);
  let position = -1;
  for (const word of words) {
    const next = tokens.findIndex((token, index) => index > position && (position < 0 || index <= position + 5) && token === word);
    if (next < 0) return false;
    position = next;
  }
  return true;
}

// Commercial taxonomy only. Product title is evidence; search keywords and
// customs scores never nominate a boutique subcategory.
async function resolveCommercialObjectTaxonomy(q, candidate) {
  const title = ' ' + normalizedObjectWords(candidate.product_name) + ' ';
  if (!title.trim()) return { category:null, subcategory:null };
  const { rows } = await q.query(
    "SELECT bs.category_key AS category, bs.key AS subcategory, bs.object_classification_terms AS terms " +
    "FROM boutique_subcategories bs JOIN boutique_categories bc ON bc.key=bs.category_key " +
    "WHERE bs.is_active=TRUE AND bc.is_active=TRUE " +
    "AND bs.object_classification_terms <> '{}'::jsonb"
  );
  const ranked = rows.map(row => ({
    row,
    score: Math.max(0, ...Object.entries(row.terms || {})
      .filter(([term, weight]) => Number(weight) > 0
        && normalizedObjectWords(term).split(' ').length >= 2
        && objectPhraseMatch(title, term))
      .map(([term, weight]) => Number(weight) + normalizedObjectWords(term).length / 1000)),
  })).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score);
  if (!ranked.length) return {category:null,subcategory:null};
  // A tied high-confidence object phrase that points to different leaves in
  // ONE boutique category proves the parent, not either leaf. Disagreements
  // across root categories never become an authoritative placement.
  const best=ranked[0].score;
  const tied=ranked.filter(hit=>hit.score===best);
  if(tied.length>1){
    const parents=new Set(tied.map(hit=>hit.row.category));
    if(parents.size===1) return {category:tied[0].row.category,subcategory:null,
      level:'CATEGORY',source:'OBJECT_TERM_COMMON_PARENT'};
    return {category:null,subcategory:null};
  }
  return {category:ranked[0].row.category,subcategory:ranked[0].row.subcategory};

}

async function resolveCommercialTaxonomyVerdict(q, candidate = {}) {
  // A candidate-specific human decision wins. A reusable confirmed source
  // mapping wins over exploratory discovery hints for following products.
  const human = candidate.commercial_taxonomy_review;
  if (human?.status === 'CONFIRMED' && human.category && human.subcategory) {
    return {status:'EXPLICIT_REVIEW',category:human.category,
      subcategory:human.subcategory,source:'OPERATOR_CONFIRMED'};
  }
  // Analyse de la hiérarchie entière AVANT les correspondances fournisseur :
  // un chemin "Women's Clothing" est une preuve métier, même lorsque la feuille
  // "Shirts" ne partage aucun mot avec la catégorie française "Femme".
  // Une contradiction source/objet ne doit jamais obtenir un faux PASS.
  const semantic=semanticIntent(candidate);
  if (semantic.kind==='conflict') {
    return {status:'REVIEW_REQUIRED',category:null,subcategory:null,
      source:semantic.reason};
  }
  if (semantic.kind==='pair') {
    const {rows:[active]}=await q.query(
      'SELECT bs.key FROM boutique_subcategories bs JOIN boutique_categories bc '+
      'ON bc.key=bs.category_key WHERE bc.is_active=TRUE AND bs.is_active=TRUE '+
      'AND bc.key=$1 AND bs.key=$2 LIMIT 1',
      [semantic.category,semantic.subcategory]);
    if (active) {
      return {status:'AUTO_CLASSIFIED',category:semantic.category,
        subcategory:semantic.subcategory,source:semantic.source};
    }
    return {status:'REVIEW_REQUIRED',category:null,subcategory:null,
      source:'SEMANTIC_TARGET_INACTIVE'};
  }
  const provider = candidate.normalized_source_contract?.supplier_name
    || candidate.raw_payload?.source || candidate.supplier_name;
  const sourcePath = candidate.supplier_category
    || candidate.normalized_source_contract?.supplier_category;
  if (provider && sourcePath) {
    const mapped = await findConfirmed(provider, sourcePath, q);
    if (mapped) {
      const contradiction=semanticConflict(candidate,mapped);
      if (contradiction) return {status:'REVIEW_REQUIRED',category:null,subcategory:null,
        source:contradiction};
      return {status:'AUTO_CLASSIFIED',...mapped,source:'CONFIRMED_SUPPLIER_PATH'};
    }
  }
  // This classifier must run even when sourcing Discovery supplied a desired
  // search segment. That segment is not a category decision and must never
  // short-circuit object identity matching.
  const matched = await resolveCommercialObjectTaxonomy(q, candidate);
  if (matched.category && matched.subcategory) {
    return { status:'AUTO_CLASSIFIED', ...matched, source:'OBJECT_NAME_MATCH',level:'SUBCATEGORY' };
  }
  if (matched.category && !matched.subcategory) {
    return {status:'CATEGORY_CLASSIFIED',category:matched.category,subcategory:null,
      level:'CATEGORY',source:'OBJECT_TERM_COMMON_PARENT'};
  }
  if (sourcePath) {
    const {rows:pairs}=await q.query(
      'SELECT bc.key AS category,bc.label AS category_label,'+
      'bs.key AS subcategory,bs.label AS subcategory_label '+
      'FROM boutique_categories bc JOIN boutique_subcategories bs ON bs.category_key=bc.key '+
      'WHERE bc.is_active=TRUE AND bs.is_active=TRUE AND bc.filter_type IS NULL');
    const proposal=chooseCommercialPair(pairs,{...candidate,supplier_category:sourcePath});
    // Une similarité lexicale faible n'est pas une validation métier.
    // Conserver la suggestion pour la revue, mais ne jamais l'appeler AUTO.
    if (proposal?.confidence==='confirmed') {
      return {status:'AUTO_CLASSIFIED',category:proposal.category,
        subcategory:proposal.subcategory,source:proposal.source};
    }
  }
  const prior = discoveryCommercialPrior(candidate);
  if (prior) {
    // The suggestion is retained for review, but never returned as the
    // authoritative category/subcategory of this candidate.
    return {status:'REVIEW_REQUIRED',category:null,subcategory:null,
      source:'DISCOVERY_PRIOR',proposal:prior};
  }
  return { status:'REVIEW_REQUIRED', category:null, subcategory:null,
    source:'UNRESOLVED_COMMERCIAL_TAXONOMY' };
}

async function resolveActiveBoutiqueTaxonomy(q, candidate = {}) {
  const verdict = await resolveCommercialTaxonomyVerdict(q, candidate);
  const requested = { category:verdict.category, subcategory:verdict.subcategory };
  if (verdict.status === 'CATEGORY_CLASSIFIED') {
    const {rows:[active]}=await q.query(
      'SELECT key FROM boutique_categories WHERE key=$1 AND is_active=TRUE LIMIT 1',
      [requested.category]);
    if(!active) throw new Error('BOUTIQUE_CATEGORY_INACTIVE');
    return requested;
  }
  if (verdict.status !== 'EXPLICIT_REVIEW') return requested;
  if (!requested.category || !requested.subcategory) {
    throw new Error('BOUTIQUE_TAXONOMY_INCOMPLETE: target_category + target_subcategory requis ensemble');
  }

  const { rows: [row] } = await q.query(
    `SELECT bc.key AS category, bs.key AS subcategory
       FROM boutique_categories bc
       JOIN boutique_subcategories bs
         ON bs.category_key=bc.key
        AND bs.key=$2
        AND bs.is_active=TRUE
      WHERE bc.is_active=TRUE
        AND bc.key=$1
      LIMIT 1`,
    [requested.category, requested.subcategory]
  );
  if (!row) {
    throw new Error(`BOUTIQUE_TAXONOMY_INVALID: ${requested.category} / ${requested.subcategory}`);
  }
  return row;
}

/**
 * Creates the inactive, unavailable catalog draft produced by the sourcing handoff flow.
 * A draft may legitimately have no market price yet; publication owns that decision.
 *
 * The caller injects the transaction client so product creation remains in the
 * same atomic unit as catalog promotion + sourcing candidate state transition.
 */
function hasVariantsFromCandidate(candidate) {
  const contract = candidate?.normalized_source_contract || {};
  const units = Array.isArray(contract.sellable_units) ? contract.sellable_units : [];
  return units.some(unit => unit && unit.option_values
    && Object.keys(unit.option_values).length > 0);
}

function draftPurchaseCostFromCandidate(candidate) {
  const value = Number(candidate?.purchase_price_kmf);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function draftStockFromCandidate(candidate) {
  const value = candidate?.stock_available;
  if (value === null || value === undefined || value === '') return 0;
  const stock = Number(value);
  return Number.isInteger(stock) && stock >= 0 ? stock : 0;
}

async function createDraftProductFromSourcingCandidate(q, {
  candidate,
  initialPrice,
}) {
  const weightKg = candidate.estimated_weight_kg || null;
  const stock = draftStockFromCandidate(candidate);
  const purchaseCostKmf = draftPurchaseCostFromCandidate(candidate);
  const hasVariants = hasVariantsFromCandidate(candidate);
  const sourceLocale = sourceLocaleFromCandidate(candidate);
  const boutiqueTaxonomy = await resolveActiveBoutiqueTaxonomy(q, candidate);
  // No catalog draft without an active and complete commercial classification.
  // Keep the sourcing candidate unresolved for explicit human mapping; never
  // infer the boutique category from customs and never invent a fallback.
  const commercialProvider = String(candidate?.normalized_source_contract?.supplier_name
    || candidate?.supplier_name || '').trim().toLowerCase();
  const strictSupplier = ['aliexpress', 'cj', 'cjdropshipping'].includes(commercialProvider);
  if (strictSupplier && !boutiqueTaxonomy?.category) {
    throw new Error('BOUTIQUE_TAXONOMY_UNRESOLVED: category/subcategory review required before draft creation');
  }
  // Identité client (nom court, description proposée) dérivée mécaniquement
  // du fournisseur — jamais d'invention, jamais d'IA (DOCTRINE_CATALOGUE.md
  // §2/§4). La phrase extraite reste une proposition : needs_review signale
  // la revue tant que la qualité FR n'est pas démontrée ou que la source
  // n'est pas française. name_source/description_source ci-dessous restent
  // l'original fournisseur intact, quelle que soit l'identité publiée.
  const identity = canonicalizeProductIdentity({
    product_name: candidate.product_name,
    description: candidate.description,
    // Même source que la colonne products.source_locale ci-dessous : pas de
    // second calcul parallèle de la langue (DOCTRINE_CATALOGUE.md §4).
    source_locale: sourceLocale,
  });

  const prodRes = await q.query(
    `INSERT INTO products (
       name, category,
       boutique_category_key, boutique_subcategory_key,
       cost_kmf,
       price_kmf,
       stock,
       weight_kg,
       has_variants,
       is_active, is_available, lifecycle_status,
       name_source, description_source, source_locale, content_source,
       description, needs_review
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, FALSE, 'candidate', $10, $11, $12, 'connector_raw', $13, $14)
     RETURNING id`,
    [
      identity.name,
      candidate.komerce_category || 'autre',
      boutiqueTaxonomy.category,
      boutiqueTaxonomy.subcategory,
      purchaseCostKmf,
      initialPrice == null ? null : initialPrice,
      stock,
      weightKg,
      hasVariants,
      candidate.product_name,
      candidate.description || null,
      sourceLocale,
      identity.description,
      identity.needs_editorial_review,
    ]
  );

  return prodRes.rows[0].id;
}

module.exports = {
  createDraftProductFromSourcingCandidate,
  hasVariantsFromCandidate,
  draftPurchaseCostFromCandidate,
  draftStockFromCandidate,
  sourceLocaleFromCandidate,
  boutiqueTaxonomyFromCandidate,
  discoveryCommercialPrior,
  resolveActiveBoutiqueTaxonomy,
  resolveCommercialTaxonomyVerdict,
  resolveCommercialObjectTaxonomy,
  objectPhraseMatch,
};
