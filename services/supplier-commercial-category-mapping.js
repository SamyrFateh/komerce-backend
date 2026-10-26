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
  if (!suggestions.length) return null;
  if (suggestions[0].confidence === 'confirmed') {
    return {...suggestions[0],source:'KNOWN_COMMERCIAL_MAPPING'};
  }
  const sourcePath = String(candidate.supplier_category || '').split(/\s*>\s*/).pop();
  const words = new Set(normalizeWords(sourcePath).filter(w=>w.length>2));
  const scored = pairs.map(p=>{
    const label = normalizeWords([p.category_label,p.subcategory_label,p.category,p.subcategory].join(' '));
    const hits = [...new Set(label.filter(w=>words.has(w)))];
    return {...p,hits:hits.length};
  }).filter(x=>x.hits>0).sort((a,b)=>b.hits-a.hits);
  // Tied categories still receive a visible default suggestion rather than a
  // WATCH classification; operator correction remains possible later.
  if (!scored.length) return null;
  const top=scored[0];
  return {category:top.category,subcategory:top.subcategory,
    category_label:top.category_label,subcategory_label:top.subcategory_label,
    source:'SUPPLIER_CATEGORY_MATCH',confidence:'proposed'};
}

module.exports={normalizePath,sourceKey,findConfirmed,confirmMapping,rankCommercialPairs,chooseCommercialPair};
