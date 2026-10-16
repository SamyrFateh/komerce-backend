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
  return String(value || '').normalize('NFKC').trim().replace(/\s*>\s*/g,' > ').replace(/\s+/g,' ').toLowerCase();
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
module.exports={normalizePath,sourceKey,findConfirmed,confirmMapping};
