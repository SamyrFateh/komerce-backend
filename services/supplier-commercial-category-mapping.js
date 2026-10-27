/** @komerce-arch
 * @role supplier-commercial-category-mapping
 * @domain sourcing
 * @layer service
 * @criticality medium
 * @inputs provider, original category path, active boutique taxonomy, operator decision
 * @outputs reusable commercial mapping; no customs decision
 * @depends db.js
 * @db-read supplier_commercial_category_mappings, boutique_categories, boutique_subcategories
 * @db-write supplier_commercial_category_mappings
 * @db-txn confirmMapping
 */
'use strict';
const db = require('../db');
function normalizePath(value) {
  // Normalize only structural path punctuation and whitespace. Never remove
  // substantive category words or merge distinct supplier classifications.
  return String(value || '').normalize('NFKC')
    .replace(/[，,]/g, ',')
    .replace(/\s*\/\s*/g, ' > ')
    .replace(/\s*>\s*/g, ' > ')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
function normalizeProvider(value) { return String(value||'').trim().toLowerCase(); }
function sourceKey(provider,path) {
  const p=normalizeProvider(provider), key=normalizePath(path);
  if(!p || !key) throw new Error('SUPPLIER_CATEGORY_SOURCE_REQUIRED');
  return {provider:p,path:key};
}
async function findConfirmed(provider,sourcePath,q=db) {
  const key=sourceKey(provider,sourcePath);
  const {rows:[row]}=await q.query(
    `SELECT m.boutique_category_key AS category,m.boutique_subcategory_key AS subcategory
       FROM supplier_commercial_category_mappings m
       JOIN boutique_categories bc ON bc.key=m.boutique_category_key AND bc.is_active=TRUE
       JOIN boutique_subcategories bs ON bs.category_key=bc.key
         AND bs.key=m.boutique_subcategory_key AND bs.is_active=TRUE
      WHERE m.provider=$1 AND m.source_category_path=$2 AND m.status='CONFIRMED' LIMIT 1`,
    [key.provider,key.path]);
  return row || null;
}
async function confirmMapping(input,actor,q=db) {
  const key=sourceKey(input.provider,input.source_category_path);
  if (!input.category || !input.subcategory) throw new Error('ACTIVE_BOUTIQUE_PAIR_REQUIRED');
  const {rows:[active]}=await q.query(
    `SELECT bc.key AS category,bs.key AS subcategory
       FROM boutique_categories bc JOIN boutique_subcategories bs
         ON bs.category_key=bc.key AND bs.is_active=TRUE
      WHERE bc.key=$1 AND bc.is_active=TRUE AND bs.key=$2 LIMIT 1`,
    [input.category,input.subcategory]);
  if(!active) throw new Error('BOUTIQUE_TAXONOMY_INVALID');
  const {rows:[row]}=await q.query(
    `INSERT INTO supplier_commercial_category_mappings
       (provider,source_category_path,source_category_id,source_locale,proposed_label_fr,
        boutique_category_key,boutique_subcategory_key,status,confirmed_by,confirmed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'CONFIRMED',$8,now())
      ON CONFLICT(provider,source_category_path) DO UPDATE SET
        source_category_id=COALESCE(EXCLUDED.source_category_id,supplier_commercial_category_mappings.source_category_id),
        proposed_label_fr=COALESCE(EXCLUDED.proposed_label_fr,supplier_commercial_category_mappings.proposed_label_fr),
        boutique_category_key=EXCLUDED.boutique_category_key,
        boutique_subcategory_key=EXCLUDED.boutique_subcategory_key,
        status='CONFIRMED',confirmed_by=EXCLUDED.confirmed_by,confirmed_at=now(),updated_at=now()
      RETURNING provider,source_category_path,boutique_category_key,boutique_subcategory_key,status`,
    [key.provider,key.path,input.source_category_id || null,input.source_locale || 'en',
     input.label_fr || null,active.category,active.subcategory,actor || null]);
  return row;
}

function normalizeWords(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

// Pure proposal ranking: an active BOUTIQUE pair only. A weak lexical match
// is a suggestion to review, never a customs classification or a write.
function rankCommercialPairs(pairs = [], candidate = {}, preferred = null) {
  const path = String(candidate.supplier_category || '').split(/\s*>\s*/).pop();
  const sourceWords = new Set(normalizeWords(path));
  const titleWords = new Set(normalizeWords(candidate.product_name));
  const ranked = pairs.map(pair => {
    const labelWords = normalizeWords([pair.category, pair.category_label,
      pair.subcategory, pair.subcategory_label].join(' '));
    const exact = preferred && pair.category === preferred.category
      && pair.subcategory === preferred.subcategory;
    const supplierHits = labelWords.filter(word => word.length > 2 && sourceWords.has(word)).length;
    const titleHits = labelWords.filter(word => word.length > 3 && titleWords.has(word)).length;
    return { ...pair, score: exact ? 1000 : supplierHits * 10 + titleHits * 3,
      source: exact ? 'KNOWN_COMMERCIAL_MAPPING' : 'SUPPLIER_LEXICAL_MATCH' };
  }).sort((a,b) => b.score-a.score
    || String(a.category_label).localeCompare(String(b.category_label),'fr')
    || String(a.subcategory_label).localeCompare(String(b.subcategory_label),'fr'));
  return ranked.filter(row => row.score > 0).slice(0,3).map(row => ({
    category:row.category, subcategory:row.subcategory,
    category_label:row.category_label, subcategory_label:row.subcategory_label,
    source:row.source,
    confidence:row.score === 1000 ? 'confirmed' : 'review_required',
  }));
}


/**
 * Auto classification is an editorial proposal, not a customs or publication
 * verdict. Prefer the provider's own category; the title only breaks ties.
 * A missing lexical hit returns null rather than assigning an arbitrary shelf.
 */
function chooseCommercialPair(pairs = [], candidate = {}, preferred = null) {
  const suggestions = rankCommercialPairs(pairs,candidate,preferred);
  if (suggestions[0]?.confidence === 'confirmed') {
    return {...suggestions[0],source:'KNOWN_COMMERCIAL_MAPPING'};
  }
  // The supplier leaf can be generic ("Accessories & Parts"). Use the actual
  // product identity as additional evidence; never let generic parent words
  // manufacture a destination. Only an unambiguous active boutique pair wins.
  const sourcePath = String(candidate.supplier_category || '').split(/\s*>\s*/).pop();
  const generic = new Set(['accessories','accessory','parts','part','products','product',
    'items','item','other','general','miscellaneous','and','the','for','with']);
  const leafWords = new Set(normalizeWords(sourcePath).filter(w=>w.length>2&&!generic.has(w)));
  const titleWords = new Set(normalizeWords(candidate.product_name).filter(w=>w.length>2&&!generic.has(w)));
  const scored = pairs.map(p=>{
    const label = new Set(normalizeWords([p.category_label,p.subcategory_label,
      p.category,p.subcategory].join(' ')).filter(w=>w.length>2&&!generic.has(w)));
    const leafHits = [...label].filter(w=>leafWords.has(w)).length;
    const titleHits = [...label].filter(w=>titleWords.has(w)).length;
    return {...p,score:leafHits*10+titleHits*3,leafHits,titleHits};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score
    || String(a.category).localeCompare(String(b.category))
    || String(a.subcategory).localeCompare(String(b.subcategory)));
  if (!scored.length || (scored[1] && scored[0].score===scored[1].score)) return null;
  const top=scored[0];
  return {category:top.category,subcategory:top.subcategory,
    category_label:top.category_label,subcategory_label:top.subcategory_label,
    source:top.leafHits?'SUPPLIER_CATEGORY_MATCH':'PRODUCT_IDENTITY_MATCH',
    confidence:'proposed'};
}


// A semantic concept is independent of the provider's specific category
// identifiers and independent of the customs classification. Check the full
// breadcrumb, not only its last leaf (which may say "Shirts" or "Blazers").
// Destination keys are resolved against the currently active boutique pairs.
const APPAREL_BREADCRUMB = /\b(?:clothing|clothes|apparel|garments?|wear|v[eê]tements?|ropa|roupas?|bekleidung|abbigliamento)\b/i;
const WOMEN_BREADCRUMB = /\b(?:women(?:'s|s)?|lad(?:y|ies)|female|femme|mujer(?:es)?|donna|mulher(?:es)?|damen)\b/i;
const MEN_BREADCRUMB = /\b(?:men(?:'s|s)?|male|homme|hombre(?:s)?|uomo|homem|herren)\b/i;
const CHILD_BREADCRUMB = /\b(?:kids?|children|child|boys?|girls?|enfants?|infantil|kinder)\b/i;
const GENERIC_STORAGE_CONTRADICTION = /\b(?:stain\s*(?:remov(?:er|al)|treat(?:er|ment))|laundry\s*detergent|cleaning\s*(?:liquid|spray|agent|product)|insect\s*repellent|mosquito\s*(?:repellent|spray)|bug\s*spray|pesticide|decorative\s*(?:painting|canvas|print|art)|wall\s*art|canvas\s*(?:painting|art))\b/i;

function inferCommercialFromHierarchy(pairs = [], candidate = {}) {
  const path=String(candidate.supplier_category||'').replace(/\s*\/\s*/g,' > ');
  if(!APPAREL_BREADCRUMB.test(path)) return null;
  const flags=[
    {sub:'Femme',hit:WOMEN_BREADCRUMB.test(path),other:MEN_BREADCRUMB},
    {sub:'Homme',hit:MEN_BREADCRUMB.test(path),other:WOMEN_BREADCRUMB},
    {sub:'Enfant',hit:CHILD_BREADCRUMB.test(path),other:null},
  ].filter(x=>x.hit);
  // Multiple gender/age destinations in a supplier path are ambiguous.
  if(flags.length!==1) return null;
  const concept=flags[0];
  // A product title directly contradicting the supplier's gender is not a
  // safe automatic classification even when the source breadcrumb looks strong.
  if(concept.other?.test(String(candidate.product_name||''))) {
    return {status:'REVIEW_REQUIRED',source:'TITLE_HIERARCHY_CONFLICT',
      category:null,subcategory:null};
  }
  const pair=pairs.find(p=>p.category==='Mode & Beauté'&&p.subcategory===concept.sub);
  if(!pair) return null;
  return {status:'AUTO_CLASSIFIED',category:pair.category,subcategory:pair.subcategory,
    source:'FULL_BREADCRUMB_SEMANTIC_MATCH',confidence:'high'};
}

// A confirmed path may still be wrong for an individual object. These are
// broad cross-provider object families, not supplier mappings or product IDs.
function contradictsCommercialPair(candidate={}, pair={}) {
  const title=String(candidate.product_name||'');
  if(pair.category==='Maison'&&pair.subcategory==='Rangement'
      &&GENERIC_STORAGE_CONTRADICTION.test(title)) return true;
  return false;
}

module.exports={normalizePath,sourceKey,findConfirmed,confirmMapping,rankCommercialPairs,chooseCommercialPair,inferCommercialFromHierarchy,contradictsCommercialPair};
